import { getAppSettings } from "./db/settings";
import { getBankAccounts, syncAllBankAccounts } from "./db/bank-sync";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
// Checked shortly after boot too, not just on the first 15-minute tick - a
// container restart right as a sync was due shouldn't have to wait.
const BOOT_CHECK_DELAY_MS = 60 * 1000;

let started = false;

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

async function checkAndMaybeSync() {
  try {
    const settings = await getAppSettings();
    if (!settings.bankSyncEnabled) return;

    const accounts = await getBankAccounts();
    if (accounts.length === 0) return;

    // Due if ANY active account hasn't synced within the configured
    // frequency - a brand-new account with no sync yet counts as
    // immediately due, so it doesn't sit waiting for an arbitrary window
    // just because a sibling account synced recently. syncAllBankAccounts
    // covers every account in one pass regardless, so this only decides
    // WHEN that pass runs, not which accounts it includes.
    const thresholdMs = settings.bankSyncFrequencyHours * 60 * 60 * 1000;
    const due = accounts.some(
      (a) => !a.lastSyncedAt || Date.now() - a.lastSyncedAt.getTime() >= thresholdMs
    );
    if (!due) return;

    const results = await syncAllBankAccounts();
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error("[scheduled-sync] one or more accounts failed:", failed);
    }
  } catch (err) {
    // Never let a scheduling check crash the interval loop itself -
    // the next tick should still happen regardless of this one's outcome.
    console.error("[scheduled-sync] check failed:", err);
  }
}
