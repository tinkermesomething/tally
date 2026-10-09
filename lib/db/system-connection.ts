import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import type { UserConn } from "./connection";

/** The identity keystore (`users`) and the audit log - always open,
 * unencrypted, shared across everyone, and NEVER a per-user encrypted
 * file. This is deliberate, not an oversight: resolving an OIDC login to
 * an account means looking up `users` BEFORE any per-user key is known -
 * if that table lived inside a per-user encrypted file, there'd be no way
 * to even find out whose key to use (the keystore can't be locked behind
 * the very thing it's used to unlock). The audit log sits here too, for
 * the same reason (a rejected sign-in has no per-user context yet) and so
 * there's one unified trail across every user, not one per file.
 *
 * Reuses the SAME schema/migrations as every per-user file (a deliberate
 * simplification over maintaining two separate migration histories) - in
 * practice this means every budget table (categories, expenses, etc.) also
 * technically exists here, unused and always empty; nothing in the
 * application ever queries them through this connection. lib/db/users.ts
 * and lib/audit.ts are the only two callers - they use this directly, by
 * name, never the ambient per-request `db` (lib/db/index.ts), since an
 * admin action's OWN per-user context must never be mistaken for the
 * shared keystore. */

let cached: UserConn | null = null;

export function systemDbPath(): string {
  return process.env.SYSTEM_DB_PATH?.trim() || path.join(path.dirname(process.env.DATABASE_PATH ?? "./config/tally.db"), "system.db");
}

export function getSystemConn(): UserConn {
  if (cached) return cached;
  const sqlite = new Database(systemDbPath());
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  cached = { sqlite: sqlite as unknown as UserConn["sqlite"], db: db as unknown as UserConn["db"] };
  return cached;
}
