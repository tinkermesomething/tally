import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";
import { enterUserDb } from "@/lib/db/context";
import { getSystemConn } from "@/lib/db/system-connection";
import { closeAllForTests } from "@/lib/db/pool";
import type { UserConn } from "@/lib/db/connection";

// Plain (unencrypted) connections for the whole test suite - deliberately
// NOT lib/db/connection.ts's openUserDb: encryption itself is already
// proven in tests/user-db-connection.test.ts, and every other test here is
// about this app's own logic, not the cipher - a plain connection is
// simpler and faster for ~400 tests that don't care either way.
function openPlainTestDb(databasePath: string): UserConn {
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as UserConn["db"];
  return { sqlite: sqlite as unknown as UserConn["sqlite"], db };
}

// One real connection per test FILE (matches `migrated`'s own "once per
// file" scope below) - not one per test, which would reopen the same
// sqlite file on every single `it()` for no benefit.
let conn: UserConn | null = null;
let migrated = false;

/** Applies the real migrations once per test file, then empties every table
 * so each test starts from a blank DB. Also (re-)establishes the active
 * per-connection context for whatever runs next (see lib/db/context.ts's
 * enterUserDb) - called again on every test, not just once, since
 * there's no single guarantee that Node's AsyncLocalStorage context set in
 * one `it()` is still the active one by the time the next `it()` runs
 * (nothing in this app relies on that holding; re-entering it is free). */
export function resetDb() {
  conn ??= openPlainTestDb(process.env.DATABASE_PATH ?? ":memory:");
  enterUserDb(conn);
  if (!migrated) {
    migrate(conn.db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    migrated = true;
  }
  conn.sqlite.pragma("foreign_keys = OFF");
  const tables = conn.sqlite
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'")
    .all() as { name: string }[];
  for (const { name } of tables) conn.sqlite.exec(`delete from "${name}"`);
  conn.sqlite.pragma("foreign_keys = ON");

  // The keystore (lib/db/system-connection.ts) is a SEPARATE cached
  // connection - `users`/`auditLog` live there, not on `conn` above, so it
  // needs its own clear too, or state (a disabled user, a re-linked sub)
  // would leak from one test into the next within the same file.
  const sys = getSystemConn();
  sys.sqlite.pragma("foreign_keys = OFF");
  const sysTables = sys.sqlite
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'")
    .all() as { name: string }[];
  for (const { name } of sysTables) sys.sqlite.exec(`delete from "${name}"`);
  sys.sqlite.pragma("foreign_keys = ON");

  // Any real per-user encrypted connection a previous test opened (via
  // resolveAndEnterCurrentUser) must not leak into the next one - each
  // test that needs one gets a fresh user id (users.id is a real
  // AUTOINCREMENT, never reused even after the delete above) and so would
  // open a distinct file regardless, but closing here avoids piling up
  // open file handles across a whole file's worth of tests.
  closeAllForTests();
}
