import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classify, foldName, ingestOnce, inspectFolder, matchAccount, recentFiles, scanFolder, SETTLE_MS, type IngestAccount, type ImportRows } from "@/lib/ingest";
import { guessMapping, layoutOf } from "@/lib/csv-import";
import { isOn, parseStored, resolveLocation, userFolderName, validateDesktopDir } from "@/lib/ingest-settings";

const CSV = "Date,Description,Amount\n05/10/2026,TESCO,-12.50\n06/10/2026,Salary,1000.00\n";
const guessed = guessMapping(CSV, ",");
const mapping = { ...guessed, ...layoutOf(CSV, guessed) };
const monzo: IngestAccount = { id: 1, names: ["Main account", "Monzo"], mapping };
const noMap: IngestAccount = { id: 2, names: ["Savings"], mapping: null };
const NOW = 2_000_000_000_000;
const OLD = (NOW - SETTLE_MS - 1000) / 1000;

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function drop(folder: string, name: string, body = CSV, old = true) {
  fs.mkdirSync(path.join(root, folder), { recursive: true });
  const p = path.join(root, folder, name);
  fs.writeFileSync(p, body);
  if (old) fs.utimesSync(p, OLD, OLD);
  return p;
}

const ok: ImportRows = async (_id, rows) => ({ imported: rows.length, alreadyImported: 0, waitingInReview: rows.length });

describe("account matching", () => {
  it("ignores case, spacing and characters a folder can't hold", () => {
    expect(foldName("  Main   Account ")).toBe("main account");
    expect(foldName('Mon:zo/"x"')).toBe("monzox");
  });
  it("matches the alias or the bank's own name", () => {
    expect("account" in matchAccount("main ACCOUNT", [monzo])).toBe(true);
    expect("account" in matchAccount("monzo", [monzo])).toBe(true);
  });
  it("says why when nothing or too much matches", () => {
    expect(matchAccount("nope", [monzo])).toMatchObject({ reason: expect.stringContaining("No account is called"), none: true });
    expect(matchAccount("monzo", [monzo, { ...monzo, id: 9 }])).toMatchObject({ reason: expect.stringContaining("More than one") });
    expect("reason" in matchAccount("", [monzo])).toBe(true);
  });
});

