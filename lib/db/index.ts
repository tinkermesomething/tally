import { currentRequestDb, currentUserConn } from "./context";
import { acquireWriteLock } from "./write-lock";

export const DATABASE_PATH = process.env.DATABASE_PATH ?? "./config/tally.db";

/** `db` and `sqlite` used to be one module-level singleton, opened at
 * import time. Now they're proxies onto whichever user's connection is
 * active for the CURRENT request (see lib/db/context.ts) - every one of
 * the ~4,000 lines elsewhere in lib/db/*.ts that does `import { db } from
 * "./index"` keeps working completely unchanged; it's still a plain object
 * it calls `.select()`/`.insert()`/etc. on, it just now means "this
 * request's signed-in user's own data" instead of one fixed file.
 *
 * Reached with no active connection (a route/action that forgot to resolve
 * its user first) -> throws immediately and loudly, the first time
 * anything touches the database, never a silent wrong-user read. */
export const sqlite = new Proxy({} as ReturnType<typeof currentUserConn>["sqlite"], {
  get(_target, prop, receiver) {
    return Reflect.get(currentUserConn().sqlite, prop, receiver);
  },
}) as ReturnType<typeof currentUserConn>["sqlite"];

export const db = new Proxy({} as ReturnType<typeof currentUserConn>["db"], {
  get(_target, prop, receiver) {
    return Reflect.get(currentUserConn().db, prop, receiver);
  },
}) as ReturnType<typeof currentUserConn>["db"];

/** Runs `fn` as one atomic unit: everything it writes commits together or
 * not at all. Nests (inner calls become savepoints), so a function that is
 * atomic on its own stays atomic when a bigger flow wraps it.
 *
 * Why this works with async code: better-sqlite3 is synchronous, so awaiting
 * a Drizzle query only yields to the microtask queue - no other request can
 * run between two awaits WITHOUT this going through the write lock below.
 * `fn` must therefore ONLY await DB calls (or things already covered by that
 * lock). Never fetch(), sleep or await a timer inside it: that would hold
 * the lock open for however long that takes, blocking every other write on
 * this connection meanwhile.
 *
 * Nesting depth lives on the CURRENT CALL CHAIN (see lib/db/context.ts),
 * not on the connection itself: two unrelated chains can be pointed at the
 * SAME connection (today's one shared legacy connection; later, one user's
 * own background job racing their own live request), and sharing a single
 * mutable counter between them let one miscount itself as nested inside
 * the other's transaction - confirmed as a real, reachable bug, not just a
 * theoretical one, and fixed together with the write lock below: an OUTER
 * call on a connection that's already mid-transaction now WAITS for it to
 * finish instead of racing it. A nested call (depth > 0) never acquires
 * the lock itself - its own chain already holds it, from the outer call
 * lower on the same stack. */
export async function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const store = currentRequestDb();
  const outer = store.txDepth === 0;
  const release = outer ? await acquireWriteLock(store.conn) : null;
  const savepoint = `sp_${store.txDepth}`;
  try {
    store.conn.sqlite.exec(outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    store.txDepth++;
    try {
      const result = await fn();
      store.txDepth--;
      store.conn.sqlite.exec(outer ? "COMMIT" : `RELEASE ${savepoint}`);
      return result;
    } catch (err) {
      store.txDepth--;
      store.conn.sqlite.exec(outer ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw err;
    }
  } finally {
    release?.();
  }
}
