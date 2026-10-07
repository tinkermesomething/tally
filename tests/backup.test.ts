import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resetDb } from "./helpers/db";
import { db, sqlite } from "@/lib/db";
import { categories, incomeSources } from "@/lib/db/schema";
import { backupDir, restoreFromFile, writeBackup } from "@/lib/db/backup";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tally-bk-")), "b.db");
const names = async () => (await db.select().from(categories)).map((c) => c.name).sort();

beforeEach(() => resetDb());

describe("backup and restore", () => {
  it("restores the data as it was, and keeps a safety copy of what was replaced", async () => {
    await db.insert(categories).values([{ name: "Rent" }, { name: "Food" }]);
    await db.insert(incomeSources).values({ name: "Wages" });
    const file = tmp();
    await writeBackup(file);

    await db.insert(categories).values({ name: "Added after the backup" });
    await db.delete(incomeSources);
    expect(await names()).toHaveLength(3);

    const res = await restoreFromFile(file);
    expect(await names()).toEqual(["Food", "Rent"]);
    expect((await db.select().from(incomeSources)).map((s) => s.name)).toEqual(["Wages"]);
    expect(res.rows).toBeGreaterThanOrEqual(3);

    // the safety copy holds the data from just before the restore
    const safety = new Database(res.safetyBackup, { readonly: true });
    expect((safety.prepare("select count(*) as n from categories").get() as { n: number }).n).toBe(3);
    safety.close();
    expect(res.safetyBackup.startsWith(backupDir())).toBe(true);
  });

  it("new rows keep getting fresh ids after a restore", async () => {
    await db.insert(categories).values([{ name: "A" }, { name: "B" }]);
    const file = tmp();
    await writeBackup(file);
    await db.insert(categories).values({ name: "C" });
    await restoreFromFile(file);
    const [d] = await db.insert(categories).values({ name: "D" }).returning();
    const ids = (await db.select().from(categories)).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(d.id).toBeGreaterThan(2);
  });

  it("refuses a file that is not a database, and leaves the data alone", async () => {
    await db.insert(categories).values({ name: "Keep me" });
    const junk = tmp();
    fs.writeFileSync(junk, "this is not a database");
    await expect(restoreFromFile(junk)).rejects.toThrow("isn't a Tally backup");
    expect(await names()).toEqual(["Keep me"]);
  });

  it("refuses some other SQLite database", async () => {
    const other = tmp();
    const o = new Database(other);
    o.exec("create table todo (id integer primary key, t text)");
    o.close();
    await expect(restoreFromFile(other)).rejects.toThrow("isn't a Tally backup");
  });

  it("refuses a backup from a newer version (extra columns)", async () => {
    await db.insert(categories).values({ name: "Keep me" });
    const file = tmp();
    await writeBackup(file);
    const edit = new Database(file);
    edit.exec("alter table categories add column from_the_future text");
    edit.close();
    await expect(restoreFromFile(file)).rejects.toThrow("newer version");
    expect(await names()).toEqual(["Keep me"]);
  });

  it("an older backup (missing a newer table's data) restores, leaving that table empty", async () => {
    await db.insert(categories).values({ name: "Old" });
    const file = tmp();
    await writeBackup(file);
    const edit = new Database(file);
    edit.exec("drop table report_panels");
    edit.close();
    sqlite.exec("insert into report_panels (name, selection, sort_order) values ('x', '[]', 0)");
    await restoreFromFile(file);
    expect(await names()).toEqual(["Old"]);
    expect((sqlite.prepare("select count(*) as n from report_panels").get() as { n: number }).n).toBe(0);
  });

  it("rolls back completely if the backup's links don't match up", async () => {
    await db.insert(categories).values({ name: "Keep me" });
    const file = tmp();
    await writeBackup(file);
    const edit = new Database(file);
    edit.pragma("foreign_keys = OFF");
    edit.exec("insert into category_entries (category_id, year, month, amount_pence) values (9999, 2026, 1, 100)");
    edit.close();
    await expect(restoreFromFile(file)).rejects.toThrow("don't match up");
    expect(await names()).toEqual(["Keep me"]);
    expect((sqlite.prepare("select count(*) as n from category_entries").get() as { n: number }).n).toBe(0);
  });
});
