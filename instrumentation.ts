export async function register() {
  // Only in the real Node.js server process (not the edge runtime used for
  // middleware) - applies any pending Drizzle migrations before the app
  // starts serving traffic, so a fresh container/volume just works.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const path = await import("node:path");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("./lib/db");
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

    const { startScheduledSync } = await import("./lib/scheduled-sync");
    startScheduledSync();

    const { startAutoBackup } = await import("./lib/auto-backup");
    startAutoBackup();
  }
}
