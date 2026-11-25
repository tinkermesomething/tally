import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { migrationsFolderUpTo } from "./helpers/migrations";
import { db } from "@/lib/db";
import { bankAccounts, importedTransactions } from "@/lib/db/schema";
import { createCsvAccount, importCsvTransactions } from "@/lib/db/csv-import";
import { setIngestStored } from "@/lib/db/settings";
import { runIngest, ingestStatus, readIngestFile } from "@/lib/ingest-run";
import { guessMapping, layoutOf, mapCsvRows } from "@/lib/csv-import";
import { SETTLE_MS } from "@/lib/ingest";

const CSV = "Date,Description,Amount\n05/10/2026,TESCO,-12.50\n06/10/2026,Salary,1000.00\n";
const OLD = (Date.now() - SETTLE_MS - 5000) / 1000;
let root: string;
const KEYS = ["TALLY_MODE", "INGEST_DIR"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  await resetDb();
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.TALLY_MODE = "desktop";
  delete process.env.INGEST_DIR;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-run-"));
});
afterEach(() => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  fs.rmSync(root, { recursive: true, force: true });
});

function drop(folder: string, name: string, body = CSV) {
  fs.mkdirSync(path.join(root, folder), { recursive: true });
  const p = path.join(root, folder, name);
  fs.writeFileSync(p, body);
  fs.utimesSync(p, OLD, OLD);
}

/** A CSV account that has had one hand import, so its columns are saved. */
async function trainedAccount(name: string) {
  const account = await createCsvAccount(name);
  const guessed = guessMapping(CSV, ",");
  const mapping = { ...guessed, ...layoutOf(CSV, guessed) };
  const { rows } = mapCsvRows("Date,Description,Amount\n01/09/2026,OLD ONE,-1.00\n", mapping);
  await importCsvTransactions(account.id, rows, { mapping });
  return account;
}
const count = async (id: number) => (await db.select().from(importedTransactions).where(eq(importedTransactions.bankAccountId, id))).length;

describe("runIngest (real database)", () => {
  it("is off until a folder is chosen on desktop", async () => {
    expect((await runIngest("x@y.z")).state).toBe("unset");
  });

  it("suggests a visible folder in the home directory on desktop, none on a server", async () => {
    expect((await ingestStatus("x@y.z")).suggestion).toBe(path.join(os.homedir(), "Tally ingest"));
    process.env.TALLY_MODE = "server";
    expect((await ingestStatus("x@y.z")).suggestion).toBeNull();
  });

  it("imports a dropped file into the account named by its folder, then files it", async () => {
    const a = await trainedAccount("Monzo");
    await setIngestStored(JSON.stringify({ dir: root }));
    drop("monzo", "oct.csv");
    const res = await runIngest("x@y.z");
    expect(res.state).toBe("ran");
    if (res.state !== "ran") return;
    expect(res.report.outcomes[0]).toMatchObject({ state: "imported", message: "Imported 2 new, 0 already known." });
    expect(await count(a.id)).toBe(3);
    expect(fs.readdirSync(path.join(root, "processed", "monzo"))).toHaveLength(1);
  });

  it("never imports twice: the same file dropped again adds nothing", async () => {
    const a = await trainedAccount("Monzo");
    await setIngestStored(JSON.stringify({ dir: root }));
    drop("Monzo", "oct.csv");
    await runIngest("x@y.z");
    drop("Monzo", "oct-again.csv");
    const res = await runIngest("x@y.z");
    if (res.state !== "ran") throw new Error("did not run");
    expect(res.report.outcomes[0].message).toBe("Imported 0 new, 2 already known.");
    expect(await count(a.id)).toBe(3);
  });

  it("leaves a file for an account that has had no hand import", async () => {
    const a = await createCsvAccount("Fresh");
    await setIngestStored(JSON.stringify({ dir: root }));
    drop("Fresh", "a.csv");
    const res = await runIngest("x@y.z");
    if (res.state !== "ran") throw new Error("did not run");
    expect(res.report.outcomes[0].state).toBe("waiting");
    expect(await count(a.id)).toBe(0);
    expect(fs.existsSync(path.join(root, "Fresh", "a.csv"))).toBe(true);
  });

  it("does nothing when switched off, or when the folder is missing", async () => {
    await trainedAccount("Monzo");
    await setIngestStored(JSON.stringify({ dir: root, enabled: false }));
    expect((await runIngest("x@y.z")).state).toBe("off");
    await setIngestStored(JSON.stringify({ dir: path.join(root, "nope") }));
    expect((await runIngest("x@y.z")).state).toBe("missing");
  });

  it("self-hosted: reads <INGEST_DIR>/<email>, whatever is saved", async () => {
    process.env.TALLY_MODE = "web";
    process.env.INGEST_DIR = root;
    const a = await trainedAccount("Monzo");
    await setIngestStored(JSON.stringify({ dir: "/etc" }));
    drop("ann@example.com/Monzo", "a.csv");
    const res = await runIngest("Ann@Example.com");
    if (res.state !== "ran") throw new Error(`state ${res.state}`);
    expect(res.dir).toBe(path.join(root, "ann@example.com"));
    expect(await count(a.id)).toBe(3);
    // another user's folder is never read
    drop("bob@example.com/Monzo", "b.csv");
    expect(fs.existsSync(path.join(root, "bob@example.com", "Monzo", "b.csv"))).toBe(true);
  });

  it("status lists what waits and what was filed", async () => {
    await trainedAccount("Monzo");
    await setIngestStored(JSON.stringify({ dir: root }));
    drop("Monzo", "a.csv");
    drop("Nobody", "b.csv");
    const s = await ingestStatus("x@y.z");
    expect(s.folder).toBe("ok");
    if (s.folder !== "ok") return;
    expect(s.ready).toBe(1);
    expect(s.waiting).toHaveLength(1);
    await runIngest("x@y.z");
    const after = await ingestStatus("x@y.z");
    if (after.folder !== "ok") throw new Error("folder");
    expect(after.recent[0]).toMatchObject({ bucket: "processed", name: "a.csv" });
  });
});

