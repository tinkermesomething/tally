import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isCsvMapping } from "./csv-import";
import { isDesktopMode } from "./desktop/mode";
import { getBankAccounts } from "./db/bank-sync";
import { importCsvTransactions, MAX_CSV_ROWS } from "./db/csv-import";
import { runWithUserDb } from "./db/context";
import { getOrOpenUserDb } from "./db/pool";
import { getIngestStored } from "./db/settings";
import { listUsers } from "./db/users";
import { openDek, dekToHex } from "./user-dek";
import { decodeCsv } from "./csv-decode";
import { ingestOnce, inspectFolder, MAX_FILE_BYTES, recentFiles, scanFolder, type IngestAccount, type IngestReport } from "./ingest";
import { isOn, parseStored, resolveLocation, type Location } from "./ingest-settings";

/** Runs the ingest folder for one person: reads their saved choices, finds
 * their folder, imports what is ready. Must run inside their database
 * context (a request, or runWithUserDb in the loop below). */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const BOOT_CHECK_DELAY_MS = 60 * 1000;

export type IngestEnv = { desktop: boolean; email: string; env: Record<string, string | undefined> };
const here = (email: string): IngestEnv => ({ desktop: isDesktopMode(), email, env: process.env });

async function loadAccounts(): Promise<IngestAccount[]> {
  return (await getBankAccounts()).map((a) => {
    let mapping = null;
    try {
      const parsed = a.csvMapping ? JSON.parse(a.csvMapping) : null;
      mapping = isCsvMapping(parsed) ? parsed : null;
    } catch {
      mapping = null;
    }
    return { id: a.id, names: [a.alias, a.displayName].filter((n): n is string => !!n), mapping };
  });
}

const folderState = (dir: string): "ok" | "missing" => {
  try {
    return fs.statSync(dir).isDirectory() ? "ok" : "missing";
  } catch {
    return "missing";
  }
};

export type RunResult = { state: "off" | "unset" | "missing" | "busy"; problem: string | null; dir: string | null } | { state: "ran"; dir: string; report: IngestReport };

// On globalThis because Next can load this file twice (instrumentation and
// server actions are bundled apart); one lock must cover both.
const running: Set<string> = ((globalThis as { __tallyIngestRunning?: Set<string> }).__tallyIngestRunning ??= new Set());

/** One check for the current person. */
export async function runIngest(email: string, now: number = Date.now()): Promise<RunResult> {
  const stored = parseStored(await getIngestStored());
  if (!isOn(stored)) return { state: "off", problem: null, dir: null };
  const loc = resolveLocation({ ...here(email), stored });
  if (!loc.dir) return { state: "unset", problem: loc.problem, dir: null };
  if (folderState(loc.dir) !== "ok") return { state: "missing", problem: null, dir: loc.dir };
  if (running.has(loc.dir)) return { state: "busy", problem: null, dir: loc.dir };
  running.add(loc.dir);
  try {
    const report = await ingestOnce(
      loc.dir,
      await loadAccounts(),
      async (accountId, rows) => {
        const r = await importCsvTransactions(accountId, rows.map(({ bookingDate, amountPence, payeeRaw, idHint }) => ({ bookingDate, amountPence, payeeRaw, idHint })), { duplicatePolicy: "flag" });
        return { imported: r.imported, alreadyImported: r.alreadyImported, waitingInReview: r.waitingInReview };
      },
      MAX_CSV_ROWS,
      now
    );
    return { state: "ran", dir: loc.dir, report };
  } finally {
    running.delete(loc.dir);
  }
}

/** What Settings shows: where the folder is, whether it works, what is
 * waiting, and what happened to recent files. Changes nothing. */
export async function ingestStatus(email: string) {
  const stored = parseStored(await getIngestStored());
  const loc: Location = resolveLocation({ ...here(email), stored });
  const base = { desktop: isDesktopMode(), on: isOn(stored), dir: loc.dir, problem: loc.problem, savedDir: stored.dir ?? null, suggestion: suggestDesktopDir() };
  if (!loc.dir) return { ...base, folder: "unset" as const };
  if (folderState(loc.dir) !== "ok") return { ...base, folder: "missing" as const };
  const seen = inspectFolder(loc.dir, await loadAccounts());
  return { ...base, folder: "ok" as const, ...seen, recent: recentFiles(loc.dir) };
}

/** The text of one waiting file, for the "Set up this account" dialog. Only
 * a file the folder scan itself lists is read, so the names the browser sends
 * can't point anywhere else. */
export async function readIngestFile(email: string, folder: string, name: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const loc: Location = resolveLocation({ ...here(email), stored: parseStored(await getIngestStored()) });
  if (!loc.dir || folderState(loc.dir) !== "ok") return { ok: false, error: "The ingest folder isn't available." };
  const found = scanFolder(loc.dir).files.find((f) => f.folder === folder && f.name === name);
  if (!found) return { ok: false, error: "That file is gone. Click Check now to refresh the list." };
  if (found.size > MAX_FILE_BYTES) return { ok: false, error: `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  const text = decodeCsv(new Uint8Array(fs.readFileSync(found.path))).text;
  return text.trim() ? { ok: true, text } : { ok: false, error: "The file is empty." };
}

/** A starting point for the desktop folder: a visible one in the person's home, not the app's hidden data folder. */
function suggestDesktopDir(): string | null {
  return isDesktopMode() ? path.join(/* turbopackIgnore: true */ os.homedir(), "Tally ingest") : null;
}

async function checkEveryone() {
  try {
    for (const user of await listUsers()) {
      if (user.disabledAt || !user.oidcSub || !user.dekSealed) continue;
      try {
        const conn = getOrOpenUserDb(user.id, dekToHex(openDek(user.dekSealed, user.oidcSub)));
        const result = await runWithUserDb(conn, () => runIngest(user.email));
        if (result.state !== "ran") continue;
        for (const o of result.report.outcomes) {
          if (o.state === "imported" || o.state === "failed") console.log(`[ingest] user ${user.id}: ${o.folder}/${o.name}: ${o.state}. ${o.message}`);
        }
      } catch (err) {
        console.error(`[ingest] user ${user.id} failed:`, err);
      }
    }
  } catch (err) {
    console.error("[ingest] check failed:", err);
  }
}

let started = false;

/** Desktop: one check shortly after the app starts (and the "Check now"
 * button after that). Self-hosted: a check every 15 minutes, but only when
 * the administrator has mapped INGEST_DIR. Safe to call more than once. */
export function startIngest() {
  if (started) return;
  if (isDesktopMode()) {
    started = true;
    setTimeout(checkEveryone, BOOT_CHECK_DELAY_MS / 3);
  } else if (process.env.INGEST_DIR?.trim()) {
    started = true;
    setTimeout(checkEveryone, BOOT_CHECK_DELAY_MS);
    setInterval(checkEveryone, CHECK_INTERVAL_MS);
  }
}
