import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { incomeSources } from "@/lib/db/schema";
import { addIncomeSource, archiveIncomeSource } from "@/lib/db/queries";
import { renameIncomeSource, reorderIncomeSourceTo } from "@/lib/db/income-order";

const order = async () => (await db.query.incomeSources.findMany({ orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.id)] })).map((s) => s.name);

describe("income source order and rename", () => {
  beforeEach(() => resetDb());

  it("moves a source to a position, clamping past the ends", async () => {
    for (const n of ["A", "B", "C", "D"]) await addIncomeSource(n);
    const [, , c] = await db.select().from(incomeSources);
    expect(await reorderIncomeSourceTo(c.id, 0, 2026)).toBe(true);
    expect(await order()).toEqual(["C", "A", "B", "D"]);
    expect(await reorderIncomeSourceTo(c.id, 99, 2026)).toBe(true);
    expect(await order()).toEqual(["A", "B", "D", "C"]);
    expect(await reorderIncomeSourceTo(c.id, 3, 2026)).toBe(false); // already last
  });

  it("repairs tied sort values", async () => {
    for (const n of ["A", "B", "C"]) await addIncomeSource(n);
    await db.update(incomeSources).set({ sortOrder: 0 });
    const rows = await db.select().from(incomeSources);
    await reorderIncomeSourceTo(rows[2].id, 0, 2026);
    expect(new Set((await db.select().from(incomeSources)).map((s) => s.sortOrder)).size).toBe(3);
  });

  it("leaves archived sources out of the move", async () => {
    for (const n of ["A", "B", "C"]) await addIncomeSource(n);
    const [a, b, c] = await db.select().from(incomeSources);
    await archiveIncomeSource(b.id);
    await reorderIncomeSourceTo(c.id, 0, 2999);
    expect(await order()).toEqual(["C", "B", "A"]); // B (archived) kept its own slot value
    expect(a.id).toBeDefined();
    await expect(reorderIncomeSourceTo(b.id, 0, 2999)).rejects.toThrow("isn't shown");
  });

  it("renames, trims and validates", async () => {
    await addIncomeSource("Wages");
    const [w] = await db.select().from(incomeSources);
    await renameIncomeSource(w.id, "  Salary ");
    expect((await db.select().from(incomeSources))[0].name).toBe("Salary");
    await expect(renameIncomeSource(w.id, "   ")).rejects.toThrow("name");
    await expect(renameIncomeSource(w.id, "x".repeat(81))).rejects.toThrow("under");
    await expect(renameIncomeSource(9999, "Nope")).rejects.toThrow("no longer exists");
  });
});
