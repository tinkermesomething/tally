import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const DATABASE_PATH = process.env.DATABASE_PATH ?? "./config/tally.db";

export const sqlite = new Database(DATABASE_PATH);
sqlite.pragma("journal_mode = WAL");
// WAL + NORMAL never corrupts the database and survives an app crash; the
// only thing it can lose is the last moments of writes if the whole machine
// loses power. The default (FULL) fsyncs on EVERY commit, which on the
// Pi's SD card measured ~11ms per write vs ~0.1ms - applying a rule to
// ~100 rows (about 3 writes each) took seconds instead of a blink.
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

let txDepth = 0;

/** Runs `fn` as one atomic unit: everything it writes commits together or
 * not at all. Nests (inner calls become savepoints), so a function that is
 * atomic on its own stays atomic when a bigger flow wraps it.
 *
 * Why this works with async code: better-sqlite3 is synchronous, so awaiting
 * a Drizzle query only yields to the microtask queue - no other request can
 * run between two awaits. `fn` must therefore ONLY await DB calls. Never
 * fetch(), sleep or await a timer inside it: that would let another request
 * write inside this transaction (and be rolled back with it). */
export async function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const outer = txDepth === 0;
  const savepoint = `sp_${txDepth}`;
  sqlite.exec(outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
  txDepth++;
  try {
    const result = await fn();
    txDepth--;
    sqlite.exec(outer ? "COMMIT" : `RELEASE ${savepoint}`);
    return result;
  } catch (err) {
    txDepth--;
    sqlite.exec(outer ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw err;
  }
}
