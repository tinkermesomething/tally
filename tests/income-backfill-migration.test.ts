import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/** Builds a copy of drizzle/ with everything EXCEPT the migration(s) named
 * in `exclude` - lets a test land a database exactly at "migrated up to
 * 0038, nothing past it" before applying the real folder (0039 included)
 * on top, the same two-step shape a real pre-4.9.3 instance's database is
 * actually in: already migrated through 0038, about to see 0039 for the
 * first time. */
function migrationsFolderExcluding(exclude: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-migrations-"));
  const real = path.join(process.cwd(), "drizzle");
  fs.cpSync(real, dir, { recursive: true });
  for (const name of exclude) fs.rmSync(path.join(dir, name), { force: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.filter((e: { tag: string }) => !exclude.some((name) => name.startsWith(e.tag)));
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const metaDir = path.join(dir, "meta");
  for (const file of fs.readdirSync(metaDir)) {
    if (exclude.some((name) => file.startsWith(name.replace(/\.sql$/, "")))) fs.rmSync(path.join(metaDir, file));
  }
  return dir;
}

describe("0039_backfill_income_transactions - the v4.9.2 WAGES regression fix", () => {
  it("backfills past and current months, skips future months and months with a real transaction already", () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tally-db-")), "test.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("foreign_keys = ON");

    // Land the database exactly where a real pre-4.9.3 instance is: fully
    // migrated through 0038 (income_transactions exists, but empty).
    const upTo38 = migrationsFolderExcluding(["0039_backfill_income_transactions.sql"]);
    migrate(drizzle(sqlite), { migrationsFolder: upTo38 });

    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth() + 1;
    const pastYear = thisMonth > 1 ? thisYear : thisYear - 1;
    const pastMonth = thisMonth > 1 ? thisMonth - 1 : 12;
    const futureYear = thisMonth < 12 ? thisYear : thisYear + 1;
    const futureMonth = thisMonth < 12 ? thisMonth + 1 : 1;

    sqlite.exec(`INSERT INTO income_sources (id, name) VALUES (1, 'Wages')`);
    // A past month, never touched since - the exact symptom reported: this
    // should come back as WAGES for that month again.
    sqlite.exec(`INSERT INTO income_entries (income_source_id, year, month, amount_pence) VALUES (1, ${pastYear}, ${pastMonth}, 300000)`);
    // The current month - ambiguous (partially elapsed), but still
    // backfilled: matches exactly what v4.9.1 showed for "this month" too.
    sqlite.exec(`INSERT INTO income_entries (income_source_id, year, month, amount_pence) VALUES (1, ${thisYear}, ${thisMonth}, 150000)`);
    // A future month - a forward-looking budget guess, never received -
    // must NOT be backfilled, or every future month would show as fully
    // received on day one, the opposite bug.
    sqlite.exec(`INSERT INTO income_entries (income_source_id, year, month, amount_pence) VALUES (1, ${futureYear}, ${futureMonth}, 300000)`);
    // A past month that ALREADY has a real transaction (e.g. logged via
    // the now-fixed logIncome, or bank-synced, in the gap before this
    // backfill ran) - must be left alone, not double-counted on top.
    sqlite.exec(`INSERT INTO income_entries (income_source_id, year, month, amount_pence) VALUES (1, ${pastYear}, 1, 300000)`);
    sqlite.exec(
      `INSERT INTO income_transactions (income_source_id, year, month, amount_pence, entry_date, provisional) VALUES (1, ${pastYear}, 1, 50000, '${pastYear}-01-15', 0)`
    );

    // Now apply the REAL folder - 0000..0038 are already recorded as
    // applied (same content, same hash), so only 0039 actually runs.
    migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });

    const rows = sqlite.prepare(`SELECT year, month, amount_pence, provisional, entry_date FROM income_transactions ORDER BY year, month`).all() as {
      year: number;
      month: number;
      amount_pence: number;
      provisional: number;
      entry_date: string;
    }[];

    const forPeriod = (y: number, m: number) => rows.filter((r) => r.year === y && r.month === m);

    expect(forPeriod(pastYear, pastMonth)).toEqual([
      { year: pastYear, month: pastMonth, amount_pence: 300000, provisional: 0, entry_date: `${pastYear}-${String(pastMonth).padStart(2, "0")}-01` },
    ]);
    expect(forPeriod(thisYear, thisMonth)).toHaveLength(1);
    expect(forPeriod(thisYear, thisMonth)[0].amount_pence).toBe(150000);
    expect(forPeriod(futureYear, futureMonth)).toHaveLength(0); // never backfilled
    expect(forPeriod(pastYear, 1)).toEqual([
      // untouched - still just the one real 50000 row, not a second 300000 one on top
      { year: pastYear, month: 1, amount_pence: 50000, provisional: 0, entry_date: `${pastYear}-01-15` },
    ]);

    sqlite.close();
  });

  it("is a no-op on a fresh database with nothing to backfill", () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tally-db-")), "test.db");
    const sqlite = new Database(dbPath);
    migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    expect(sqlite.prepare(`SELECT count(*) as n FROM income_transactions`).get()).toEqual({ n: 0 });
    sqlite.close();
  });
});
