import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories, categoryEntries, categoryParentMoves } from "@/lib/db/schema";
import { getGridData, logExpense } from "@/lib/db/queries";
import { getCategoryTree, moveCategoryOrder } from "@/lib/db/category-tree";

beforeEach(() => resetDb());
const YEAR = new Date().getFullYear();
const mk = async (name: string, sortOrder: number, parentId: number | null = null) =>
  (await db.insert(categories).values({ name, sortOrder, parentId }).returning())[0];
const names = async (year = YEAR) => (await getGridData(year)).categories.map((c) => c.name);
const kids = async (parent: string, year = YEAR) => (await getGridData(year)).categories.find((c) => c.name === parent)!.children.map((c) => c.name);

describe("moving top-level categories", () => {
  it("up and down swap with the neighbour; the order is what the grid shows", async () => {
    const [a, b, c] = [await mk("A", 0), await mk("B", 1), await mk("C", 2)];
    expect(await names()).toEqual(["A", "B", "C"]);
    expect(await moveCategoryOrder(b.id, "up", YEAR)).toBe(true);
    expect(await names()).toEqual(["B", "A", "C"]);
    expect(await moveCategoryOrder(a.id, "down", YEAR)).toBe(true);
    expect(await names()).toEqual(["B", "C", "A"]);
    await moveCategoryOrder(c.id, "up", YEAR);
    expect(await names()).toEqual(["C", "B", "A"]);
  });
  it("at either end it does nothing (returns false, order unchanged)", async () => {
    const [a, , c] = [await mk("A", 0), await mk("B", 1), await mk("C", 2)];
    expect(await moveCategoryOrder(a.id, "up", YEAR)).toBe(false);
    expect(await moveCategoryOrder(c.id, "down", YEAR)).toBe(false);
    expect(await names()).toEqual(["A", "B", "C"]);
  });
  it("is stable: many moves, then reload, still the order you made", async () => {
    const list = [];
    for (let i = 0; i < 6; i++) list.push(await mk("C" + i, i));
    await moveCategoryOrder(list[5].id, "up", YEAR);
    await moveCategoryOrder(list[5].id, "up", YEAR);
    await moveCategoryOrder(list[0].id, "down", YEAR);
    expect(await names()).toEqual(["C1", "C0", "C2", "C5", "C3", "C4"]);
    expect((await getCategoryTree()).map((c) => c.name)).toEqual(["C1", "C0", "C2", "C5", "C3", "C4"]);
  });
  it("categories with the same sort value (older data) still move, one place at a time", async () => {
    const [a, b, c] = [await mk("A", 0), await mk("B", 0), await mk("C", 0)];
    expect(await names()).toEqual(["A", "B", "C"]); // id breaks the tie
    await moveCategoryOrder(c.id, "up", YEAR);
    expect(await names()).toEqual(["A", "C", "B"]);
    await moveCategoryOrder(c.id, "up", YEAR);
    expect(await names()).toEqual(["C", "A", "B"]);
    expect(new Set((await db.select().from(categories)).map((r) => r.sortOrder)).size).toBe(3);
    void a; void b;
  });
  it("archived categories are skipped over, never counted as a place", async () => {
    const [a, , c] = [await mk("A", 0), await mk("Gone", 1), await mk("C", 2)];
    await db.update(categories).set({ archivedAt: new Date(2020, 0, 1) }).where(eq(categories.name, "Gone"));
    expect(await names()).toEqual(["A", "C"]);
    expect(await moveCategoryOrder(c.id, "up", YEAR)).toBe(true);
    expect(await names()).toEqual(["C", "A"]);
    expect(await moveCategoryOrder(a.id, "down", YEAR)).toBe(false);
  });
  it("a category that is not shown for that year is refused", async () => {
    const a = await mk("A", 0);
    await db.update(categories).set({ archivedAt: new Date(2020, 0, 1) }).where(eq(categories.id, a.id));
    await expect(moveCategoryOrder(a.id, "up", YEAR)).rejects.toThrow(/isn't shown/);
    await expect(moveCategoryOrder(9999, "up", YEAR)).rejects.toThrow(/isn't shown/);
  });
});

describe("subcategories only move inside their own category", () => {
  it("reorders among its siblings and never leaves or affects other parents or top level", async () => {
    const p1 = await mk("P1", 0), p2 = await mk("P2", 1), top = await mk("Top", 2);
    const a = await mk("a", 10, p1.id), b = await mk("b", 11, p1.id), c = await mk("c", 12, p1.id);
    await mk("x", 20, p2.id);
    await moveCategoryOrder(c.id, "up", YEAR);
    expect(await kids("P1")).toEqual(["a", "c", "b"]);
    await moveCategoryOrder(c.id, "up", YEAR);
    expect(await kids("P1")).toEqual(["c", "a", "b"]);
    expect(await names()).toEqual(["P1", "P2", "Top"]); // top level untouched
    expect(await kids("P2")).toEqual(["x"]);
    const rows = await db.select().from(categories);
    expect(rows.find((r) => r.id === c.id)!.parentId).toBe(p1.id); // still under P1
    void a; void b; void top;
  });
  it("the first subcategory cannot be pushed 'up' out of its category, the last cannot go 'down' out of it", async () => {
    const p = await mk("P", 0);
    const first = await mk("first", 10, p.id), last = await mk("last", 11, p.id);
    await mk("Other", 1);
    expect(await moveCategoryOrder(first.id, "up", YEAR)).toBe(false);
    expect(await moveCategoryOrder(last.id, "down", YEAR)).toBe(false);
    expect(await kids("P")).toEqual(["first", "last"]);
    expect((await db.select().from(categories).where(eq(categories.id, first.id)))[0].parentId).toBe(p.id);
  });
  it("a lone subcategory has nowhere to move", async () => {
    const p = await mk("P", 0);
    const only = await mk("only", 10, p.id);
    expect(await moveCategoryOrder(only.id, "up", YEAR)).toBe(false);
    expect(await moveCategoryOrder(only.id, "down", YEAR)).toBe(false);
  });
  it("uses the parent a category has in THAT year (a move to another parent is respected)", async () => {
    const p1 = await mk("P1", 0), p2 = await mk("P2", 1);
    const a = await mk("a", 10, p1.id), b = await mk("b", 11, p1.id);
    const x = await mk("x", 20, p2.id);
    await db.insert(categoryParentMoves).values({ categoryId: b.id, parentId: p2.id, effectiveYear: YEAR }); // b now lives under P2
    expect(await kids("P1")).toEqual(["a"]);
    expect(await kids("P2")).toEqual(["b", "x"]); // b's sort value (11) comes before x's (20)
    await moveCategoryOrder(x.id, "up", YEAR);
    expect(await kids("P2")).toEqual(["x", "b"]);
    expect(await kids("P1")).toEqual(["a"]);
    void a;
  });
});

describe("the maths never changes", () => {
  it("every total, cell, rollup and year figure is identical before and after any number of moves", async () => {
    const rent = await mk("Rent", 0), subs = await mk("Subs", 1), food = await mk("Food", 2);
    const s1 = await mk("S1", 10, subs.id), s2 = await mk("S2", 11, subs.id), s3 = await mk("S3", 12, subs.id);
    await db.insert(categoryEntries).values([
      { categoryId: rent.id, year: YEAR, month: 3, amountPence: 90000, paid: true },
      { categoryId: s1.id, year: YEAR, month: 3, amountPence: 1000, paid: false },
      { categoryId: s2.id, year: YEAR, month: 3, amountPence: 2500, paid: true },
      { categoryId: s3.id, year: YEAR, month: 4, amountPence: 700, paid: false },
      { categoryId: food.id, year: YEAR, month: 3, amountPence: 40000, paid: false },
    ]);
    await logExpense({ categoryId: rent.id, amountPence: 90000, entryDate: `${YEAR}-03-01` });
    await logExpense({ categoryId: s2.id, amountPence: 2600, entryDate: `${YEAR}-03-09` });
    await logExpense({ categoryId: food.id, amountPence: 41000, entryDate: `${YEAR}-03-10` });

    const strip = (g: Awaited<ReturnType<typeof getGridData>>) => {
      const { categories: cats, incomeSources, ...totals } = g;
      const flat = new Map<string, unknown>();
      for (const c of cats) {
        flat.set(c.name, { months: c.months, y: c.yearTotalPence, avg: c.monthlyAveragePence, actual: c.actualByMonth });
        for (const k of c.children) flat.set(`${c.name}/${k.name}`, { months: k.months, y: k.yearTotalPence, avg: k.monthlyAveragePence, actual: k.actualByMonth });
      }
      return { totals, flat: Object.fromEntries([...flat].sort(([a], [b]) => a.localeCompare(b))), incomeSources };
    };
    const before = strip(await getGridData(YEAR));
    for (const [id, dir] of [[food.id, "up"], [food.id, "up"], [subs.id, "down"], [s3.id, "up"], [s3.id, "up"], [s1.id, "down"], [rent.id, "down"], [rent.id, "down"]] as const) {
      await moveCategoryOrder(id, dir, YEAR);
    }
    expect(strip(await getGridData(YEAR))).toEqual(before);
    // and only the order of the lists actually changed
    expect((await getGridData(YEAR)).categories.map((c) => c.name)).not.toEqual(["Rent", "Subs", "Food"]);
  });
  it("previous and next years are untouched too (carry-over chain)", async () => {
    const a = await mk("A", 0), b = await mk("B", 1);
    await db.insert(categoryEntries).values([{ categoryId: a.id, year: YEAR - 1, month: 12, amountPence: 500, paid: false }, { categoryId: b.id, year: YEAR - 1, month: 12, amountPence: 300, paid: false }]);
    const before = JSON.stringify({ py: (await getGridData(YEAR - 1)).plannedByMonth, y: (await getGridData(YEAR)).leftToSpendByMonth });
    await moveCategoryOrder(b.id, "up", YEAR);
    const after = JSON.stringify({ py: (await getGridData(YEAR - 1)).plannedByMonth, y: (await getGridData(YEAR)).leftToSpendByMonth });
    expect(after).toBe(before);
  });
  it("writes nothing but sort_order: every other column of every row is byte-identical", async () => {
    const p = await mk("P", 0), a = await mk("a", 5, p.id), b = await mk("b", 6, p.id);
    await mk("Top", 1);
    const strip = (rows: (typeof categories.$inferSelect)[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "sortOrder")));
    const before = strip(await db.select().from(categories));
    await moveCategoryOrder(b.id, "up", YEAR);
    await moveCategoryOrder(p.id, "down", YEAR);
    expect(strip(await db.select().from(categories))).toEqual(before);
    void a;
  });
});

import { dropIndex, slotY, autoScrollSpeed } from "@/lib/reorder";
import { reorderCategoryTo } from "@/lib/db/category-tree";

describe("moving to a position (press-and-hold drag)", () => {
  it("drops at the start, the middle and the end", async () => {
    const list = [];
    for (let i = 0; i < 5; i++) list.push(await mk("C" + i, i));
    expect(await reorderCategoryTo(list[4].id, 0, YEAR)).toBe(true);
    expect(await names()).toEqual(["C4", "C0", "C1", "C2", "C3"]);
    expect(await reorderCategoryTo(list[4].id, 2, YEAR)).toBe(true);
    expect(await names()).toEqual(["C0", "C1", "C4", "C2", "C3"]);
    expect(await reorderCategoryTo(list[0].id, 4, YEAR)).toBe(true);
    expect(await names()).toEqual(["C1", "C4", "C2", "C3", "C0"]);
  });
  it("dropping where it already is does nothing; an index past either end is clamped", async () => {
    const [a, b, c] = [await mk("A", 0), await mk("B", 1), await mk("C", 2)];
    expect(await reorderCategoryTo(b.id, 1, YEAR)).toBe(false);
    expect(await reorderCategoryTo(a.id, -5, YEAR)).toBe(false); // clamped to 0: already first
    expect(await reorderCategoryTo(a.id, 99, YEAR)).toBe(true); // clamped to the end
    expect(await names()).toEqual(["B", "C", "A"]);
    void c;
  });
  it("refuses a non-integer position", async () => {
    const a = await mk("A", 0);
    await expect(reorderCategoryTo(a.id, 1.5, YEAR)).rejects.toThrow(/position/);
    await expect(reorderCategoryTo(a.id, Number.NaN, YEAR)).rejects.toThrow(/position/);
  });
  it("a subcategory can only land among its own category's subcategories (positions are within the group)", async () => {
    const p = await mk("P", 0), other = await mk("Other", 1);
    const a = await mk("a", 10, p.id), b = await mk("b", 11, p.id), c = await mk("c", 12, p.id);
    await reorderCategoryTo(c.id, 0, YEAR);
    expect(await kids("P")).toEqual(["c", "a", "b"]);
    await reorderCategoryTo(c.id, 99, YEAR); // clamped to the END OF ITS GROUP, never out into the top level
    expect(await kids("P")).toEqual(["a", "b", "c"]);
    expect(await names()).toEqual(["P", "Other"]);
    expect((await db.select().from(categories).where(eq(categories.id, c.id)))[0].parentId).toBe(p.id);
    void a; void b; void other;
  });
  it("any number of drops leaves every total, cell and rollup identical", async () => {
    const rent = await mk("Rent", 0), subs = await mk("Subs", 1), food = await mk("Food", 2);
    const s1 = await mk("S1", 10, subs.id), s2 = await mk("S2", 11, subs.id);
    await db.insert(categoryEntries).values([
      { categoryId: rent.id, year: YEAR, month: 3, amountPence: 90000, paid: true },
      { categoryId: s1.id, year: YEAR, month: 3, amountPence: 1000, paid: false },
      { categoryId: s2.id, year: YEAR, month: 3, amountPence: 2500, paid: true },
      { categoryId: food.id, year: YEAR, month: 3, amountPence: 40000, paid: false },
    ]);
    await logExpense({ categoryId: s2.id, amountPence: 2600, entryDate: `${YEAR}-03-09` });
    const snap = async () => JSON.stringify(((await getGridData(YEAR)).categories).map((c) => ({ n: c.name, m: c.months, y: c.yearTotalPence, k: c.children.map((k) => ({ n: k.name, m: k.months })).sort((p, q) => p.n.localeCompare(q.n)) })).sort((p, q) => p.n.localeCompare(q.n)));
    const before = await snap();
    const totals = JSON.stringify([(await getGridData(YEAR)).plannedByMonth, (await getGridData(YEAR)).actuallySpentByMonth]);
    for (const [id, i] of [[food.id, 0], [rent.id, 2], [subs.id, 0], [s2.id, 0], [s1.id, 5]] as const) await reorderCategoryTo(id, i, YEAR);
    expect(await snap()).toBe(before);
    expect(JSON.stringify([(await getGridData(YEAR)).plannedByMonth, (await getGridData(YEAR)).actuallySpentByMonth])).toBe(totals);
  });
});

describe("drag maths (pure)", () => {
  const rows = [
    { id: 1, top: 0, bottom: 40 },
    { id: 2, top: 40, bottom: 80 },
    { id: 3, top: 80, bottom: 120 },
    { id: 4, top: 120, bottom: 160 },
  ];
  it("the drop index counts the OTHER rows whose middle is above the pointer", () => {
    expect(dropIndex(5, rows, 3)).toBe(0); // above row 1's middle (20)
    expect(dropIndex(30, rows, 3)).toBe(1);
    expect(dropIndex(70, rows, 3)).toBe(2); // rows 1,2 are above; row 3 is the one being dragged (ignored)
    expect(dropIndex(500, rows, 3)).toBe(3); // past everything: the end (3 others)
    expect(dropIndex(-50, rows, 1)).toBe(0);
  });
  it("dragging a row over itself keeps it where it is", () => {
    for (const r of rows) expect(dropIndex((r.top + r.bottom) / 2, rows, r.id)).toBe(rows.findIndex((x) => x.id === r.id));
  });
  it("the drop line sits above the row it pushes down, or at the end of the group past the last", () => {
    expect(slotY(0, rows, 3, 200)).toBe(0);
    expect(slotY(2, rows, 1, 200)).toBe(120); // others = 2,3,4 -> index 2 is row 4, top 120
    expect(slotY(3, rows, 1, 200)).toBe(200); // past the last other row -> endY (includes any expanded children)
  });
  it("auto-scroll: still in the middle, faster and faster toward either edge", () => {
    expect(autoScrollSpeed(300, 0, 600)).toBe(0);
    expect(autoScrollSpeed(560, 0, 600)).toBeGreaterThan(0);
    expect(autoScrollSpeed(595, 0, 600)).toBeGreaterThan(autoScrollSpeed(560, 0, 600));
    expect(autoScrollSpeed(40, 0, 600)).toBeLessThan(0);
    expect(autoScrollSpeed(-30, 0, 600)).toBe(-16); // capped
    expect(autoScrollSpeed(700, 0, 600)).toBe(16);
  });
});

import { slideOffsets, targetIndex } from "@/lib/reorder";

describe("sortable-list motion maths (pure)", () => {
  // four blocks 40px tall (the second is a taller 100px: a row with expanded children), in content coordinates
  const blocks = [
    { id: 1, mid: 20, height: 40 },
    { id: 2, mid: 90, height: 100 },
    { id: 3, mid: 160, height: 40 },
    { id: 4, mid: 200, height: 40 },
  ];
  it("target index = how many OTHER blocks are wholly above the pointer's position", () => {
    expect(targetIndex(0, blocks, 3)).toBe(0);
    expect(targetIndex(100, blocks, 3)).toBe(2);
    expect(targetIndex(9999, blocks, 3)).toBe(3);
    for (const b of blocks) expect(targetIndex(b.mid, blocks, b.id)).toBe(blocks.findIndex((x) => x.id === b.id));
  });
  it("dragging DOWN: the blocks passed slide up by the dragged height, the placeholder moves down by what it passed", () => {
    const m = slideOffsets(blocks, 1, 2); // block 1 (40px) lands after block 3
    expect(m.get(2)).toBe(-40);
    expect(m.get(3)).toBe(-40);
    expect(m.get(4)).toBe(0);
    expect(m.get(1)).toBe(100 + 40); // passed block 2 (100) and block 3 (40)
  });
  it("dragging UP: the blocks passed slide down by the dragged height, the placeholder moves up", () => {
    const m = slideOffsets(blocks, 4, 1); // block 4 (40px) lands where block 2 is
    expect(m.get(2)).toBe(40);
    expect(m.get(3)).toBe(40);
    expect(m.get(1)).toBe(0);
    expect(m.get(4)).toBe(-(100 + 40));
  });
  it("the layout stays consistent: after applying the offsets no two blocks overlap and the total height is unchanged", () => {
    const tops = (ids: number[]) => { let y = 0; return new Map(ids.map((id) => { const t = y; y += blocks.find((b) => b.id === id)!.height; return [id, t]; })); };
    for (const dragged of [1, 2, 3, 4]) {
      for (let to = 0; to < 4; to++) {
        const order = blocks.map((b) => b.id).filter((id) => id !== dragged);
        order.splice(to, 0, dragged);
        const wanted = tops(order);                       // where each block SHOULD end up
        const m = slideOffsets(blocks, dragged, to);
        const natural = tops(blocks.map((b) => b.id));    // where each block is now
        for (const b of blocks) expect(natural.get(b.id)! + m.get(b.id)!).toBe(wanted.get(b.id)!);
      }
    }
  });
  it("dropping where it already is moves nothing", () => {
    for (const v of slideOffsets(blocks, 3, 2).values()) expect(v).toBe(0);
  });
});
