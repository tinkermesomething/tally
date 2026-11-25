import fs from "node:fs";
import path from "node:path";
import { decodeCsv } from "./csv-decode";
import { layoutStatus, mapCsvRows, ZERO_AMOUNT_REASON, type CsvMapping, type ParsedCsvRow } from "./csv-import";

/** The ingest folder: drop a bank's CSV into <folder>/<account name>/ and
 * Tally imports it. Everything here is plain files plus a few callbacks, no
 * database, so it is testable with a temp folder.
 *
 * Rules, all deliberate:
 * - The subfolder name picks the account. Nothing is guessed from the file.
 * - An account needs a saved column mapping (made by one manual import)
 *   before files are taken automatically. A wrong guess would import garbage.
 * - A file must be laid out like the one that mapping was confirmed on: the
 *   columns the mapping reads must still have the same names. A bank that
 *   reorders its columns would otherwise import numbers that parse but mean
 *   something else.
 * - A file is all-or-nothing: one unreadable row (bad date, bad amount) fails
 *   the whole file. Zero-amount lines are the exception: they have nothing to
 *   import and are skipped, then counted in the result.
 * - Nothing is ever deleted. Done files go to processed/, bad ones to failed/
 *   with a note saying why. */

export const PROCESSED_DIR = "processed";
export const FAILED_DIR = "failed";
const RESERVED = new Set([PROCESSED_DIR, FAILED_DIR]);

/** A file still being copied in keeps changing; leave it until it is quiet. */
export const SETTLE_MS = 15_000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type IngestAccount = { id: number; names: string[]; mapping: CsvMapping | null };

export type FoundFile = { folder: string; name: string; path: string; size: number; mtimeMs: number };

/** Compares folder names to account names: case, spacing and the characters
 * a folder name can't hold (: / \ ? * etc.) don't matter. */
export const foldName = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** `none: true` means no account has this name yet, so the person can create it from the file. */
export function matchAccount(folder: string, accounts: IngestAccount[]): { account: IngestAccount } | { reason: string; none?: true } {
  const key = foldName(folder);
  const hits = key ? accounts.filter((a) => a.names.some((n) => foldName(n) === key)) : [];
  if (hits.length === 1) return { account: hits[0] };
  if (hits.length > 1) return { reason: `More than one account is called "${folder}". Rename one of them.` };
  return { reason: `No account is called "${folder}" yet.`, none: true };
}

const isCsv = (name: string) => /\.csv$/i.test(name) && !name.startsWith(".");

/** CSV files one level down (<folder>/<account>/*.csv). Symlinks are never
 * followed. `strays` are CSVs dropped straight into the folder, which have
 * no account to go to. Throws if the folder itself can't be read. */
export function scanFolder(root: string): { files: FoundFile[]; strays: string[] } {
  const files: FoundFile[] = [];
  const strays: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isFile() && isCsv(entry.name)) {
      strays.push(entry.name);
      continue;
    }
    if (!entry.isDirectory() || RESERVED.has(entry.name.toLowerCase())) continue;
    const dir = path.join(/* turbopackIgnore: true */ root, entry.name);
    let inner: fs.Dirent[];
    try {
      inner = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of inner) {
      if (!f.isFile() || !isCsv(f.name)) continue;
      try {
        const st = fs.lstatSync(path.join(/* turbopackIgnore: true */ dir, f.name));
        files.push({ folder: entry.name, name: f.name, path: path.join(/* turbopackIgnore: true */ dir, f.name), size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        // gone between listing and reading; the next check sees the truth
      }
    }
  }
  return { files, strays };
}

/** A waiting file the person can fix on the spot: confirm its columns once.
 * `accountId` is the account that has the folder's name, or null to create it. */
export type SetupHint = { accountId: number | null };

export type Verdict =
  | { state: "ready"; account: IngestAccount }
  | { state: "settling" }
  | { state: "waiting"; reason: string; setup?: SetupHint }
  | { state: "failed"; reason: string };

/** What should happen to one file. Pure. "waiting" files are left where they
 * are until the person fixes the cause; "settling" ones are just too new. */
