import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories, categoryEntries, debtLedgerEntries, expenseEntries, incomeEntries, incomeSources, people } from "@/lib/db/schema";
import {
  deleteExpenseEntry,
  incrementIncomeEntry,
  logExpense,
  upsertCategoryEntry,
  upsertIncomeEntry,
} from "@/lib/db/queries";
import { addDebtEntry, getPeopleWithBalances } from "@/lib/db/debt";
import { recordAnchorForWage, refileExpensesFromAnchor, recordPayPeriodAnchor } from "@/lib/db/pay-period";

let catId: number;
beforeEach(async () => {
  resetDb();
  catId = (await db.insert(categories).values({ name: "Food" }).returning())[0].id;
});

const cell = async (year: number, month: number, category = catId) =>
  (await db.select().from(categoryEntries).where(and(eq(categoryEntries.categoryId, category), eq(categoryEntries.year, year), eq(categoryEntries.month, month))))[0];

describe("paid flag follows logged expenses", () => {
  it("logExpense creates a paid 0-plan cell when none exists", async () => {
    await logExpense({ categoryId: catId, amountPence: 500, entryDate: "2026-10-05" });
    expect(await cell(2026, 10)).toMatchObject({ amountPence: 0, paid: true });
  });

  it("logExpense keeps an existing plan amount and just marks it paid", async () => {
    await upsertCategoryEntry({ categoryId: catId, year: 2026, month: 10, amountPence: 9000 });
    await logExpense({ categoryId: catId, amountPence: 500, entryDate: "2026-10-05" });
    expect(await cell(2026, 10)).toMatchObject({ amountPence: 9000, paid: true });
  });

  it("deleting the last expense un-pays the cell; deleting one of two does not", async () => {
    const a = await logExpense({ categoryId: catId, amountPence: 500, entryDate: "2026-10-05" });
    const b = await logExpense({ categoryId: catId, amountPence: 700, entryDate: "2026-10-06" });
    await deleteExpenseEntry(a.id);
    expect((await cell(2026, 10)).paid).toBe(true);
    await deleteExpenseEntry(b.id);
    expect((await cell(2026, 10)).paid).toBe(false);
  });

  it("deleting a debt-tagged expense removes its ledger entry", async () => {
    const [p] = await db.insert(people).values({ name: "Bob" }).returning();
    const e = await logExpense({ categoryId: catId, amountPence: 500, entryDate: "2026-10-05", debtPersonId: p.id });
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(1);
    await deleteExpenseEntry(e.id);
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(0);
  });

  it("a new expense inherits sharedToHousehold from its category, same as debtPersonId/bucketId - the bug behind household spend never showing up for anything logged after sharing was turned on", async () => {
    await db.update(categories).set({ sharedToHousehold: true }).where(eq(categories.id, catId));
    const shared = await logExpense({ categoryId: catId, amountPence: 500, entryDate: "2026-10-05" });
    expect(shared.sharedToHousehold).toBe(true);

    await db.update(categories).set({ sharedToHousehold: false }).where(eq(categories.id, catId));
    const unshared = await logExpense({ categoryId: catId, amountPence: 500, entryDate: "2026-10-06" });
    expect(unshared.sharedToHousehold).toBe(false);
  });
});

describe("upserts", () => {
  it("upsertCategoryEntry inserts then replaces, never duplicates", async () => {
    await upsertCategoryEntry({ categoryId: catId, year: 2026, month: 3, amountPence: 100 });
    await upsertCategoryEntry({ categoryId: catId, year: 2026, month: 3, amountPence: 250 });
    const rows = await db.select().from(categoryEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountPence).toBe(250);
  });

  it("upsertCategoryEntry keeps the paid flag when replacing the amount", async () => {
    await upsertCategoryEntry({ categoryId: catId, year: 2026, month: 3, amountPence: 100 });
    await db.update(categoryEntries).set({ paid: true });
    await upsertCategoryEntry({ categoryId: catId, year: 2026, month: 3, amountPence: 250 });
    expect((await cell(2026, 3)).paid).toBe(true);
  });

  it("income: upsert replaces, increment adds", async () => {
    const [src] = await db.insert(incomeSources).values({ name: "Wages" }).returning();
    const key = { incomeSourceId: src.id, year: 2026, month: 3 };
    await upsertIncomeEntry({ ...key, amountPence: 1000 });
    await upsertIncomeEntry({ ...key, amountPence: 1500 });
    await incrementIncomeEntry({ ...key, amountPence: 250 });
    await incrementIncomeEntry({ ...key, amountPence: 250 });
    const rows = await db.select().from(incomeEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountPence).toBe(2000);
  });

  it("increment on an empty month inserts", async () => {
    const [src] = await db.insert(incomeSources).values({ name: "Gifts" }).returning();
    await incrementIncomeEntry({ incomeSourceId: src.id, year: 2026, month: 4, amountPence: 300 });
    expect((await db.select().from(incomeEntries))[0].amountPence).toBe(300);
  });
});

