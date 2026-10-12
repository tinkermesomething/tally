import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories, expenseEntries, incomeSources } from "@/lib/db/schema";
import {
  bulkShareCategoriesToHousehold,
  linkCategoryToHousehold,
  listUnshared,
  setExpenseHouseholdShare,
  shareCategoryExpenses,
  shareIncomeSource,
} from "@/lib/db/household-tags";
import { archiveCategory, archiveIncomeSource } from "@/lib/db/queries";

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

  it("turning it off clears the category default AND un-shares every expense already in it - unlike debt/savings, there's no financial event to preserve, so nothing should linger", async () => {
    const { cat, e1, e2 } = await seed();
    await linkCategoryToHousehold(cat.id, true, [e1.id]);
    await setExpenseHouseholdShare(e2.id, true); // shared individually, not via the category backfill
    await linkCategoryToHousehold(cat.id, false);
    const updated = await db.query.categories.findFirst({ where: (c, { eq }) => eq(c.id, cat.id) });
    expect(updated?.sharedToHousehold).toBe(false);
    for (const id of [e1.id, e2.id]) {
      const row = await db.query.expenseEntries.findFirst({ where: (e, { eq }) => eq(e.id, id) });
      expect(row?.sharedToHousehold).toBe(false);
    }
  });

  it("refuses a category that no longer exists", async () => {
    await expect(linkCategoryToHousehold(999, true, [])).rejects.toThrow("no longer exists");
  });
});

describe("bulkShareCategoriesToHousehold", () => {
  it("shares every leaf id given, skipping a parent-with-children and a nonexistent id without throwing", async () => {
    const { cat, other } = await seed();
    const [parent] = await db.insert(categories).values({ name: "Mobile" }).returning();
    await db.insert(categories).values({ name: "Giffgaff", parentId: parent.id });

    const updated = await bulkShareCategoriesToHousehold([cat.id, other.id, parent.id, 999], true);

    expect(updated).toBe(2);
    for (const id of [cat.id, other.id]) {
      const row = await db.query.categories.findFirst({ where: (c, { eq }) => eq(c.id, id) });
      expect(row?.sharedToHousehold).toBe(true);
    }
    const parentRow = await db.query.categories.findFirst({ where: (c, { eq }) => eq(c.id, parent.id) });
    expect(parentRow?.sharedToHousehold).toBe(false);
  });

  it("unshares every leaf id given, clearing their expenses too (same as the single-category path)", async () => {
    const { cat, e1, other } = await seed();
    await linkCategoryToHousehold(cat.id, true, [e1.id]);
    await bulkShareCategoriesToHousehold([cat.id, other.id], false);
    const catRow = await db.query.categories.findFirst({ where: (c, { eq }) => eq(c.id, cat.id) });
    expect(catRow?.sharedToHousehold).toBe(false);
    const e1Row = await db.query.expenseEntries.findFirst({ where: (e, { eq }) => eq(e.id, e1.id) });
    expect(e1Row?.sharedToHousehold).toBe(false);
  });

  it("de-duplicates repeated ids", async () => {
    const { cat } = await seed();
    const updated = await bulkShareCategoriesToHousehold([cat.id, cat.id], true);
    expect(updated).toBe(1);
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

describe("archiving implicitly un-shares (lib/db/queries.ts)", () => {
  it("archiveCategory clears sharedToHousehold on the category and every expense in it", async () => {
    const { cat, e1 } = await seed();
    await linkCategoryToHousehold(cat.id, true, [e1.id]);
    await archiveCategory(cat.id);
    expect((await db.query.categories.findFirst({ where: (c, { eq }) => eq(c.id, cat.id) }))?.sharedToHousehold).toBe(false);
    expect((await db.query.expenseEntries.findFirst({ where: (e, { eq }) => eq(e.id, e1.id) }))?.sharedToHousehold).toBe(false);
  });

  it("archiveCategory cascades the un-share to children archived in the same call", async () => {
    const { cat } = await seed();
    const [child] = await db.insert(categories).values({ name: "Sub", parentId: cat.id }).returning();
    const [e] = await db.insert(expenseEntries).values({ categoryId: child.id, year: 2026, month: 9, amountPence: 500, entryDate: "2026-09-01" }).returning();
    await linkCategoryToHousehold(child.id, true, [e.id]);
    await archiveCategory(cat.id); // archives cat AND its children
    expect((await db.query.categories.findFirst({ where: (c, { eq }) => eq(c.id, child.id) }))?.sharedToHousehold).toBe(false);
    expect((await db.query.expenseEntries.findFirst({ where: (ex, { eq }) => eq(ex.id, e.id) }))?.sharedToHousehold).toBe(false);
  });

  it("archiveIncomeSource clears sharedToHousehold too", async () => {
    const { source } = await seed();
    await shareIncomeSource(source.id, true);
    await archiveIncomeSource(source.id);
    expect((await db.query.incomeSources.findFirst({ where: (s, { eq }) => eq(s.id, source.id) }))?.sharedToHousehold).toBe(false);
  });
});