export function classify(file: FoundFile, accounts: IngestAccount[], now: number): Verdict {
  const match = matchAccount(file.folder, accounts);
  if ("reason" in match) return match.none ? { state: "waiting", reason: match.reason, setup: { accountId: null } } : { state: "waiting", reason: match.reason };
  if (!match.account.mapping) {
    return { state: "waiting", reason: `Tally doesn't know this account's columns yet.`, setup: { accountId: match.account.id } };
  }
  if (!match.account.mapping.headers) {
    return { state: "waiting", reason: `Confirm the columns once more, so Tally can tell if the bank changes the file later.`, setup: { accountId: match.account.id } };
  }
  if (now - file.mtimeMs < SETTLE_MS) return { state: "settling" };
  if (file.size === 0) return { state: "failed", reason: "The file is empty." };
  if (file.size > MAX_FILE_BYTES) return { state: "failed", reason: `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  return { state: "ready", account: match.account };
}

export type ImportSummary = { imported: number; alreadyImported: number; waitingInReview: number };
export type ImportRows = (accountId: number, rows: ParsedCsvRow[]) => Promise<ImportSummary>;

export type Outcome = { folder: string; name: string; state: "imported" | "failed" | "waiting" | "settling"; message: string };
export type IngestReport = { outcomes: Outcome[]; strays: string[] };

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const STAMPED = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(?:\d+-)?(.*)$/;

/** Undoes the name moveAway gives a filed file: when it was filed (UTC) and its original name. */
function unstamp(name: string, fallbackMs: number): { at: number; name: string } {
  const m = STAMPED.exec(name);
  if (!m) return { at: fallbackMs, name };
  return { at: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), name: m[7] };
}

/** Moves a file into <root>/<bucket>/<account folder>/, under a name that
 * can't clash with an earlier file. Returns the new path. */
function moveAway(root: string, bucket: string, file: FoundFile, now: number): string {
  const dir = path.join(/* turbopackIgnore: true */ root, bucket, file.folder);
  fs.mkdirSync(dir, { recursive: true });
  let dest = path.join(/* turbopackIgnore: true */ dir, `${stamp(now)}-${file.name}`);
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(/* turbopackIgnore: true */ dir, `${stamp(now)}-${n}-${file.name}`);
  try {
    fs.renameSync(file.path, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    fs.copyFileSync(file.path, dest);
    fs.rmSync(file.path);
  }
  return dest;
}

function fail(root: string, file: FoundFile, reason: string, now: number): Outcome {
  let message = reason;
  try {
    const dest = moveAway(root, FAILED_DIR, file, now);
    fs.writeFileSync(`${dest}.txt`, `${reason}\n`);
  } catch (err) {
    message = `${reason} (Could not move the file to ${FAILED_DIR}/: ${(err as Error).message})`;
  }
  return { folder: file.folder, name: file.name, state: "failed", message };
}

/** One pass over the folder: imports every ready file and files it away. */
export async function ingestOnce(root: string, accounts: IngestAccount[], importRows: ImportRows, maxRows: number, now: number = Date.now()): Promise<IngestReport> {
  const { files, strays } = scanFolder(root);
  const outcomes: Outcome[] = [];
  for (const file of files) {
    const verdict = classify(file, accounts, now);
    if (verdict.state === "settling") {
      outcomes.push({ folder: file.folder, name: file.name, state: "settling", message: "Still being copied. Checked again next time." });
      continue;
    }
    if (verdict.state === "waiting") {
      outcomes.push({ folder: file.folder, name: file.name, state: "waiting", message: verdict.reason });
      continue;
    }
    if (verdict.state === "failed") {
      outcomes.push(fail(root, file, verdict.reason, now));
      continue;
    }

    let buf: Buffer;
    try {
      buf = fs.readFileSync(file.path);
    } catch {
      // locked by whatever is writing it (Windows) - not a failure, just not yet
      outcomes.push({ folder: file.folder, name: file.name, state: "settling", message: "In use by another program. Checked again next time." });
      continue;
    }
    const { text } = decodeCsv(buf);
    if (text.includes("\0")) {
      outcomes.push(fail(root, file, "That doesn't look like a text CSV file.", now));
      continue;
    }

    const layout = layoutStatus(text, verdict.account.mapping!);
    if (layout.state === "changed") {
      outcomes.push(fail(root, file, `This file is laid out differently from the last one imported by hand. ${layout.reason} Nothing was imported. Import it by hand from Import CSV on the Review page, check the columns, and Tally learns the new layout.`, now));
      continue;
    }

    const mapped = mapCsvRows(text, verdict.account.mapping!);
    const unreadable = mapped.errors.filter((e) => e.reason !== ZERO_AMOUNT_REASON);
    const zeroLines = mapped.errors.length - unreadable.length;
    if (mapped.rows.length === 0 || unreadable.length > 0) {
      const first = unreadable.slice(0, 3).map((e) => `line ${e.line}: ${e.reason}`).join("; ");
      const reason = mapped.rows.length === 0 && unreadable.length === 0
        ? mapped.skipped.length > 0 ? "The file has only pending, reverted, declined or cancelled lines." : "The file has no transactions."
        : `${unreadable.length} line(s) can't be read with this account's saved columns (${first}). Nothing was imported. Has the bank changed its file layout? Import it by hand from Import CSV on the Review page.`;
      outcomes.push(fail(root, file, reason, now));
      continue;
    }
    if (mapped.rows.length > maxRows) {
      outcomes.push(fail(root, file, `The file has more than ${maxRows.toLocaleString()} rows. Split it in parts.`, now));
      continue;
    }

    let summary: ImportSummary;
    try {
      summary = await importRows(verdict.account.id, mapped.rows);
    } catch (err) {
      outcomes.push(fail(root, file, err instanceof Error ? err.message : "The import failed.", now));
      continue;
    }
    let message = `Imported ${summary.imported} new, ${summary.alreadyImported} already known.`;
    if (zeroLines > 0) message += ` Skipped ${zeroLines} line(s) with a zero amount.`;
    if (mapped.skipped.length > 0) message += ` Left out ${mapped.skipped.length} pending, reverted, declined or cancelled line(s).`;
    try {
      moveAway(root, PROCESSED_DIR, file, now);
    } catch (err) {
      // Safe: re-importing the same file never doubles rows (ids are stable).
      message += ` Could not move it to ${PROCESSED_DIR}/ (${(err as Error).message}); it is checked again next time.`;
    }
    outcomes.push({ folder: file.folder, name: file.name, state: "imported", message });
  }
  return { outcomes, strays };
}

/** What a check would do right now, without importing or moving anything:
 * the files waiting on the person, and the ones that will be taken. */
export function inspectFolder(root: string, accounts: IngestAccount[], now: number = Date.now()) {
  const { files, strays } = scanFolder(root);
  const waiting: { folder: string; name: string; reason: string; setup?: SetupHint }[] = [];
  let ready = 0;
  for (const f of files) {
    const v = classify(f, accounts, now);
    if (v.state === "waiting") waiting.push({ folder: f.folder, name: f.name, reason: v.reason, ...(v.setup && { setup: v.setup }) });
    else ready++;
  }
  return { ready, waiting, strays };
}

export type RecentFile = { bucket: "processed" | "failed"; folder: string; name: string; at: number; reason: string | null };

/** The newest files in processed/ and failed/, with the reason for each failure. */
export function recentFiles(root: string, limit = 8): RecentFile[] {
  const out: RecentFile[] = [];
  for (const bucket of [PROCESSED_DIR, FAILED_DIR] as const) {
    let accountDirs: fs.Dirent[];
    try {
      accountDirs = fs.readdirSync(path.join(/* turbopackIgnore: true */ root, bucket), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of accountDirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(/* turbopackIgnore: true */ root, bucket, d.name);
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!f.isFile() || f.name.endsWith(".txt")) continue;
        let reason: string | null = null;
        if (bucket === FAILED_DIR) {
          try {
            reason = fs.readFileSync(path.join(/* turbopackIgnore: true */ dir, `${f.name}.txt`), "utf8").trim();
          } catch {
            reason = null;
          }
        }
        const original = unstamp(f.name, fs.lstatSync(path.join(/* turbopackIgnore: true */ dir, f.name)).mtimeMs);
        out.push({ bucket, folder: d.name, name: original.name, at: original.at, reason });
      }
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}
