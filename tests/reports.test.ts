import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories, categoryEntries } from "@/lib/db/schema";
import { getGridData } from "@/lib/db/queries";
import { logExpense } from "@/lib/db/queries";
import { buildVarianceRows, parseReportView, totalOverspend } from "@/lib/report-view";

beforeEach(() => resetDb());

describe("report view", () => {
  it("defaults to budgeted for anything unknown", () => {
    expect(parseReportView(undefined)).toBe("budgeted");
    expect(parseReportView("nonsense")).toBe("budgeted");
    expect(parseReportView("spent")).toBe("spent");
    expect(parseReportView("compare")).toBe("compare");
  });
});

describe("variance rows", () => {
  const s = (group: string, amountPence: number) => ({ group, amountPence, color: "#000" });
  it("diff = spent - budgeted; positive is over budget", () => {
    const rows = buildVarianceRows([s("Housing", 100000), s("Food", 40000)], [s("Housing", 100000), s("Food", 55000)]);
    expect(rows.find((r) => r.key === "Housing")!.diffPence).toBe(0);
    expect(rows.find((r) => r.key === "Food")!.diffPence).toBe(15000);
  });
  it("keeps a group that was spent but never budgeted, and one budgeted but unspent", () => {
    const rows = buildVarianceRows([s("Bills", 5000)], [s("Fun", 2500)]);
    expect(rows.map((r) => [r.key, r.budgetedPence, r.spentPence, r.diffPence])).toEqual([
      ["Bills", 5000, 0, -5000],
      ["Fun", 0, 2500, 2500],
    ]);
  });
  it("drops rows with nothing on either side; orders by budget", () => {
    const rows = buildVarianceRows([s("Zero", 0), s("Small", 100), s("Big", 900)], []);
    expect(rows.map((r) => r.key)).toEqual(["Big", "Small"]);
  });
});

describe("totalOverspend", () => {
  const s = (group: string, amountPence: number) => ({ group, amountPence, color: "#000" });
  it("sums only groups that are over - an underspent group never offsets it", () => {
    // Housing +15000 over, Food -10000 under: net would be +5000, but the
    // real complaint was "overspend" silently absorbing an unrelated saving.
    const rows = buildVarianceRows([s("Housing", 50000), s("Food", 20000)], [s("Housing", 65000), s("Food", 10000)]);
    expect(totalOverspend(rows)).toBe(15000);
  });
  it("is 0 when nothing is over budget", () => {
    const rows = buildVarianceRows([s("Housing", 50000)], [s("Housing", 40000)]);
    expect(totalOverspend(rows)).toBe(0);
  });
});

describe("actualByMonth (Reports 'Spent') matches the grid's Actually spent", () => {
  it("sums to actuallySpentByMonth, for leaves, rollup parents, and paid-without-spend", async () => {
    const [parent] = await db.insert(categories).values({ name: "Subs" }).returning();
    const [kidA] = await db.insert(categories).values({ name: "A", parentId: parent.id }).returning();
    const [kidB] = await db.insert(categories).values({ name: "B", parentId: parent.id }).returning();
    const [leaf] = await db.insert(categories).values({ name: "Rent" }).returning();
    const [paidOnly] = await db.insert(categories).values({ name: "Gym" }).returning();
    await db.insert(categoryEntries).values([
      { categoryId: kidA.id, year: 2026, month: 3, amountPence: 1000, paid: false },
      { categoryId: kidB.id, year: 2026, month: 3, amountPence: 500, paid: false },
      { categoryId: leaf.id, year: 2026, month: 3, amountPence: 90000, paid: false },
      { categoryId: paidOnly.id, year: 2026, month: 3, amountPence: 2500, paid: true }, // paid, nothing logged
    ]);
    await logExpense({ categoryId: kidA.id, amountPence: 1200, entryDate: "2026-03-10" });
    await logExpense({ categoryId: leaf.id, amountPence: 90000, entryDate: "2026-03-01" });
    const data = await getGridData(2026);
    for (let m = 0; m < 12; m++) {
      const total = data.categories.reduce((s, c) => s + c.actualByMonth[m], 0);
      expect(total).toBe(data.actuallySpentByMonth[m]);
    }
    const subs = data.categories.find((c) => c.name === "Subs")!;
    expect(subs.actualByMonth[2]).toBe(1200); // kid A's logged spend; kid B has no spend and isn't paid
    expect(subs.children.find((c) => c.name === "A")!.actualByMonth[2]).toBe(1200);
    expect(data.categories.find((c) => c.name === "Gym")!.actualByMonth[2]).toBe(2500); // paid with no expense
    expect(subs.months[3].amountPence).toBe(1500); // budgeted stays the plan
  });
});
