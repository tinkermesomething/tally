import { getAppSettings } from "./db/settings";
import { getBankAccounts, syncAllBankAccounts } from "./db/bank-sync";

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
// minutes, burning through GoCardless's per-account daily limit.
let lastAttemptAt: number | null = null;

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

/** Due if ANY active account hasn't synced within the configured
 * frequency - a brand-new account with no sync yet counts as immediately
 * due, so it doesn't sit waiting for an arbitrary window just because a
 * sibling account synced recently. syncAllBankAccounts covers every account
 * in one pass regardless, so this only decides WHEN that pass runs, not
 * which accounts it includes. Pure (no DB, no clock of its own) so the
 * decision itself is testable. */
export function isSyncDue(
  accounts: { lastSyncedAt: Date | null }[],
  frequencyHours: number,
  now: number = Date.now()
): boolean {
  const thresholdMs = frequencyHours * 60 * 60 * 1000;
  return accounts.some((a) => !a.lastSyncedAt || now - a.lastSyncedAt.getTime() >= thresholdMs);
}

/** isSyncDue plus a throttle on ATTEMPTS, not just successes: a pass that
 * was tried (even if an account failed) isn't tried again until a full
 * frequency window has gone by. */
export function shouldSyncNow(
  accounts: { lastSyncedAt: Date | null }[],
  frequencyHours: number,
  lastAttempt: number | null,
  now: number = Date.now()
): boolean {
  const thresholdMs = frequencyHours * 60 * 60 * 1000;
  if (lastAttempt !== null && now - lastAttempt < thresholdMs) return false;
  return isSyncDue(accounts, frequencyHours, now);
}

async function checkAndMaybeSync() {
  if (running) return;
  running = true;
  try {
    const settings = await getAppSettings();
    if (!settings.bankSyncEnabled) return;

    const accounts = await getBankAccounts();
    if (accounts.length === 0) return;

    if (!shouldSyncNow(accounts, settings.bankSyncFrequencyHours, lastAttemptAt)) return;

    lastAttemptAt = Date.now();
    const results = await syncAllBankAccounts();
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error("[scheduled-sync] one or more accounts failed:", failed);
    }
  } catch (err) {
    // Never let a scheduling check crash the interval loop itself -
    // the next tick should still happen regardless of this one's outcome.
    console.error("[scheduled-sync] check failed:", err);
  } finally {
    running = false;
  }
}
