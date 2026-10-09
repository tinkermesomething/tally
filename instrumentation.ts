export async function register() {
  // Only in the real Node.js server process (not the edge runtime used for
  // middleware) - applies any pending Drizzle migrations before the app
  // starts serving traffic, so a fresh container/volume just works.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Opens (and migrates) the shared connection now, at startup, rather
    // than waiting for the first request - see lib/db/legacy-connection.ts.
    const { getLegacyConn } = await import("./lib/db/legacy-connection");
    getLegacyConn();

    const { startScheduledSync } = await import("./lib/scheduled-sync");
    startScheduledSync();

    const { startAutoBackup } = await import("./lib/auto-backup");
    startAutoBackup();

    const { enterUserDb } = await import("./lib/db/context");
    const { pruneAuditLog } = await import("./lib/audit");
    enterUserDb(getLegacyConn());
    await pruneAuditLog();
  }
}
