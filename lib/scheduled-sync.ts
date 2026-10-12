import { getAppSettings } from "./db/settings";
import { getBankAccounts, syncAllBankAccounts } from "./db/bank-sync";
import { isHouseholdEnabled, reconcileHouseholdDataForUser } from "./db/household";
import { lastSyncSlot } from "./sync-schedule";
import { runWithUserDb } from "./db/context";
import { listUsers } from "./db/users";
import { getOrOpenUserDb } from "./db/pool";
import { openDek, dekToHex } from "./user-dek";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
// Checked shortly after boot too, not just on the first 15-minute tick - a
// container restart right as a sync was due shouldn't have to wait.
const BOOT_CHECK_DELAY_MS = 60 * 1000;

let started = false;
let running = false;
// In-memory on purpose: it only has to survive between ticks of this one
// process. Without it, one account that can never sync (expired consent)
// never gets a fresh lastSyncedAt, so it would look overdue on EVERY tick
// and the whole pass - healthy accounts included - would re-run every 15
// minutes, burning through GoCardless's per-account daily limit. Keyed by
// user id - each account on this instance has its own bank accounts, own
// GoCardless credentials (lib/db/gocardless-credentials.ts) and own
// frequency setting, so one user's failed attempt must never throttle
// anyone else's.
const lastAttemptAt = new Map<number, number>();

/** Starts the in-process scheduled-sync loop - safe to call more than once
 * (e.g. if instrumentation.ts's register() ever runs again), it only ever
 * registers the interval once per server process. This app is one
 * long-lived container (`next start`), not serverless, so a plain
 * setInterval is the whole mechanism - no external cron needed. */
export function startScheduledSync() {
  if (started) return;
  started = true;
  setTimeout(checkAndMaybeSync, BOOT_CHECK_DELAY_MS);
  setInterval(checkAndMaybeSync, CHECK_INTERVAL_MS);
}

/** Due if ANY active account hasn't synced since the latest scheduled slot
 * (see lib/sync-schedule.ts) - a brand-new account with no sync yet counts as
 * due, so it doesn't wait just because a sibling account synced recently.
 * syncAllBankAccounts covers every account in one pass regardless, so this
 * only decides WHEN that pass runs. Pure (no DB, no clock of its own) so the
 * decision itself is testable. */
export function isSyncDue(
  accounts: { lastSyncedAt: Date | null }[],
  frequencyHours: number,
  now: number = Date.now(),
  timeZone?: string
): boolean {
  const slot = lastSyncSlot(now, frequencyHours, timeZone);
  return accounts.some((a) => !a.lastSyncedAt || a.lastSyncedAt.getTime() < slot);
}

/** isSyncDue plus a throttle on ATTEMPTS, not just successes: a pass that
 * was tried in this slot (even if an account failed) isn't tried again until
 * the next slot, so one account that can never sync can't make every
 * 15-minute tick re-run the pass. */
export function shouldSyncNow(
  accounts: { lastSyncedAt: Date | null }[],
  frequencyHours: number,
  lastAttempt: number | null,
  now: number = Date.now(),
  timeZone?: string
): boolean {
  if (lastAttempt !== null && lastAttempt >= lastSyncSlot(now, frequencyHours, timeZone)) return false;
  return isSyncDue(accounts, frequencyHours, now, timeZone);
}

/** Each timer firing checks EVERY eligible account in turn, each in its own
 * connection - one user's bank accounts, GoCardless credentials and sync
 * frequency are all theirs alone now (moved off the single shared legacy
 * connection this job used to assume), so this can no longer do one check
 * against one fixed connection the way it did before that move. One
 * user's failure (bad credentials, an expired consent) is caught and
 * logged per-user, never aborting the rest of the pass. */
async function checkAndMaybeSync() {
  if (running) return;
  running = true;
  try {
    const users = await listUsers();
    // Checked ONCE, not per user - sysDb() is always-open/cheap regardless,
    // but there's no point opening every user's own pooled connection just
    // to have reconcileHouseholdDataForUser immediately no-op on an
    // instance that never turned this on.
    const householdOn = await isHouseholdEnabled();
    for (const user of users) {
      if (user.disabledAt || !user.oidcSub || !user.dekSealed) continue;
      try {
        await syncOneUser(user.id, user.oidcSub, user.dekSealed);
      } catch (err) {
        console.error(`[scheduled-sync] user ${user.id} failed:`, err);
      }
      // Deliberately its own try/catch, separate from bank sync above - one
      // failing must never block or be blocked by the other.
      if (householdOn) {
        try {
          await syncHouseholdForUser(user.id, user.oidcSub, user.dekSealed);
        } catch (err) {
          console.error(`[scheduled-sync] household reconcile for user ${user.id} failed:`, err);
        }
      }
    }
  } catch (err) {
    // Never let a scheduling check crash the interval loop itself -
    // the next tick should still happen regardless of this one's outcome.
    console.error("[scheduled-sync] check failed:", err);
  } finally {
    running = false;
  }
}

async function syncOneUser(userId: number, oidcSub: string, dekSealed: string) {
  const dek = openDek(dekSealed, oidcSub);
  const conn = getOrOpenUserDb(userId, dekToHex(dek));
  await runWithUserDb(conn, async () => {
    const settings = await getAppSettings();
    if (!settings.bankSyncEnabled) return;

    const accounts = await getBankAccounts();
    if (accounts.length === 0) return;

    if (!shouldSyncNow(accounts, settings.bankSyncFrequencyHours, lastAttemptAt.get(userId) ?? null)) return;

    lastAttemptAt.set(userId, Date.now());
    const results = await syncAllBankAccounts();
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error(`[scheduled-sync] user ${userId}: one or more accounts failed:`, failed);
    }
  });
}

/** The self-healing backstop for lib/db/household-tags.ts's eager reconcile
 * calls - this same per-user connection pattern, on the same already-proven
 * cadence, catches anything those don't directly wrap (an edit or delete
 * made through a path that isn't a share toggle). */
async function syncHouseholdForUser(userId: number, oidcSub: string, dekSealed: string) {
  const dek = openDek(dekSealed, oidcSub);
  const conn = getOrOpenUserDb(userId, dekToHex(dek));
  await runWithUserDb(conn, () => reconcileHouseholdDataForUser(userId));
}
