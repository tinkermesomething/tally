import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite } from "@/lib/db";

let migrated = false;

/** Applies the real migrations once per test file, then empties every table
 * so each test starts from a blank DB. */
export function resetDb() {
  if (!migrated) {
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    migrated = true;
  }
  sqlite.pragma("foreign_keys = OFF");
  const tables = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'")
    .all() as { name: string }[];
  for (const { name } of tables) sqlite.exec(`delete from "${name}"`);
  sqlite.pragma("foreign_keys = ON");
}
