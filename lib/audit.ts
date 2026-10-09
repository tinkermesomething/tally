import { lt, sql } from "drizzle-orm";
import { getSystemConn } from "./db/system-connection";
import { auditLog } from "./db/schema";

const RETENTION_DAYS = 180;

/** Appends one row to the SHARED audit log (lib/db/system-connection.ts -
 * not the ambient per-request `db`: a rejected sign-in, for one, has no
 * per-user context yet to use). Never throws into the caller - an audit
 * write failing must not break the action it's recording (e.g. a sign-in
 * should still succeed even if, somehow, this insert doesn't). */
export async function audit(action: string, detail?: string, ip?: string) {
  try {
    await getSystemConn().db.insert(auditLog).values({ action, detail: detail ?? null, ip: ip ?? null });
  } catch (err) {
    console.error("[audit] failed to record:", action, err);
  }
}

/** Drops anything older than the retention window - called once at startup
 * (instrumentation.ts), not on every write.
 *
 * The cutoff is computed BY SQLite itself (`datetime('now', ...)`), not in
 * JS - `at`'s own default (`current_timestamp`) is SQLite's native
 * "YYYY-MM-DD HH:MM:SS" format, which is NOT the same string shape as JS's
 * `Date.toISOString()` ("...THH:MM:SS.sssZ"). Confirmed directly: for the
 * same instant, the space sorts before "T", so a lexicographic `<` between
 * the two formats only gives the right answer when the two dates are far
 * enough apart that the date portion alone decides it - true for 180 days,
 * but fragile, and a correctness bug waiting for whoever shortens the
 * window later. Comparing two SQLite-native strings is bulletproof. */
export async function pruneAuditLog() {
  try {
    // A normal bound parameter, not string-spliced into the SQL text -
    // datetime()'s modifier argument accepts one like any other value.
    await getSystemConn().db.delete(auditLog).where(lt(auditLog.at, sql`datetime('now', ${`-${RETENTION_DAYS} days`})`));
  } catch (err) {
    console.error("[audit] prune failed:", err);
  }
}