describe("0042_ingest_config", () => {
  it("adds a nullable column and leaves existing settings untouched", () => {
    const sqlite = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tally-db-")), "t.db"));
    migrate(drizzle(sqlite), { migrationsFolder: migrationsFolderUpTo("0041_help_and_tour") });
    sqlite.exec("INSERT INTO app_settings (currency) VALUES ('EUR')");
    migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    expect(sqlite.prepare("SELECT currency, ingest_config FROM app_settings").all()).toEqual([{ currency: "EUR", ingest_config: null }]);
  });
});

describe("setting up an account from a waiting file", () => {
  beforeEach(async () => {
    await setIngestStored(JSON.stringify({ enabled: true, dir: root }));
  });

  it("offers to create an account that does not exist, and reads the file for the dialog", async () => {
    drop("Revolut", "jan.csv");
    const s = await ingestStatus("x@y.z");
    expect(s.folder === "ok" && s.waiting).toEqual([expect.objectContaining({ folder: "Revolut", name: "jan.csv", setup: { accountId: null } })]);
    expect(await readIngestFile("x@y.z", "Revolut", "jan.csv")).toEqual({ ok: true, text: CSV });
  });

  it("points at the existing account when it has no saved columns yet", async () => {
    const account = await createCsvAccount("Monzo");
    drop("monzo", "jan.csv");
    const s = await ingestStatus("x@y.z");
    expect(s.folder === "ok" && s.waiting[0].setup).toEqual({ accountId: account.id });
  });

  it("reads only files the scan lists, never a path the browser made up", async () => {
    drop("Revolut", "jan.csv");
    fs.writeFileSync(path.join(root, "secret.csv"), "x");
    for (const [folder, name] of [["..", "secret.csv"], ["Revolut", "../secret.csv"], ["Revolut", "nope.csv"], ["", "secret.csv"]]) {
      expect((await readIngestFile("x@y.z", folder, name)).ok).toBe(false);
    }
  });

  it("refuses when the folder is switched off or gone", async () => {
    fs.rmSync(root, { recursive: true, force: true });
    expect((await readIngestFile("x@y.z", "Revolut", "jan.csv")).ok).toBe(false);
  });
});
