import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: async () => ({ user: { email: "t@t", sub: "test-sub" } }) }));
vi.mock("next/cache", () => ({ revalidatePath() {} }));

import { resetDb } from "./helpers/db";
import { asSignedInUser } from "./helpers/user";
import { db } from "@/lib/db";
import { categories, expenseEntries, incomeSources, incomeTransactions } from "@/lib/db/schema";
import { getGridData } from "@/lib/db/queries";
import { logExpense, logIncome } from "@/app/grid/actions";

const YEAR = 2026;

beforeEach(() => resetDb());

// The two top-right grid buttons must work on an empty budget: the new
// category / income source is created in the same step as the entry.
describe("logIncome with a new income source", () => {
  it(
    "creates the source and logs the income against it, on a budget with no sources",
    asSignedInUser("test-sub", "t@t", async () => {
      const res = await logIncome({ newSourceName: "  Salary ", pounds: 1500, entryDate: `${YEAR}-10-05` });
      expect(res.ok).toBe(true);
      const sources = await db.select().from(incomeSources);
      expect(sources.map((s) => s.name)).toEqual(["Salary"]);
      const rows = await db.select().from(incomeTransactions);
      expect(rows).toHaveLength(1);
      expect(rows[0].incomeSourceId).toBe(sources[0].id);
      expect((await getGridData(YEAR)).wagesByMonth[9]).toBe(150000);
    })
  );

  it(
    "a blank name or a non-positive amount creates nothing",
    asSignedInUser("test-sub", "t@t", async () => {
      expect((await logIncome({ newSourceName: "   ", pounds: 10, entryDate: `${YEAR}-10-05` })).ok).toBe(false);
      expect((await logIncome({ newSourceName: "Salary", pounds: 0, entryDate: `${YEAR}-10-05` })).ok).toBe(false);
      expect(await db.select().from(incomeSources)).toHaveLength(0);
    })
  );

  it(
    "neither an id nor a name is an error, not a crash",
    asSignedInUser("test-sub", "t@t", async () => {
      expect((await logIncome({ pounds: 10, entryDate: `${YEAR}-10-05` })).ok).toBe(false);
    })
  );
});

describe("logExpense with a new category", () => {
  it(
    "creates a top-level category and logs the expense against it, on a budget with no categories",
    asSignedInUser("test-sub", "t@t", async () => {
      const res = await logExpense({ newCategoryName: " Groceries ", pounds: 42.5, entryDate: `${YEAR}-10-05` });
      expect(res.ok).toBe(true);
      const cats = await db.select().from(categories);
      expect(cats).toHaveLength(1);
      expect(cats[0]).toMatchObject({ name: "Groceries", parentId: null, isAnnual: false });
      const rows = await db.select().from(expenseEntries);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ categoryId: cats[0].id, amountPence: 4250 });
    })
  );

  it(
    "a failed log leaves no empty category behind",
    asSignedInUser("test-sub", "t@t", async () => {
      expect((await logExpense({ newCategoryName: "Groceries", pounds: 0, entryDate: `${YEAR}-10-05` })).ok).toBe(false);
      expect((await logExpense({ newCategoryName: "Groceries", pounds: 5, entryDate: "not-a-date" })).ok).toBe(false);
      expect(await db.select().from(categories)).toHaveLength(0);
      expect(await db.select().from(expenseEntries)).toHaveLength(0);
    })
  );

  it(
    "a blank name, or neither an id nor a name, is an error",
    asSignedInUser("test-sub", "t@t", async () => {
      expect((await logExpense({ newCategoryName: "  ", pounds: 5, entryDate: `${YEAR}-10-05` })).ok).toBe(false);
      expect((await logExpense({ pounds: 5, entryDate: `${YEAR}-10-05` })).ok).toBe(false);
      expect(await db.select().from(categories)).toHaveLength(0);
    })
  );
});
