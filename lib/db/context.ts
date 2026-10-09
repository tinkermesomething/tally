import { AsyncLocalStorage } from "node:async_hooks";
import type { UserConn } from "./connection";

/** What's active for the current request/task: which user's connection,
 * and - separately - how deep into nested transactions THIS call chain is.
 * The depth deliberately lives here, per call chain, NOT as a field on the
 * shared connection object: two genuinely different requests can end up
 * pointed at the SAME connection (today's shared legacy connection; later,
 * one user's own background job racing their own live request) - sharing
 * one mutable depth counter between them would let one miscount itself as
 * "nested inside" the other's transaction (see lib/db/write-lock.ts's
 * comment for the full story and lib/db/index.ts's inTransaction for how
 * the two pieces fit together). A fresh `enterUserDb`/`runWithUserDb` call
 * always starts a NEW chain at depth 0, however deep some OTHER chain
 * sharing the same connection currently is. */
type RequestDb = { conn: UserConn; txDepth: number };

/** Which user's database the CURRENT request/task is working with. One
 * process serves every user, so this - not a module-level singleton - is
 * what makes `db`/`sqlite` (lib/db/index.ts) mean "this user's data" for
 * every one of the ~4,000 lines of existing query code, unchanged: they
 * still just `import { db } from "./index"`, and that import resolves
 * through here instead of to one fixed connection.
 *
 * Verified (not assumed from how ALS "should" behave) that the store
 * survives an awaited continuation AND stays isolated between two
 * genuinely overlapping async tasks, including through a nested call into
 * a different user's context and back (see tests/user-db-context.test.ts -
 * the interleaved-tasks test is the one that actually matters here).
 * That's proven at the plain Node.js level; still to confirm once this is
 * wired into real server actions/route handlers: that Next's own request
 * machinery (on the Node runtime, never Edge - middleware stays excluded
 * the same way lib/audit.ts is) doesn't introduce its own boundary that
 * drops the store, e.g. around streaming or its own internal queuing. */
const als = new AsyncLocalStorage<RequestDb>();

/** Runs `fn` with `conn` as the active connection for every DB call made
 * anywhere inside it (including awaited calls into other functions) - the
 * one place that should wrap a server action's/route's whole body, right
 * after resolving who's signed in and opening/fetching their connection. */
export function runWithUserDb<T>(conn: UserConn, fn: () => Promise<T>): Promise<T> {
  return als.run({ conn, txDepth: 0 }, fn);
}

/** The active connection, or throws - a DB call reached outside an
 * established context is a real bug (an entry point that forgot to call
 * `enterUserDb`/`runWithUserDb` first), never something to paper over with
 * a fallback connection. */
export function currentUserConn(): UserConn {
  return currentRequestDb().conn;
}

/** Internal - lib/db/index.ts's `inTransaction` is the only caller that
 * needs the depth, not just the connection. */
export function currentRequestDb(): RequestDb {
  const store = als.getStore();
  if (!store) {
    throw new Error(
      "No user database is active for this request. Every route/action/page must call enterUserDb(...) (or runWithUserDb(...)) before touching the database."
    );
  }
  return store;
}

/** True without throwing - for a caller that wants to check rather than
 * catch. Not currently used by any real entry point (every one of them
 * unconditionally calls `enterUserDb` first instead), kept for a future
 * caller that genuinely needs to branch on it. */
export function hasUserDb(): boolean {
  return als.getStore() !== undefined;
}

/** Sets the active connection for whatever runs next in THIS SAME execution
 * chain, with no wrapping callback needed - unlike `runWithUserDb`, which
 * needs the rest of the work passed in as a function. This is what every
 * real entry point (requireSession, apiRoute, each page, the background
 * jobs) calls as its very first line: Node's AsyncLocalStorage guarantee is
 * that a context entered this way persists through every later `await` in
 * the SAME async function and anything it calls, which is exactly "the
 * rest of this request" for a plain `async function handler() { ... }`.
 * Also what the test harness's global `beforeEach` uses, for the same
 * reason - a hook has no single callback to wrap either. Always starts a
 * FRESH chain at transaction depth 0 - see this file's top comment on why
 * that's not shared with whatever chain the same connection was already in. */
export function enterUserDb(conn: UserConn) {
  als.enterWith({ conn, txDepth: 0 });
}
