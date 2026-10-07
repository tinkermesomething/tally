import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATABASE_PATH, inTransaction, sqlite } from "./index";

/** Backup and restore of the whole database file. */

export const MAX_RESTORE_BYTES = 200 * 1024 * 1024;
const KEEP_SAFETY_COPIES = 5;

/** Where the automatic "before restore" copies are kept: the backup folder
 * when one is configured (BACKUP_DIR), otherwise next to the database, so
 * they live on a persistent volume either way. */
export function backupDir() {
  const configured = process.env.BACKUP_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(path.dirname(path.resolve(DATABASE_PATH)), "backups");
}

/** A consistent copy of the live database (safe while it is being written
 * to, WAL included) - SQLite's own online backup, not a raw file copy. */
export async function writeBackup(dest: string) {
  await sqlite.backup(dest);
}

export type RestoreResult = { tables: number; rows: number; safetyBackup: string };

type Pragmas = { name: string }[];
const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;
const userTables = (conn: Database.Database) =>
  (conn.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'").all() as Pragmas).map((t) => t.name);
const columnsOf = (conn: Database.Database, table: string, schema = "main") =>
  (conn.prepare(`select name from pragma_table_info(?, ?)`).all(table, schema) as Pragmas).map((c) => c.name);

/** Checks that `file` is a healthy Tally database this version can take.
 * Throws a plain-words reason if not. Opens it read-only on its own
 * connection, so nothing is touched. */
function assertRestorable(file: string) {
  let probe: Database.Database;
  try {
    probe = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    throw new Error("That file isn't a Tally backup.");
  }
  try {
    let integrity: unknown;
    try {
      integrity = probe.pragma("integrity_check", { simple: true });
    } catch {
      throw new Error("That file isn't a Tally backup.");
    }
    if (integrity !== "ok") throw new Error("That backup file is damaged, so it was not restored.");
    const theirs = new Set(userTables(probe));
    if (!theirs.has("categories") || !theirs.has("app_settings")) throw new Error("That file isn't a Tally backup.");
    // A backup from a NEWER version has columns this one doesn't know: restoring it would silently drop data.
    for (const table of userTables(sqlite)) {
      if (!theirs.has(table)) continue;
      const known = new Set(columnsOf(sqlite, table));
      const extra = columnsOf(probe, table).filter((c) => !known.has(c));
      if (extra.length > 0) throw new Error("That backup was made by a newer version of Tally. Update Tally first, then restore it.");
    }
  } finally {
    probe.close();
  }
}

/** Replaces ALL the app's data with the contents of the backup file.
 *
 * Safe by design: the file is validated first; a copy of the current data is
 * saved before anything changes; and the swap is one transaction, so any
 * failure leaves the current data exactly as it was. An older backup is
 * fine (columns it lacks get their defaults); a newer one is refused. */
export async function restoreFromFile(file: string): Promise<RestoreResult> {
  if (fs.statSync(file).size > MAX_RESTORE_BYTES) throw new Error("That file is too large to be a Tally backup.");
  assertRestorable(file);

  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safetyBackup = path.join(dir, `pre-restore-${stamp}.db`);
  await sqlite.backup(safetyBackup);
  const old = fs.readdirSync(dir).filter((f) => f.startsWith("pre-restore-")).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_SAFETY_COPIES))) fs.rmSync(path.join(dir, f), { force: true });

  // Foreign keys can only be switched off outside a transaction; the whole
  // swap is checked with foreign_key_check before it commits instead.
  sqlite.pragma("foreign_keys = OFF");
  sqlite.prepare("ATTACH DATABASE ? AS restore_src").run(file);
  try {
    let tables = 0;
    let rows = 0;
    await inTransaction(async () => {
      const theirs = new Set(
        (sqlite.prepare("select name from restore_src.sqlite_master where type = 'table'").all() as Pragmas).map((t) => t.name)
      );
      for (const table of userTables(sqlite)) {
        sqlite.exec(`delete from main.${quote(table)}`);
        if (!theirs.has(table)) continue;
        const have = new Set(columnsOf(sqlite, table, "restore_src"));
        const cols = columnsOf(sqlite, table).filter((c) => have.has(c));
        const list = cols.map(quote).join(", ");
        sqlite.exec(`insert into main.${quote(table)} (${list}) select ${list} from restore_src.${quote(table)}`);
        tables++;
        rows += (sqlite.prepare(`select count(*) as n from main.${quote(table)}`).get() as { n: number }).n;
      }
      // Autoincrement counters, so new ids carry on after the restored ones.
      sqlite.exec("delete from main.sqlite_sequence");
      const hasSeq = sqlite.prepare("select 1 from restore_src.sqlite_master where name = 'sqlite_sequence'").get();
      if (hasSeq) {
        const live = userTables(sqlite).map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
        sqlite.exec(`insert into main.sqlite_sequence (name, seq) select name, seq from restore_src.sqlite_sequence where name in (${live})`);
      }
      const broken = sqlite.pragma("foreign_key_check") as unknown[];
      if (broken.length > 0) throw new Error("That backup has links between records that don't match up, so it was not restored.");
    });
    return { tables, rows, safetyBackup };
  } finally {
    sqlite.exec("DETACH DATABASE restore_src");
    sqlite.pragma("foreign_keys = ON");
  }
}