describe("pay-period refile", () => {
  it("a new anchor moves later expenses to the funded month and fixes paid flags", async () => {
    const [wages] = await db.insert(incomeSources).values({ name: "Wages", isPayAnchor: true }).returning();
    const e = await logExpense({ categoryId: catId, amountPence: 500, entryDate: "2026-09-29" }); // no anchor yet -> September
    expect(e.month).toBe(9);
    await recordAnchorForWage(wages.id, "2026-09-28"); // wages 28 Sep fund October
    const moved = (await db.select().from(expenseEntries))[0];
    expect(moved).toMatchObject({ year: 2026, month: 10 });
    expect((await cell(2026, 10)).paid).toBe(true); // destination paid
    expect((await cell(2026, 9)).paid).toBe(false); // old cell no longer has an expense
  });

  it("refile is idempotent", async () => {
    const [wages] = await db.insert(incomeSources).values({ name: "Wages", isPayAnchor: true }).returning();
    await logExpense({ categoryId: catId, amountPence: 500, entryDate: "2026-09-29" });
    await recordPayPeriodAnchor({ incomeSourceId: wages.id, receivedDate: "2026-09-28", year: 2026, month: 10 });
    expect(await refileExpensesFromAnchor("2026-09-28")).toBe(1);
    expect(await refileExpensesFromAnchor("2026-09-28")).toBe(0);
  });

  it("recordAnchorForWage does not pile up duplicate anchors", async () => {
    const [wages] = await db.insert(incomeSources).values({ name: "Wages", isPayAnchor: true }).returning();
    await recordAnchorForWage(wages.id, "2026-09-28");
    await recordAnchorForWage(wages.id, "2026-09-28");
    const { listPayPeriodAnchors } = await import("@/lib/db/pay-period");
    expect(await listPayPeriodAnchors()).toHaveLength(1);
  });
});

describe("debt balances", () => {
  it("loans add, repayments subtract, per person; archived people hidden", async () => {
    const [a] = await db.insert(people).values({ name: "A" }).returning();
    const [b] = await db.insert(people).values({ name: "B" }).returning();
    const [c] = await db.insert(people).values({ name: "C", archived: true }).returning();
    await addDebtEntry({ personId: a.id, entryDate: "2026-10-01", amountPence: 1000, direction: "loan" });
    await addDebtEntry({ personId: a.id, entryDate: "2026-10-02", amountPence: 400, direction: "repayment" });
    await addDebtEntry({ personId: c.id, entryDate: "2026-10-02", amountPence: 999, direction: "loan" });
    const got = await getPeopleWithBalances();
    expect(got.map((p) => [p.name, p.balancePence, p.entryCount])).toEqual([["A", 600, 2], ["B", 0, 0]]);
    expect(got.find((p) => p.id === b.id)).toBeTruthy();
  });
});

import { getCategoryTree, getGridData, moveCategoryParent } from "@/lib/db/queries";

describe("category tree + grid grouping", () => {
  it("nests children under their parent, in both the tree and the grid", async () => {
    const [parent] = await db.insert(categories).values({ name: "Home", sortOrder: 1 }).returning();
    await db.insert(categories).values({ name: "Rent", parentId: parent.id, sortOrder: 2 });
    await db.insert(categories).values({ name: "Gas", parentId: parent.id, sortOrder: 3 });
    const tree = await getCategoryTree();
    const home = tree.find((c) => c.name === "Home")!;
    expect(home.children.map((c) => c.name)).toEqual(["Rent", "Gas"]);
    const grid = await getGridData(2026);
    expect(grid.categories.find((c) => c.name === "Home")!.children.map((c) => c.name)).toEqual(["Rent", "Gas"]);
    expect(grid.categories.map((c) => c.name)).not.toContain("Rent"); // children are not top-level
  });

  it("a move to top-level takes effect (null effective parent beats the original parentId)", async () => {
    const [parent] = await db.insert(categories).values({ name: "Home", sortOrder: 1 }).returning();
    const [child] = await db.insert(categories).values({ name: "Rent", parentId: parent.id, sortOrder: 2 }).returning();
    await moveCategoryParent(child.id, null);
    const tree = await getCategoryTree();
    expect(tree.map((c) => c.name).sort()).toEqual(["Food", "Home", "Rent"]);
    expect(tree.find((c) => c.name === "Home")!.children).toEqual([]);
  });
});
