import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories, expenseEntries, incomeSources } from "@/lib/db/schema";
import {
  linkCategoryToHousehold,
  listUnshared,
  setExpenseHouseholdShare,
  shareCategoryExpenses,
  shareIncomeSource,
} from "@/lib/db/household-tags";

beforeEach(() => resetDb());

async function seed() {
  const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
  const [other] = await db.insert(categories).values({ name: "Other" }).returning();
  const mk = async (categoryId: number, amountPence: number, entryDate: string, extra: Partial<typeof expenseEntries.$inferInsert> = {}) =>
    (await db.insert(expenseEntries).values({ categoryId, year: 2026, month: 9, amountPence, entryDate, ...extra }).returning())[0];
  const e1 = await mk(cat.id, 1000, "2026-09-01");
  const e2 = await mk(cat.id, 2000, "2026-09-02");
  const eOther = await mk(other.id, 9000, "2026-09-03");
  const draft = await mk(cat.id, 500, "2026-09-04", { provisional: true });
  const [source] = await db.insert(incomeSources).values({ name: "Salary" }).returning();
  return { cat, other, e1, e2, eOther, draft, source };
}

describe("listUnshared", () => {
  it("lists confirmed, not-yet-shared expenses of that category only, newest first", async () => {
    const { cat, e1, e2 } = await seed();
    const { rows, total } = await listUnshared(cat.id);
    expect(rows.map((r) => r.expenseEntryId)).toEqual([e2.id, e1.id]);
    expect(total).toBe(2);
  });

  it("already-shared expenses drop out", async () => {
    const { cat, e1, e2 } = await seed();
    await setExpenseHouseholdShare(e1.id, true);
    const { rows } = await listUnshared(cat.id);
    expect(rows.map((r) => r.expenseEntryId)).toEqual([e2.id]);
  });
});

describe("shareCategoryExpenses", () => {
  it("shares the ticked ones once, and a repeat shares nothing new", async () => {
    const { cat, e1, e2 } = await seed();
    const res = await shareCategoryExpenses(cat.id, [e1.id, e2.id]);
    expect(res).toEqual({ shared: 2 });
    const again = await shareCategoryExpenses(cat.id, [e1.id, e2.id]);
    expect(again).toEqual({ shared: 0 });
  });

  it("refuses ids from another category", async () => {
    const { cat, eOther } = await seed();
    const res = await shareCategoryExpenses(cat.id, [eOther.id]);
    expect(res).toEqual({ shared: 0 });
  });
});

describe("linkCategoryToHousehold", () => {
  it("turning it on sets the category default and shares the ticked backfill", async () => {
    const { cat, e1, e2 } = await seed();
    const res = await linkCategoryToHousehold(cat.id, true, [e1.id]);
    expect(res).toEqual({ shared: 1 });
    const updated = await db.query.categories.findFirst({ where: (c, { eq }) => eq(c.id, cat.id) });
    expect(updated?.sharedToHousehold).toBe(true);
    const { rows } = await listUnshared(cat.id);
    expect(rows.map((r) => r.expenseEntryId)).toEqual([e2.id]);
  });

  it("turning it off clears the category default but leaves already-shared expenses shared", async () => {
    const { cat, e1 } = await seed();
    await linkCategoryToHousehold(cat.id, true, [e1.id]);
    await linkCategoryToHousehold(cat.id, false);
    const updated = await db.query.categories.findFirst({ where: (c, { eq }) => eq(c.id, cat.id) });
    expect(updated?.sharedToHousehold).toBe(false);
    const row = await db.query.expenseEntries.findFirst({ where: (e, { eq }) => eq(e.id, e1.id) });
    expect(row?.sharedToHousehold).toBe(true);
  });

  it("refuses a category that no longer exists", async () => {
    await expect(linkCategoryToHousehold(999, true, [])).rejects.toThrow("no longer exists");
  });
});

describe("setExpenseHouseholdShare", () => {
  it("sets and clears the per-entry override regardless of the category default", async () => {
    const { e1 } = await seed();
    await setExpenseHouseholdShare(e1.id, true);
    expect((await db.query.expenseEntries.findFirst({ where: (e, { eq }) => eq(e.id, e1.id) }))?.sharedToHousehold).toBe(true);
    await setExpenseHouseholdShare(e1.id, false);
    expect((await db.query.expenseEntries.findFirst({ where: (e, { eq }) => eq(e.id, e1.id) }))?.sharedToHousehold).toBe(false);
  });

  it("refuses an entry that no longer exists", async () => {
    await expect(setExpenseHouseholdShare(999, true)).rejects.toThrow("no longer exists");
  });
});

describe("shareIncomeSource", () => {
  it("sets and clears the whole-source flag", async () => {
    const { source } = await seed();
    await shareIncomeSource(source.id, true);
    expect((await db.query.incomeSources.findFirst({ where: (s, { eq }) => eq(s.id, source.id) }))?.sharedToHousehold).toBe(true);
    await shareIncomeSource(source.id, false);
    expect((await db.query.incomeSources.findFirst({ where: (s, { eq }) => eq(s.id, source.id) }))?.sharedToHousehold).toBe(false);
  });

  it("refuses a source that no longer exists", async () => {
    await expect(shareIncomeSource(999, true)).rejects.toThrow("no longer exists");
  });
});
