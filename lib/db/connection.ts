import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// The encrypted driver (a fork that adds PRAGMA key/rekey) rather than
// plain better-sqlite3 - see lib/accounts-rules.ts and the plan for why:
// one file per user, keyed by a DEK only that user's login can unwrap.
// Verified directly (not assumed) that an already-constructed instance of
// this class works with drizzle-orm/better-sqlite3's query builder - its
// driver module does a top-level `require("better-sqlite3")` regardless
// (used only by drizzle's OWN connect-from-string convenience overload,
// which this app never calls), so the plain package stays a dependency
// purely to satisfy that import; its Database class is never instantiated.
import CipherDatabase from "better-sqlite3-multiple-ciphers";
import type { Database as PlainDatabase } from "better-sqlite3";

export type UserConn = {
  // Typed against plain better-sqlite3's Database, not the cipher class
  // directly - the two are structurally identical (verified; see the
  // comment above), and this is also the type the test harness's own
  // PLAIN (unencrypted, for speed - tests already cover encryption itself
  // in tests/user-db-connection.test.ts) connections use.
  sqlite: PlainDatabase;
  db: ReturnType<typeof drizzle<typeof schema>> & { $client: PlainDatabase };
};

/** Opens (creating if needed) one user's encrypted database file, applies
 * the same pragmas and migrations the single-user DB always has, and
 * returns a ready connection. `dekHex` is the already-unwrapped Data
 * Encryption Key (see lib/backup-crypto.ts's openSecret on the user's
 * sealed key) - callers never see it logged or persisted here. Throws
 * loudly on a wrong key (SqliteError "file is not a database"), never
 * silently returns an empty-looking DB. */
export function openUserDb(filePath: string, dekHex: string): UserConn {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sqlite = new CipherDatabase(filePath);
  // A raw (not passphrase-derived) key, so there's no internal KDF cost on
  // every open - the DEK is already high-entropy random bytes, sealed by
  // lib/backup-crypto.ts, not something a human ever has to remember.
  sqlite.pragma(`key="x'${dekHex}'"`);
  // Same reasoning as the single-user DB: WAL + NORMAL survives a crash,
  // only risks the last moments of writes on power loss, and is dramatically
  // faster on the Pi's SD card than the fsync-every-commit default.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  // Proves the key actually opened a real database before this connection
  // is handed out - PRAGMA key alone doesn't fail until the first real
  // read, which would otherwise surface later as a confusing query error
  // instead of here, at the one place that knows it's a key problem.
  sqlite.pragma("user_version");

  // Structurally the same shape as plain better-sqlite3's Database (this
  // package is an API-compatible fork, verified directly) - drizzle's own
  // types just name the other package, so this cast is the only mismatch,
  // not a real behavioral difference.
  const db = drizzle(sqlite as unknown as PlainDatabase, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  return { sqlite: sqlite as unknown as PlainDatabase, db };
}

export function closeUserDb(conn: UserConn) {
  conn.sqlite.close();
}
