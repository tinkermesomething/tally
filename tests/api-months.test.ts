import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories, categoryEntries, incomeEntries, incomeSources } from "@/lib/db/schema";
import { PUT as putIncome } from "@/app/api/v1/income/entries/route";
import { PUT as putCategoryEntry } from "@/app/api/v1/categories/[id]/entries/route";

function req(body: unknown) {
  return new Request("http://x/api", {
    method: "PUT",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(resetDb);

// API.md documents months as 1-12, and so does the schema/grid.
describe("API month range is 1-12 (matches DB + API.md)", () => {
  it("income PUT accepts December", async () => {
    const [src] = await db.insert(incomeSources).values({ name: "Wages" }).returning();
    const res = await putIncome(req({ incomeSourceId: src.id, year: 2026, month: 12, pounds: 10 }), undefined);
    expect(res.status).toBe(200);
    expect((await db.select().from(incomeEntries))[0].month).toBe(12);
  });

  it("income PUT rejects month 0", async () => {
    const [src] = await db.insert(incomeSources).values({ name: "Wages" }).returning();
    const res = await putIncome(req({ incomeSourceId: src.id, year: 2026, month: 0, pounds: 10 }), undefined);
    expect(res.status).toBe(400);
    expect(await db.select().from(incomeEntries)).toHaveLength(0);
  });

  it("category entry PUT accepts December and rejects 0", async () => {
    const [cat] = await db.insert(categories).values({ name: "Rent" }).returning();
    const ctx = { params: Promise.resolve({ id: String(cat.id) }) };
    expect((await putCategoryEntry(req({ year: 2026, month: 12, pounds: 5 }), ctx)).status).toBe(200);
    expect((await putCategoryEntry(req({ year: 2026, month: 0, pounds: 5 }), ctx)).status).toBe(400);
    const rows = await db.select().from(categoryEntries);
    expect(rows.map((r) => r.month)).toEqual([12]);
  });
});
