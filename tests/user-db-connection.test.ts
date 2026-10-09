import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { categories } from "@/lib/db/schema";
import { closeUserDb, openUserDb } from "@/lib/db/connection";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "tally-userdb-"));
const dek = () => randomBytes(32).toString("hex");

describe("openUserDb", () => {
  it("creates the file, runs every migration, and is a real working database", async () => {
    const file = path.join(dir(), "1.db");
    const conn = openUserDb(file, dek());
    expect(fs.existsSync(file)).toBe(true);
    const [created] = await conn.db.insert(categories).values({ name: "Rent" }).returning();
    expect(created.name).toBe("Rent");
    const migrations = conn.sqlite.prepare("select count(*) as n from __drizzle_migrations").get() as { n: number };
    expect(migrations.n).toBeGreaterThan(20); // every migration this app has shipped
    closeUserDb(conn);
  });

  it("the file on disk is genuinely encrypted - no plaintext table/column names or data", async () => {
    const file = path.join(dir(), "1.db");
    const conn = openUserDb(file, dek());
    await conn.db.insert(categories).values({ name: "SuperSecretCategoryName" });
    closeUserDb(conn);
    const raw = fs.readFileSync(file);
    expect(raw.subarray(0, 16).toString().startsWith("SQLite format 3")).toBe(false);
    expect(raw.includes(Buffer.from("SuperSecretCategoryName"))).toBe(false);
    expect(raw.includes(Buffer.from("categories"))).toBe(false);
  });

  it("reopening with the SAME key reads the same data back", async () => {
    const file = path.join(dir(), "1.db");
    const key = dek();
    const first = openUserDb(file, key);
    await first.db.insert(categories).values({ name: "Groceries" });
    closeUserDb(first);

    const second = openUserDb(file, key);
    const rows = await second.db.select().from(categories);
    expect(rows.map((r) => r.name)).toEqual(["Groceries"]);
    closeUserDb(second);
  });

  it("the WRONG key fails loudly - never silently opens an empty-looking database", async () => {
    const file = path.join(dir(), "1.db");
    const first = openUserDb(file, dek());
    await first.db.insert(categories).values({ name: "Groceries" });
    closeUserDb(first);

    expect(() => openUserDb(file, dek())).toThrow();
  });

  it("two users get two completely separate files - no cross-talk", async () => {
    const d = dir();
    const a = openUserDb(path.join(d, "a.db"), dek());
    const b = openUserDb(path.join(d, "b.db"), dek());
    await a.db.insert(categories).values({ name: "Alice's category" });
    await b.db.insert(categories).values({ name: "Bob's category" });
    expect((await a.db.select().from(categories)).map((r) => r.name)).toEqual(["Alice's category"]);
    expect((await b.db.select().from(categories)).map((r) => r.name)).toEqual(["Bob's category"]);
    closeUserDb(a);
    closeUserDb(b);
  });

  it("creates parent folders that don't exist yet", async () => {
    const file = path.join(dir(), "nested", "deep", "1.db");
    const conn = openUserDb(file, dek());
    expect(fs.existsSync(file)).toBe(true);
    closeUserDb(conn);
  });
});
