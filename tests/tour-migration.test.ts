import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { migrationsFolderUpTo } from "./helpers/migrations";

const freshDb = () => new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tally-db-")), "test.db"));
const settings = (db: Database.Database) => db.prepare("SELECT tour_seen, show_help_icons FROM app_settings").all() as { tour_seen: number; show_help_icons: number }[];

describe("0041_help_and_tour - the guided tour must never launch over an existing budget", () => {
  it("marks an account that already had settings as having seen the tour, with help icons on", () => {
    const sqlite = freshDb();
    migrate(drizzle(sqlite), { migrationsFolder: migrationsFolderUpTo("0040_income_source_requires_debt_person") });
    sqlite.exec("INSERT INTO app_settings (currency) VALUES ('GBP')");

    migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });

    expect(settings(sqlite)).toEqual([{ tour_seen: 1, show_help_icons: 1 }]);
  });

  it("gives an account created after the migration an unseen tour", () => {
    const sqlite = freshDb();
    migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    expect(settings(sqlite)).toEqual([]);

    sqlite.exec("INSERT INTO app_settings (currency) VALUES ('GBP')");

    expect(settings(sqlite)).toEqual([{ tour_seen: 0, show_help_icons: 1 }]);
  });
});
