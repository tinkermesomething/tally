import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export /** Builds a copy of drizzle/ truncated to end at `lastTag` (inclusive) -
 * lets a test land a database exactly at "migrated up to 0038, nothing past
 * it" before applying the real folder on top. Truncating by POSITION, not
 * by excluding a named file: drizzle's migrator picks up new migrations by
 * comparing each one's journal timestamp against the latest one already
 * applied, not by per-file hash - so excluding just 0039 while leaving a
 * LATER migration in place would let that later one apply first, pushing
 * the watermark past 0039 and permanently skipping it. Truncating avoids
 * that regardless of how many migrations exist after `lastTag`. */
function migrationsFolderUpTo(lastTag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-migrations-"));
  const real = path.join(process.cwd(), "drizzle");
  fs.cpSync(real, dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const cutoffIdx = journal.entries.find((e: { tag: string }) => e.tag === lastTag)?.idx;
  if (cutoffIdx === undefined) throw new Error(`No migration tagged "${lastTag}"`);
  const dropped = journal.entries.filter((e: { idx: number }) => e.idx > cutoffIdx);
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= cutoffIdx);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const metaDir = path.join(dir, "meta");
  for (const { tag } of dropped) {
    fs.rmSync(path.join(dir, `${tag}.sql`), { force: true });
    for (const file of fs.readdirSync(metaDir)) {
      if (file.startsWith(tag.split("_")[0])) fs.rmSync(path.join(metaDir, file));
    }
  }
  return dir;
}
