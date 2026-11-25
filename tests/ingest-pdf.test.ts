import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ingestOnce, scanFolder, SETTLE_MS, type ImportRows, type IngestAccount } from "@/lib/ingest";
import { guessMapping, layoutOf } from "@/lib/csv-import";
import { readPdfStatement } from "@/lib/pdf-statement";
import { makePdf, page, type Line } from "./helpers/make-pdf";

const NOW = 2_000_000_000_000;
const OLD = (NOW - SETTLE_MS - 1000) / 1000;
const LINES: Line[] = [
  { date: "26 Sep", desc: "Mobile top-up", type: "Mobile/Online Transaction", in: "£8.00" },
  { date: "25 Sep", desc: "Lidl", out: "-£14.77" },
];

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-pdf-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function drop(folder: string, name: string, bytes: Uint8Array | string) {
  fs.mkdirSync(path.join(root, folder), { recursive: true });
  const p = path.join(root, folder, name);
  fs.writeFileSync(p, bytes);
  fs.utimesSync(p, OLD, OLD);
}

/** An account whose saved columns were confirmed on this very kind of PDF. */
async function natwest(): Promise<IngestAccount> {
  const r = await readPdfStatement(makePdf([page(LINES)]));
  if (!r.ok) throw new Error(r.error);
  const guessed = guessMapping(r.csv, ",");
  return { id: 1, names: ["NatWest"], mapping: { ...guessed, ...layoutOf(r.csv, guessed) } };
}

const ok: ImportRows = async (_id, rows) => ({ imported: rows.length, alreadyImported: 0, waitingInReview: rows.length });

describe("PDF statements in the ingest folder", () => {
  it("are found next to CSVs, and a PDF in the root is a stray", () => {
    drop("NatWest", "a.pdf", "x");
    drop("NatWest", "b.csv", "x");
    drop("NatWest", "notes.txt", "x");
    fs.writeFileSync(path.join(root, "loose.PDF"), "x");
    const { files, strays } = scanFolder(root);
    expect(files.map((f) => f.name).sort()).toEqual(["a.pdf", "b.csv"]);
    expect(strays).toEqual(["loose.PDF"]);
  });

  it("are read, imported and filed under processed/<account>/", async () => {
    drop("NatWest", "statement.pdf", makePdf([page(LINES)]));
    let seen: { amountPence: number; payeeRaw: string; bookingDate: string }[] = [];
    const rep = await ingestOnce(root, [await natwest()], async (_id, rows) => ((seen = rows), { imported: rows.length, alreadyImported: 0, waitingInReview: rows.length }), 20000, NOW);
    expect(rep.outcomes).toMatchObject([{ state: "imported", message: "Imported 2 new, 0 already known." }]);
    expect(seen.map((r) => [r.bookingDate, r.amountPence, r.payeeRaw])).toEqual([
      ["2026-09-26", 800, "Mobile top-up"],
      ["2026-09-25", -1477, "Lidl"],
    ]);
    expect(fs.readdirSync(path.join(root, "processed", "NatWest"))).toHaveLength(1);
    expect(fs.existsSync(path.join(root, "NatWest", "statement.pdf"))).toBe(false);
  });

  it("a PDF the reader refuses imports nothing and is kept in failed/ with the reason", async () => {
    const bad: Line[] = [{ date: "26 Sep", desc: "Pay", in: "£8.00" }, { date: "25 Sep", desc: "Lidl" }];
    drop("NatWest", "statement.pdf", makePdf([page(bad)]));
    let called = false;
    const rep = await ingestOnce(root, [await natwest()], async (...a) => ((called = true), ok(...a)), 20000, NOW);
    expect(called).toBe(false);
    expect(rep.outcomes[0]).toMatchObject({ state: "failed", message: expect.stringMatching(/no amount/i) });
    const kept = fs.readdirSync(path.join(root, "failed", "NatWest"));
    expect(kept.some((n) => n.endsWith("statement.pdf"))).toBe(true);
    expect(kept.some((n) => n.endsWith(".txt"))).toBe(true);
  });

  it("a PDF is not read with the columns saved from a CSV", async () => {
    const csv = "Date,Description,Amount\n05/10/2026,TESCO,-12.50\n";
    const g = guessMapping(csv, ",");
    const csvAccount: IngestAccount = { id: 1, names: ["NatWest"], mapping: { ...g, ...layoutOf(csv, g) } };
    drop("NatWest", "statement.pdf", makePdf([page(LINES)]));
    const rep = await ingestOnce(root, [csvAccount], ok, 20000, NOW);
    expect(rep.outcomes[0]).toMatchObject({ state: "failed", message: expect.stringMatching(/laid out differently/i) });
  });

  it("a file named .pdf that is not a PDF is read as text and fails like any bad CSV", async () => {
    drop("NatWest", "statement.pdf", "just some words\n");
    const rep = await ingestOnce(root, [await natwest()], ok, 20000, NOW);
    expect(rep.outcomes[0].state).toBe("failed");
  });
});
