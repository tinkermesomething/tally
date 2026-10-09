import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import type { UserConn } from "./connection";

/** The one shared, UNENCRYPTED database this app has always had, before
 * any of it is per-user - opened once, lazily, and reused. Every real entry
 * point (requireSession, apiRoute, each page, the background jobs) calls
 * this today, which is deliberate: it keeps the live single-admin app
 * working exactly as it always has while the NEW connection-context
 * plumbing (lib/db/context.ts, lib/db/connection.ts, lib/db/pool.ts) gets
 * wired to every one of those entry points first, proven not to change any
 * existing behaviour, before the riskier swap - replacing this one
 * function's body with a real per-user encrypted lookup - which the plan
 * deliberately does LAST, after the live-data migration, as its own
 * checkpoint. Nothing else in this file should need to change for that
 * swap to happen. */

let cached: UserConn | null = null;

export function getLegacyConn(): UserConn {
  if (cached) return cached;
  const databasePath = process.env.DATABASE_PATH ?? "./config/tally.db";
  const sqlite = new Database(databasePath);
  // Same pragmas the original singleton always used (lib/db/index.ts,
  // before this file existed) - see its own comment, carried over
  // unchanged: WAL + NORMAL survives a crash and is dramatically faster on
  // the Pi's SD card than fsync-every-commit.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  cached = { sqlite: sqlite as unknown as UserConn["sqlite"], db: db as unknown as UserConn["db"] };
  return cached;
}
