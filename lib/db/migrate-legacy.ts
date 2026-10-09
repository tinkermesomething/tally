import fs from "node:fs";
import Database from "better-sqlite3";
import { sqlite } from "./index";

/**
 * One-time move of the original single-user app's data (the shared,
 * unencrypted DATABASE_PATH file) into the CURRENTLY SIGNED-IN user's own
 * encrypted per-user file - the in-app sibling of scripts/migrate-to-per-
 * user.ts, built because production runs Next's minimal `standalone`
 * output (no tsx, no source files, nothing to `docker exec` into - see
 * that script's own comment, written when `docker exec` still seemed
 * viable). Triggered from Settings > Account, which already means the
 * caller is signed in and `sqlite`/`db` (lib/db/index.ts) already resolve
 * to THEIR OWN connection - no DEK handling needed here at all, unlike the
 * standalone script, which has to open that connection itself from cold.
 * Not admin-gated: it only ever moves YOUR OWN legacy data into YOUR OWN
 * account, and the empty-destination check below already refuses to touch
 * an account that isn't a fresh one.
 *
 * Copies every budget-domain table; deliberately never touches `users` or
 * `audit_log` (keystore-only, never part of a per-user file's real data).
 * Verifies row counts AND amount_pence sums match after the copy, inside
 * the same transaction that would roll back on any mismatch. Leaves the
 * original legacy file untouched - deleting it is a separate, deliberate
 * step for later, once the result's been checked in the running app too.
 */

const EXCLUDED_TABLES = new Set(["users", "audit_log"]);

type Row = { name: string };
const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;
const tablesOf = (conn: Database.Database, schema: string) =>
  (conn.prepare(`select name from ${schema}.sqlite_master where type = 'table'`).all() as Row[])
    .map((t) => t.name)
    .filter((name) => !name.startsWith("sqlite_") && !name.startsWith("__drizzle") && !EXCLUDED_TABLES.has(name));
const columnsOf = (conn: Database.Database, table: string, schema: string) =>
  (conn.prepare(`select name from pragma_table_info(?, ?)`).all(table, schema) as { name: string }[]).map((c) => c.name);
const countOf = (conn: Database.Database, schema: string, table: string) =>
  (conn.prepare(`select count(*) as n from ${schema}.${quote(table)}`).get() as { n: number }).n;
const sumPenceOf = (conn: Database.Database, schema: string, table: string) => {
  const cols = columnsOf(conn, table, schema);
  if (!cols.includes("amount_pence")) return null;
  return (conn.prepare(`select coalesce(sum(amount_pence), 0) as s from ${schema}.${quote(table)}`).get() as { s: number }).s;
};

export type MigrateLegacyRow = { table: string; rows: number; sumPence: number | null };

/** Returns `migrated: false` (not an error) for the two cases that just
 * mean "nothing to do here" - no legacy file (already migrated and
 * cleaned up, or a deployment that never had one), or a destination
 * that's already been migrated into. Everything else throws, same as the
 * standalone script - a real problem here should stop the admin, not get
 * silently swallowed. */
export async function migrateLegacyDataForCurrentUser(): Promise<
  { migrated: true; report: MigrateLegacyRow[] } | { migrated: false; reason: string }
> {
  const legacyPath = process.env.DATABASE_PATH ?? "./config/tally.db";
  if (!fs.existsSync(legacyPath)) {
    return { migrated: false, reason: "No legacy database file found - there's nothing to migrate." };
  }

  // Read-only probe of the legacy file first - fails loud before anything
  // is opened for writing if this isn't actually a Tally database.
  const probe = new Database(legacyPath, { readonly: true, fileMustExist: true });
  let legacyTables: string[];
  let legacyCounts: Record<string, number>;
  let legacySums: Record<string, number | null>;
  try {
    if (probe.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error("The legacy database failed its own integrity check - not migrating a damaged file.");
    }
    legacyTables = tablesOf(probe, "main");
    legacyCounts = Object.fromEntries(legacyTables.map((t) => [t, countOf(probe, "main", t)]));
    legacySums = Object.fromEntries(legacyTables.map((t) => [t, sumPenceOf(probe, "main", t)]));
  } finally {
    probe.close();
  }

  // The caller's OWN already-open connection - established by
  // withCurrentUser/requireSession before this ever runs (see
  // app/settings/users-actions.ts's migrateLegacyDataAction).
  const dest = sqlite;

  // app_settings is excluded from this check on purpose: getAppSettings()
  // auto-creates its one default row the moment the app is opened even
  // once, before any real data exists. That default row is overwritten
  // below, not merged into - every OTHER table still has to be genuinely
  // empty, so this never clobbers real data someone's already entered
  // under the new per-user system.
  const destTablesBefore = tablesOf(dest, "main").filter((t) => t !== "app_settings");
  const nonEmpty = destTablesBefore.filter((t) => countOf(dest, "main", t) > 0);
  if (nonEmpty.length > 0) {
    return { migrated: false, reason: `Your account already has data in ${nonEmpty.join(", ")} - refusing to migrate into a non-empty account.` };
  }

  // ATTACH is plain SQL, not a PRAGMA - KEY '' tells the cipher driver the
  // attached file itself is unencrypted (verified directly, not assumed).
  dest.exec(`ATTACH DATABASE '${legacyPath.replace(/'/g, "''")}' AS legacy_src KEY ''`);
  // Foreign keys can only be toggled outside a transaction; checked once
  // with foreign_key_check below instead, same as lib/db/backup.ts's
  // restoreFromFile - tables aren't inserted in dependency order.
  dest.pragma("foreign_keys = OFF");
  try {
    const report: MigrateLegacyRow[] = [];

    const run = dest.transaction(() => {
      for (const table of legacyTables) {
        if (table === "app_settings") dest.exec("delete from main.app_settings");
        const have = new Set(columnsOf(dest, table, "legacy_src"));
        const mine = columnsOf(dest, table, "main").filter((c) => have.has(c));
        const list = mine.map(quote).join(", ");
        dest.exec(`insert into main.${quote(table)} (${list}) select ${list} from legacy_src.${quote(table)}`);
      }
      const hasSeq = dest.prepare("select 1 from legacy_src.sqlite_master where name = 'sqlite_sequence'").get();
      if (hasSeq) {
        const names = legacyTables.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
        dest.exec(`delete from main.sqlite_sequence where name in (${names})`);
        dest.exec(`insert into main.sqlite_sequence (name, seq) select name, seq from legacy_src.sqlite_sequence where name in (${names})`);
      }

      for (const table of legacyTables) {
        const gotRows = countOf(dest, "main", table);
        const gotSum = sumPenceOf(dest, "main", table);
        if (gotRows !== legacyCounts[table]) {
          throw new Error(`Row count mismatch in ${table}: legacy had ${legacyCounts[table]}, copy has ${gotRows}.`);
        }
        if (gotSum !== legacySums[table]) {
          throw new Error(`amount_pence sum mismatch in ${table}: legacy had ${legacySums[table]}, copy has ${gotSum}.`);
        }
        report.push({ table, rows: gotRows, sumPence: gotSum });
      }

      const broken = dest.pragma("foreign_key_check") as unknown[];
      if (broken.length > 0) throw new Error("The copied data has broken foreign-key links - not committing.");
    });
    run();

    return { migrated: true, report };
  } finally {
    dest.exec("DETACH DATABASE legacy_src");
  }
}