describe("scanFolder", () => {
  it("finds csv files one level down, and reports strays in the root", () => {
    drop("Monzo", "a.csv");
    drop("Monzo", "b.CSV");
    drop("Monzo", "notes.txt");
    drop("Monzo", ".hidden.csv");
    fs.writeFileSync(path.join(root, "loose.csv"), CSV);
    const { files, strays } = scanFolder(root);
    expect(files.map((f) => f.name).sort()).toEqual(["a.csv", "b.CSV"]);
    expect(strays).toEqual(["loose.csv"]);
  });
  it("never looks inside processed/ or failed/, and never follows symlinks", () => {
    drop("processed", "x.csv");
    drop("failed", "y.csv");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-out-"));
    fs.writeFileSync(path.join(outside, "secret.csv"), CSV);
    fs.symlinkSync(outside, path.join(root, "Linked"));
    fs.mkdirSync(path.join(root, "Real"));
    fs.symlinkSync(path.join(outside, "secret.csv"), path.join(root, "Real", "s.csv"));
    expect(scanFolder(root).files).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe("classify", () => {
  const file = (over = {}) => ({ folder: "Monzo", name: "a.csv", path: "x", size: 100, mtimeMs: NOW - SETTLE_MS - 1, ...over });
  it("waits for a file that is still changing", () => {
    expect(classify(file({ mtimeMs: NOW - 1000 }), [monzo], NOW).state).toBe("settling");
  });
  it("leaves a file when the account has no saved mapping, and says what to do", () => {
    const v = classify(file({ folder: "Savings" }), [noMap], NOW);
    expect(v).toMatchObject({ state: "waiting", reason: expect.stringContaining("columns"), setup: { accountId: noMap.id } });
  });
  it("offers to create the account when the folder name matches none", () => {
    expect(classify(file({ folder: "Revolut" }), [monzo], NOW)).toMatchObject({ state: "waiting", setup: { accountId: null } });
  });
  it("offers no setup when two accounts share the name", () => {
    const v = classify(file(), [monzo, { ...monzo, id: 9 }], NOW);
    expect(v.state === "waiting" && v.setup).toBeUndefined();
  });
  it("fails empty and oversized files", () => {
    expect(classify(file({ size: 0 }), [monzo], NOW).state).toBe("failed");
    expect(classify(file({ size: 11 * 1024 * 1024 }), [monzo], NOW).state).toBe("failed");
  });
  it("waits when the saved columns predate layout memory, and says what to do", () => {
    const legacy: IngestAccount = { ...monzo, mapping: guessed };
    const v = classify(file(), [legacy], NOW);
    expect(v).toMatchObject({ state: "waiting" });
    expect(v).toMatchObject({ state: "waiting", reason: expect.stringContaining("Confirm the columns"), setup: { accountId: legacy.id } });
  });
  it("is ready otherwise", () => expect(classify(file(), [monzo], NOW).state).toBe("ready"));
});

describe("ingestOnce", () => {
  it("imports a good file and files it under processed/<account>/", async () => {
    const p = drop("Monzo", "oct.csv");
    const seen: number[] = [];
    const report = await ingestOnce(root, [monzo], async (id, rows) => (seen.push(id, rows.length), { imported: 2, alreadyImported: 0, waitingInReview: 2 }), 100, NOW);
    expect(seen).toEqual([1, 2]);
    expect(report.outcomes[0]).toMatchObject({ state: "imported", message: "Imported 2 new, 0 already known." });
    expect(fs.existsSync(p)).toBe(false);
    const moved = fs.readdirSync(path.join(root, "processed", "Monzo"));
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatch(/^\d{8}-\d{6}-oct\.csv$/);
  });

  it("is all-or-nothing: one bad row fails the file, imports nothing, and keeps the file with a reason", async () => {
    const p = drop("Monzo", "bad.csv", "Date,Description,Amount\n05/10/2026,TESCO,-12.50\nnot a date,X,1\n");
    let called = false;
    const report = await ingestOnce(root, [monzo], async () => ((called = true), { imported: 1, alreadyImported: 0, waitingInReview: 1 }), 100, NOW);
    expect(called).toBe(false);
    expect(report.outcomes[0].state).toBe("failed");
    expect(report.outcomes[0].message).toContain("Nothing was imported");
    expect(fs.existsSync(p)).toBe(false);
    const [name] = fs.readdirSync(path.join(root, "failed", "Monzo")).filter((n) => !n.endsWith(".txt"));
    expect(fs.readFileSync(path.join(root, "failed", "Monzo", `${name}.txt`), "utf8")).toContain("Nothing was imported");
  });

  it("skips zero-amount lines (a bank's fee note), imports the rest, and says so", async () => {
    const p = drop("Monzo", "fee.csv", "Date,Description,Amount\n05/10/2026,TESCO,-12.50\n06/10/2026,Plan fee,0.00\n");
    const seen: number[] = [];
    const report = await ingestOnce(root, [monzo], async (_id, rows) => (seen.push(rows.length), { imported: 1, alreadyImported: 0, waitingInReview: 1 }), 100, NOW);
    expect(seen).toEqual([1]);
    expect(report.outcomes[0]).toMatchObject({ state: "imported", message: "Imported 1 new, 0 already known. Skipped 1 line(s) with a zero amount." });
    expect(fs.existsSync(p)).toBe(false);
  });

  it("leaves out pending lines, says so, and fails a file that has nothing else", async () => {
    const sample = "Date,Description,Amount,State\n01/08/2026,A,-1.00,COMPLETED\n";
    const g = guessMapping(sample, ",");
    const acct: IngestAccount = { id: 1, names: ["Monzo"], mapping: { ...g, ...layoutOf(sample, g) } };
    drop("Monzo", "mixed.csv", "Date,Description,Amount,State\n05/10/2026,TESCO,-12.50,COMPLETED\n06/10/2026,SHOP,-3.00,PENDING\n");
    drop("Monzo", "onlypending.csv", "Date,Description,Amount,State\n06/10/2026,SHOP,-3.00,PENDING\n");
    const seen: number[] = [];
    const report = await ingestOnce(root, [acct], async (_id, rows) => (seen.push(rows.length), { imported: rows.length, alreadyImported: 0, waitingInReview: rows.length }), 100, NOW);
    const byName = Object.fromEntries(report.outcomes.map((o) => [o.name, o]));
    expect(seen).toEqual([1]);
    expect(byName["mixed.csv"].message).toContain("Left out 1 pending");
    expect(byName["onlypending.csv"]).toMatchObject({ state: "failed", message: "The file has only pending, reverted, declined or cancelled lines." });
  });

  it("fails a file whose only lines are zero-amount", async () => {
    drop("Monzo", "zero.csv", "Date,Description,Amount\n06/10/2026,Plan fee,0.00\n");
    const report = await ingestOnce(root, [monzo], ok, 100, NOW);
    expect(report.outcomes[0]).toMatchObject({ state: "failed", message: "The file has no transactions." });
  });

  it("fails, keeps and explains a file whose columns moved (the numbers would still parse)", async () => {
    drop("Monzo", "moved.csv", "Date,Type,Description,Amount\n05/10/2026,Card,TESCO,-12.50\n");
    let called = false;
    const report = await ingestOnce(root, [monzo], async () => ((called = true), { imported: 1, alreadyImported: 0, waitingInReview: 1 }), 100, NOW);
    expect(called).toBe(false);
    expect(report.outcomes[0].state).toBe("failed");
    expect(report.outcomes[0].message).toContain("laid out differently");
    expect(report.outcomes[0].message).toContain('Column 2 was "Description"');
    expect(fs.readdirSync(path.join(root, "failed", "Monzo")).length).toBe(2);
  });

  it("takes a file with extra columns at the end, and reads a Windows-1252 file's £ and accents", async () => {
    const p = path.join(root, "Monzo");
    fs.mkdirSync(p, { recursive: true });
    const f = path.join(p, "latin.csv");
    fs.writeFileSync(f, Buffer.from("Date,Description,Amount,Balance\n05/10/2026,Caf\u00e9 \u00a35,-5.00,10.00\n", "latin1"));
    fs.utimesSync(f, OLD, OLD);
    const payees: string[] = [];
    const report = await ingestOnce(root, [monzo], async (_id, rows) => (payees.push(...rows.map((r) => r.payeeRaw)), { imported: 1, alreadyImported: 0, waitingInReview: 1 }), 100, NOW);
    expect(report.outcomes[0].state).toBe("imported");
    expect(payees).toEqual(["Caf\u00e9 \u00a35"]);
  });

  it("reads a UTF-16 file (Excel's Unicode text)", async () => {
    const p = path.join(root, "Monzo");
    fs.mkdirSync(p, { recursive: true });
    const f = path.join(p, "u16.csv");
    fs.writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Date,Description,Amount\n05/10/2026,Tesco,-5.00\n", "utf16le")]));
    fs.utimesSync(f, OLD, OLD);
    const report = await ingestOnce(root, [monzo], ok, 100, NOW);
    expect(report.outcomes[0].state).toBe("imported");
  });

  it("fails a file with a header only, a binary file, and too many rows", async () => {
    drop("Monzo", "empty.csv", "Date,Description,Amount\n");
    drop("Monzo", "bin.csv", "a,b\0c");
    drop("Monzo", "big.csv", CSV);
    const report = await ingestOnce(root, [monzo], ok, 1, NOW);
    expect(report.outcomes.map((o) => o.state)).toEqual(["failed", "failed", "failed"]);
  });

  it("fails the file, and keeps it, when the import itself throws", async () => {
    drop("Monzo", "a.csv");
    const report = await ingestOnce(root, [monzo], async () => Promise.reject(new Error("db locked")), 100, NOW);
    expect(report.outcomes[0]).toMatchObject({ state: "failed", message: "db locked" });
    expect(fs.readdirSync(path.join(root, "failed", "Monzo")).length).toBe(2);
  });

  it("leaves unknown-account folders, unmapped accounts, new files and strays alone", async () => {
    drop("Nobody", "a.csv");
    drop("Savings", "a.csv");
    drop("Monzo", "fresh.csv", CSV, false);
    fs.writeFileSync(path.join(root, "loose.csv"), CSV);
    const report = await ingestOnce(root, [monzo, noMap], ok, 100, Date.now());
    expect(report.outcomes.map((o) => o.state).sort()).toEqual(["settling", "waiting", "waiting"]);
    expect(report.strays).toEqual(["loose.csv"]);
    expect(fs.existsSync(path.join(root, "processed"))).toBe(false);
  });

  it("two files with the same name never overwrite each other", async () => {
    drop("Monzo", "a.csv");
    await ingestOnce(root, [monzo], ok, 100, NOW);
    drop("Monzo", "a.csv");
    await ingestOnce(root, [monzo], ok, 100, NOW);
    expect(fs.readdirSync(path.join(root, "processed", "Monzo"))).toHaveLength(2);
  });

  it("a second check right after finds nothing left to do", async () => {
    drop("Monzo", "a.csv");
    await ingestOnce(root, [monzo], ok, 100, NOW);
    expect((await ingestOnce(root, [monzo], ok, 100, NOW)).outcomes).toEqual([]);
  });
});

describe("inspect and recent", () => {
  it("counts ready files and lists what waits", () => {
    drop("Monzo", "a.csv");
    drop("Nobody", "b.csv");
    const s = inspectFolder(root, [monzo], NOW);
    expect(s.ready).toBe(1);
    expect(s.waiting).toHaveLength(1);
  });
  it("lists filed files newest first, with the reason for failures", async () => {
    drop("Monzo", "ok.csv");
    drop("Monzo", "bad.csv", "Date,Description,Amount\nnope,x,1\n");
    await ingestOnce(root, [monzo], ok, 100, NOW);
    const r = recentFiles(root);
    expect(r.map((x) => x.bucket).sort()).toEqual(["failed", "processed"]);
    expect(r.find((x) => x.bucket === "failed")).toMatchObject({ name: "bad.csv", reason: expect.stringContaining("Nothing was imported") });
    expect(r.find((x) => x.bucket === "processed")?.name).toBe("ok.csv");
  });
});

describe("location rules", () => {
  it("self-hosted: INGEST_DIR/<email>, lowercased, never user-chosen", () => {
    const loc = resolveLocation({ desktop: false, stored: { dir: "/etc" }, email: "Ann@Example.com", env: { INGEST_DIR: "/app/ingest" } });
    expect(loc).toEqual({ dir: "/app/ingest/ann@example.com", problem: null, source: "env" });
  });
  it("self-hosted without INGEST_DIR: no folder", () => {
    expect(resolveLocation({ desktop: false, stored: {}, email: "a@b.c", env: {} })).toMatchObject({ dir: null, source: "none" });
  });
  it("rejects emails that can't be a folder name", () => {
    for (const bad of ["", "../x@y", "a/b@c.d", ".hidden@x.y", "a\\b@c.d"]) expect(userFolderName(bad)).toBeNull();
    expect(resolveLocation({ desktop: false, stored: {}, email: "../x", env: { INGEST_DIR: "/i" } }).dir).toBeNull();
  });
  it("desktop: the saved folder, else none", () => {
    expect(resolveLocation({ desktop: true, stored: { dir: "/home/a/in" }, email: "x", env: {} }).dir).toBe("/home/a/in");
    expect(resolveLocation({ desktop: true, stored: {}, email: "x", env: { INGEST_DIR: "/i" } }).dir).toBeNull();
  });
  it("validates a desktop folder", () => {
    expect(() => validateDesktopDir("")).toThrow();
    expect(() => validateDesktopDir("relative/dir")).toThrow(/full path/);
    expect(() => validateDesktopDir("/")).toThrow(/top of the disk/);
    expect(() => validateDesktopDir("/a\0b")).toThrow();
    expect(validateDesktopDir("  /home/a/../a/in ")).toBe("/home/a/in");
  });
  it("parses stored JSON tolerantly; on unless switched off", () => {
    expect(parseStored("not json")).toEqual({});
    expect(parseStored('{"dir":5,"enabled":"x"}')).toEqual({});
    expect(isOn(parseStored(null))).toBe(true);
    expect(isOn(parseStored('{"enabled":false}'))).toBe(false);
  });
});
