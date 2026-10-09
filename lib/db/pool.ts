import path from "node:path";
import { closeUserDb, openUserDb, type UserConn } from "./connection";

/** Open connections, kept across requests so a user's file isn't reopened
 * (and re-migrated) on every single action call - opening is real disk I/O
 * plus a migration check, not something to repeat per request. Closed on
 * sign-out or an idle timeout (lib/db/idle.ts, a later step) - never kept
 * open forever just because a user logged in once. */
const open = new Map<number, UserConn>();

export function usersDbDir(): string {
  return process.env.USERS_DB_DIR?.trim() || path.join(path.dirname(process.env.DATABASE_PATH ?? "./config/tally.db"), "users");
}

/** Exported for lib/db/users.ts's deleteUser - the one other place that
 * needs this user's file path without opening a connection to it. */
export function fileFor(userId: number): string {
  return path.join(usersDbDir(), `${userId}.db`);
}

/** The given user's connection, opening it (decrypting with `dekHex`) the
 * first time and reusing it after. `dekHex` is only read on that first
 * open - a cached connection never needs the key again until it's closed
 * and something asks for it anew. */
export function getOrOpenUserDb(userId: number, dekHex: string): UserConn {
  let conn = open.get(userId);
  if (!conn) {
    conn = openUserDb(fileFor(userId), dekHex);
    open.set(userId, conn);
  }
  return conn;
}

/** Closes and forgets one user's connection (sign-out, idle timeout, or a
 * test needing a clean slate) - safe to call even if nothing is open. */
export function closeAndForget(userId: number) {
  const conn = open.get(userId);
  if (!conn) return;
  closeUserDb(conn);
  open.delete(userId);
}

export function openUserIds(): number[] {
  return [...open.keys()];
}

/** Test-only: closes everything and clears the pool. */
export function closeAllForTests() {
  for (const id of open.keys()) closeAndForget(id);
}
