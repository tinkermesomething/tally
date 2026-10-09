import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import CipherDatabase from "better-sqlite3-multiple-ciphers";
import { eq } from "drizzle-orm";
import { getSystemConn } from "../lib/db/system-connection";
import { users } from "../lib/db/schema";
import { openUserDb } from "../lib/db/connection";
import { openDek, dekToHex } from "../lib/user-dek";

/**
 * One-time move of the original single-admin app's data (the shared,
 * unencrypted DATABASE_PATH file) into the admin's own new encrypted
 * per-user file - see the security-hardening plan's step 7 checkpoint.
 *
 * Run via `npx tsx scripts/migrate-to-per-user.ts` (never over HTTP - same
 * "docker exec, not a route" posture as the break-glass script). Requires:
 *   - the admin has already signed in at least once under the NEW
 *     multi-user flow (so their real OIDC `sub` and sealed DEK are on file -
 *     this script has no way to mint a sub that a later real login would
 *     ever match, so running it before that first login would seal the key
 *     to a value nothing can ever open again)
 *   - ALLOWED_EMAIL identifies that admin, same as the app itself uses
 *   - their per-user file is still empty (refuses otherwise - never merges
 *     into, or silently overwrites, real data they've already entered
 *     under the new system)
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

async function main() {
  const legacyPath = process.env.DATABASE_PATH ?? "./config/tally.db";
  const allowedEmail = process.env.ALLOWED_EMAIL;
  if (!allowedEmail) throw new Error("ALLOWED_EMAIL is not set - can't tell which account should receive this data.");
  if (!fs.existsSync(legacyPath)) throw new Error(`No legacy database at ${legacyPath}.`);

  const sys = getSystemConn();
  const admin = await sys.db.query.users.findFirst({ where: eq(users.email, allowedEmail) });
  if (!admin) throw new Error(`No account for ${allowedEmail} yet - they need to sign in once under the new login before this can run.`);
  if (!admin.oidcSub || !admin.dekSealed) {
    throw new Error(`${allowedEmail}'s account exists but has never completed a real login (no sub/key on file) - sign in first, then re-run this.`);
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

  const dek = openDek(admin.dekSealed, admin.oidcSub);
  const dest = openUserDb(userFileFor(admin.id), dekToHex(dek));
  const sqlite = dest.sqlite as unknown as CipherDatabase.Database;

  // app_settings is excluded from this check on purpose: getAppSettings()
  // auto-creates its one default row the moment the app is opened even
  // once (confirmed - that's exactly what happened here), before any real
  // data exists. That default row is overwritten below, not merged into -
  // every OTHER table still has to be genuinely empty.
  const destTablesBefore = tablesOf(sqlite, "main").filter((t) => t !== "app_settings");
  const nonEmpty = destTablesBefore.filter((t) => countOf(sqlite, "main", t) > 0);
  if (nonEmpty.length > 0) {
    sqlite.close();
    throw new Error(`${allowedEmail}'s per-user file already has data in ${nonEmpty.join(", ")} - refusing to migrate into a non-empty file.`);
  }

  // ATTACH is plain SQL, not a PRAGMA - KEY '' tells the cipher driver the
  // attached file itself is unencrypted (verified directly beforehand:
  // confirmed this works for a plain SQLite file attached to an encrypted
  // main connection, not assumed from how SQLCipher's docs describe it).
  sqlite.exec(`ATTACH DATABASE '${legacyPath.replace(/'/g, "''")}' AS legacy_src KEY ''`);
  // Foreign keys can only be toggled outside a transaction (same reason
  // lib/db/backup.ts's restoreFromFile does this) - tables aren't inserted
  // in dependency order, so this is checked once with foreign_key_check
  // below instead of per-row during the copy.
  sqlite.pragma("foreign_keys = OFF");
  try {
    const report: { table: string; rows: number; sumPence: number | null }[] = [];

    const run = sqlite.transaction(() => {
      for (const table of legacyTables) {
        // The one exception to "destination is empty" - see the check
        // above for why app_settings' auto-created default row is cleared
        // here instead of refused earlier.
        if (table === "app_settings") sqlite.exec("delete from main.app_settings");
        const have = new Set(columnsOf(sqlite, table, "legacy_src"));
        const mine = columnsOf(sqlite, table, "main").filter((c) => have.has(c));
        const list = mine.map(quote).join(", ");
        sqlite.exec(`insert into main.${quote(table)} (${list}) select ${list} from legacy_src.${quote(table)}`);
      }
      // Autoincrement counters carry on from where the legacy data left off.
      // app_settings' own default-row insert (above) already created a
      // sqlite_sequence row for it - deleted first, or the legacy one
      // below would duplicate it instead of replacing it.
      const hasSeq = sqlite.prepare("select 1 from legacy_src.sqlite_master where name = 'sqlite_sequence'").get();
      if (hasSeq) {
        const names = legacyTables.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
        sqlite.exec(`delete from main.sqlite_sequence where name in (${names})`);
        sqlite.exec(`insert into main.sqlite_sequence (name, seq) select name, seq from legacy_src.sqlite_sequence where name in (${names})`);
      }

      for (const table of legacyTables) {
        const gotRows = countOf(sqlite, "main", table);
        const gotSum = sumPenceOf(sqlite, "main", table);
        if (gotRows !== legacyCounts[table]) {
          throw new Error(`Row count mismatch in ${table}: legacy had ${legacyCounts[table]}, copy has ${gotRows}.`);
        }
        if (gotSum !== legacySums[table]) {
          throw new Error(`amount_pence sum mismatch in ${table}: legacy had ${legacySums[table]}, copy has ${gotSum}.`);
        }
        report.push({ table, rows: gotRows, sumPence: gotSum });
      }

      const broken = sqlite.pragma("foreign_key_check") as unknown[];
      if (broken.length > 0) throw new Error("The copied data has broken foreign-key links - not committing.");
    });
    run();

    console.log(`Migrated ${allowedEmail}'s data into ${userFileFor(admin.id)}:\n`);
    for (const { table, rows, sumPence } of report) {
      console.log(`  ${table}: ${rows} rows${sumPence !== null ? `, amount_pence sum ${sumPence}` : ""}`);
    }
    console.log(`\nLegacy file (${legacyPath}) is untouched. Open the app and check Grid/Reports match before deleting it.`);
  } finally {
    sqlite.exec("DETACH DATABASE legacy_src");
    sqlite.close();
  }
}

function userFileFor(userId: number): string {
  const dir = process.env.USERS_DB_DIR?.trim() || path.join(path.dirname(process.env.DATABASE_PATH ?? "./config/tally.db"), "users");
  return path.join(dir, `${userId}.db`);
}

main().catch((err) => {
  console.error("[migrate-to-per-user] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
