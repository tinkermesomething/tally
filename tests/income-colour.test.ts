import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { incomeEntries, incomeSources } from "@/lib/db/schema";
import { getGridData, getIncomeSourceList, setIncomeSourceColor } from "@/lib/db/queries";

beforeEach(() => resetDb());
const mk = async (name: string, sortOrder = 0) => (await db.insert(incomeSources).values({ name, sortOrder }).returning())[0];
const colorOf = async (id: number) => (await db.select().from(incomeSources).where(eq(incomeSources.id, id)))[0].color;

describe("income source colour", () => {
  it("starts unset (automatic)", async () => {
    const s = await mk("Wages");
    expect(s.color).toBeNull();
    expect((await getIncomeSourceList())[0].color).toBeNull();
  });
  it("is saved, shows in the settings list and in the grid's income rows", async () => {
    const s = await mk("Wages");
    await db.insert(incomeEntries).values({ incomeSourceId: s.id, year: 2026, month: 1, amountPence: 100 });
    await setIncomeSourceColor(s.id, "#1BAF7A");
    expect(await colorOf(s.id)).toBe("#1BAF7A");
    expect((await getIncomeSourceList())[0].color).toBe("#1BAF7A");
    expect((await getGridData(2026)).incomeSources[0].color).toBe("#1BAF7A");
  });
  it("null or an empty string clears it back to automatic", async () => {
    const s = await mk("Wages");
    await setIncomeSourceColor(s.id, "#112233");
    await setIncomeSourceColor(s.id, null);
    expect(await colorOf(s.id)).toBeNull();
    await setIncomeSourceColor(s.id, "#112233");
    await setIncomeSourceColor(s.id, "");
    expect(await colorOf(s.id)).toBeNull();
  });
  it("only a plain #rrggbb gets in (the value ends up in CSS) - nothing is saved otherwise", async () => {
    const s = await mk("Wages");
    await setIncomeSourceColor(s.id, "#abcdef");
    for (const bad of ["red", "#abc", "#abcdeg", "abcdef", "#abcdef;x", "url(javascript:alert(1))", "var(--chart-1)", "#abcdef00", "rgb(1,2,3)"]) {
      await expect(setIncomeSourceColor(s.id, bad)).rejects.toThrow(/Colour/);
    }
    expect(await colorOf(s.id)).toBe("#abcdef");
  });
  it("a missing source is refused", async () => {
    await expect(setIncomeSourceColor(999, "#abcdef")).rejects.toThrow(/no longer exists/);
  });
  it("colours are per source: changing one never touches another", async () => {
    const a = await mk("Wages", 0), b = await mk("Loans", 1);
    await setIncomeSourceColor(a.id, "#111111");
    expect(await colorOf(b.id)).toBeNull();
    await setIncomeSourceColor(b.id, "#222222");
    expect(await colorOf(a.id)).toBe("#111111");
  });
  it("changing a colour changes nothing about the money (income totals identical)", async () => {
    const s = await mk("Wages");
    await db.insert(incomeEntries).values([{ incomeSourceId: s.id, year: 2026, month: 1, amountPence: 400000 }, { incomeSourceId: s.id, year: 2026, month: 2, amountPence: 410000 }]);
    const before = JSON.stringify((await getGridData(2026)).incomeSources[0].months) + (await getGridData(2026)).wagesByMonth.join();
    await setIncomeSourceColor(s.id, "#ff00aa");
    expect(JSON.stringify((await getGridData(2026)).incomeSources[0].months) + (await getGridData(2026)).wagesByMonth.join()).toBe(before);
  });
});
