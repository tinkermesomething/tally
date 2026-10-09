import type { UserConn } from "./connection";

/** One write lock per CONNECTION (not global, not per-user-id) - keyed by
 * the connection object itself via a WeakMap, so nothing has to pass a lock
 * around or remember to initialize one: a connection nobody has written to
 * yet just gets `Promise.resolve()` (already free) the first time it's
 * asked for. Entries disappear on their own once a connection is garbage
 * collected (closed and dropped), so this never needs manual cleanup.
 *
 * Why a lock is needed at all: SQLite itself only allows ONE write
 * transaction on a connection at a time - a second `BEGIN IMMEDIATE` while
 * one is already open is a real SQLite error ("cannot start a transaction
 * within a transaction"), not a race that happens to usually be fine.
 * Today's single shared legacy connection (lib/db/legacy-connection.ts)
 * makes this a live risk: the scheduled sync and a live user action both
 * reach `inTransaction` on the SAME connection, and Node's event loop can
 * genuinely interleave them at an `await` - a plain mutable counter on the
 * connection (the previous design) raced across that interleaving and
 * could silently misattribute one caller's work as "nested" inside
 * another's. This serializes the two instead of letting them race. Once
 * real per-user connections land, this stays correct for the same reason
 * at a narrower scope: one user's own background job and live request
 * sharing their one file. */
const tails = new WeakMap<UserConn, Promise<void>>();

/** Waits for whatever OUTER transaction currently holds this connection (if
 * any) to finish, then returns a function that releases the lock for
 * whoever's waiting next. Always call the returned function, in a
 * `finally`, exactly once - even if the caller's own transaction fails,
 * the lock must still be freed for the next one. */
export async function acquireWriteLock(conn: UserConn): Promise<() => void> {
  const previous = tails.get(conn) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(conn, next);
  await previous;
  return release;
}
