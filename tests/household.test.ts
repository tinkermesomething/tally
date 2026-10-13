import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveCurrentUser (pulled in transitively via tests/helpers/user.ts's
// asSignedInUser) reads the real @/auth, which imports next-auth - same
// mock tests/backup-actions.test.ts already uses, for the same reason
// (the real module fails to resolve "next/server" under vitest). Unlike
// that file, THIS one needs two genuinely different signed-in identities
// in the same test (two household members) - a fixed mocked sub can't do
// that, so it reads a mutable ref instead, same pattern as that file's own
// `fwdFor`.
const currentSub = vi.hoisted(() => ({ value: "test-sub" }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { email: "t@t", sub: currentSub.value } }) }));

import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { asSignedInUser as realAsSignedInUser, seedSignedInUser } from "./helpers/user";

/** Sets the mocked auth()'s sub to match BEFORE resolveCurrentUser (inside
 * asSignedInUser) reads it - the real helper has no way to know which of
 * several seeded users this particular call means otherwise. */
function asSignedInUser(sub: string, email: string, fn: () => Promise<void>) {
  currentSub.value = sub;
  return realAsSignedInUser(sub, email, fn);
}
import { db } from "@/lib/db";
import { getSystemConn } from "@/lib/db/system-connection";
import { categories, categoryEntries, expenseEntries, incomeEntries, incomeSources, users } from "@/lib/db/schema";
import { linkCategoryToHousehold, shareCategoryExpenses, shareIncomeSource, setExpenseHouseholdShare } from "@/lib/db/household-tags";
import {
  getHouseholdCellDetail,
  getHouseholdExpenses,
  getHouseholdGrid,
  getHouseholdIncome,
  getHouseholdIncomeGrid,
  getHouseholdYears,
  isHouseholdEnabled,
  reconcileHouseholdDataForUser,
  removeHouseholdDataForUser,
  setHouseholdEnabled,
} from "@/lib/db/household";
import { deleteUser } from "@/lib/db/users";
import { logExpense } from "@/lib/db/queries";

beforeEach(() => resetDb());

const ADMIN = "admin@example.com";

describe("isHouseholdEnabled / setHouseholdEnabled", () => {
  it("off by default, flips either way, survives being called with no row yet", async () => {
    expect(await isHouseholdEnabled()).toBe(false);
    await setHouseholdEnabled(true);
    expect(await isHouseholdEnabled()).toBe(true);
    await setHouseholdEnabled(false);
    expect(await isHouseholdEnabled()).toBe(false);
  });
});

describe("reconcileHouseholdDataForUser", () => {
  it("does nothing at all while the feature is off instance-wide", async () => {
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      const [e] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 1000, entryDate: "2026-09-01" }).returning();
      await setExpenseHouseholdShare(e.id, true);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    expect(await getHouseholdExpenses()).toHaveLength(0);
  });

  it("two different users' shared expenses both show up, correctly attributed, after enabling", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    const bob = await seedSignedInUser("bob-sub", "bob@example.com");

    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      const [e] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 1000, entryDate: "2026-09-01" }).returning();
      await setExpenseHouseholdShare(e.id, true);
      await reconcileHouseholdDataForUser(alice.id);
    })();

    await asSignedInUser("bob-sub", "bob@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Rent" }).returning();
      const [e] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 50000, entryDate: "2026-09-02" }).returning();
      await setExpenseHouseholdShare(e.id, true);
      await reconcileHouseholdDataForUser(bob.id);
    })();

    const rows = await getHouseholdExpenses();
    expect(rows).toHaveLength(2);
    const byCategory = Object.fromEntries(rows.map((r) => [r.categoryName, r]));
    expect(byCategory["Groceries"]).toMatchObject({ amountPence: 1000, sourceUserName: "Test User" });
    expect(byCategory["Rent"]).toMatchObject({ amountPence: 50000 });
    // Different users, so different row ids even with the same seeded name.
    expect(byCategory["Groceries"].sourceUserId).not.toBe(byCategory["Rent"].sourceUserId);
  });

  it("is a full replace, not a diff - un-sharing makes the row disappear on the next reconcile", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      const [e] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 1000, entryDate: "2026-09-01" }).returning();
      await setExpenseHouseholdShare(e.id, true);
      await reconcileHouseholdDataForUser(alice.id);
      expect(await getHouseholdExpenses()).toHaveLength(1);

      await setExpenseHouseholdShare(e.id, false);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    expect(await getHouseholdExpenses()).toHaveLength(0);
  });

  it("editing a shared expense's amount is reflected on the next reconcile", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      const [e] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 1000, entryDate: "2026-09-01" }).returning();
      await setExpenseHouseholdShare(e.id, true);
      await reconcileHouseholdDataForUser(alice.id);

      await db.update(expenseEntries).set({ amountPence: 1500 }).where(eq(expenseEntries.id, e.id));
      await reconcileHouseholdDataForUser(alice.id);
    })();
    const [row] = await getHouseholdExpenses();
    expect(row.amountPence).toBe(1500);
  });

  it("shared income sources reconcile too, with every month included", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [source] = await db.insert(incomeSources).values({ name: "Salary" }).returning();
      await db.insert(incomeEntries).values([
        { incomeSourceId: source.id, year: 2026, month: 8, amountPence: 250000 },
        { incomeSourceId: source.id, year: 2026, month: 9, amountPence: 250000 },
      ]);
      await shareIncomeSource(source.id, true);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    const rows = await getHouseholdIncome();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.sourceName === "Salary")).toBe(true);
  });

  it("shareCategoryExpenses backfill + reconcile shows every ticked expense", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      const e1 = (await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 1000, entryDate: "2026-09-01" }).returning())[0];
      const e2 = (await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 2000, entryDate: "2026-09-02" }).returning())[0];
      await shareCategoryExpenses(cat.id, [e1.id, e2.id]);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    expect(await getHouseholdExpenses()).toHaveLength(2);
  });
});

describe("removeHouseholdDataForUser / deleteUser cleanup", () => {
  it("deleting a user removes their rows from the shared tables", async () => {
    await setHouseholdEnabled(true);
    const admin = await seedSignedInUser("admin-sub", ADMIN);
    const bob = await seedSignedInUser("bob-sub", "bob@example.com");
    await asSignedInUser("bob-sub", "bob@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Rent" }).returning();
      const [e] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 50000, entryDate: "2026-09-01" }).returning();
      await setExpenseHouseholdShare(e.id, true);
      await reconcileHouseholdDataForUser(bob.id);
    })();
    expect(await getHouseholdExpenses()).toHaveLength(1);

    await deleteUser(bob.id, admin.id, ADMIN);
    expect(await getHouseholdExpenses()).toHaveLength(0);
  });

  it("removeHouseholdDataForUser is harmless when there was nothing to remove", async () => {
    await expect(removeHouseholdDataForUser(999)).resolves.not.toThrow();
  });
});

describe("budgeted figures (lib/db/household.ts's household_category_budgets)", () => {
  it("sharing a category mirrors its budgeted monthly figures too, not just actual expenses", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries", groupName: "Living" }).returning();
      await db.insert(categoryEntries).values([
        { categoryId: cat.id, year: 2026, month: 8, amountPence: 40000 },
        { categoryId: cat.id, year: 2026, month: 9, amountPence: 45000 },
      ]);
      await linkCategoryToHousehold(cat.id, true, []);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    const grid = await getHouseholdGrid(2026);
    const groceries = grid.find((r) => r.categoryName === "Groceries");
    expect(groceries?.groupName).toBe("Living");
    expect(groceries?.months[8].budgetedPence).toBe(40000);
    expect(groceries?.months[9].budgetedPence).toBe(45000);
    expect(groceries?.yearBudgetedPence).toBe(85000);
  });

  it("turning sharing off stops future budgeted figures from reconciling in", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      await db.insert(categoryEntries).values({ categoryId: cat.id, year: 2026, month: 8, amountPence: 40000 });
      await linkCategoryToHousehold(cat.id, true, []);
      await reconcileHouseholdDataForUser(alice.id);
      await linkCategoryToHousehold(cat.id, false, []);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    expect(await getHouseholdGrid(2026)).toHaveLength(0);
  });
});

describe("getHouseholdGrid - the real grid replica", () => {
  it("two different users' same-named category merges into ONE row, summed per month", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    const bob = await seedSignedInUser("bob-sub", "bob@example.com");

    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      await db.insert(categoryEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 30000 });
      const [e] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 12000, entryDate: "2026-09-05" }).returning();
      await linkCategoryToHousehold(cat.id, true, [e.id]);
      await reconcileHouseholdDataForUser(alice.id);
    })();

    await asSignedInUser("bob-sub", "bob@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      await db.insert(categoryEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 20000 });
      const [e] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 8000, entryDate: "2026-09-10" }).returning();
      await linkCategoryToHousehold(cat.id, true, [e.id]);
      await reconcileHouseholdDataForUser(bob.id);
    })();

    const grid = await getHouseholdGrid(2026);
    expect(grid).toHaveLength(1);
    expect(grid[0]).toMatchObject({ categoryName: "Groceries" });
    expect(grid[0].months[9]).toEqual({ budgetedPence: 50000, spentPence: 20000 });
    expect(grid[0].yearBudgetedPence).toBe(50000);
    expect(grid[0].yearSpentPence).toBe(20000);
  });

  it("contributors list every distinct name sharing the row, deduped, alphabetical", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    const bob = await seedSignedInUser("bob-sub", "bob@example.com");
    await getSystemConn().db.update(users).set({ name: "Bob" }).where(eq(users.id, bob.id));
    await getSystemConn().db.update(users).set({ name: "Alice" }).where(eq(users.id, alice.id));

    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      await db.insert(categoryEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 30000 });
      const [e1] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 5000, entryDate: "2026-09-01" }).returning();
      const [e2] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 3000, entryDate: "2026-09-02" }).returning();
      await linkCategoryToHousehold(cat.id, true, [e1.id, e2.id]);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    await asSignedInUser("bob-sub", "bob@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      await db.insert(categoryEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 20000 });
      await linkCategoryToHousehold(cat.id, true, []);
      await reconcileHouseholdDataForUser(bob.id);
    })();

    const grid = await getHouseholdGrid(2026);
    const groceries = grid.find((r) => r.categoryName === "Groceries");
    // Alice has two expense entries, not two contributor rows - the set
    // dedupes same-name repeats, and the result is alphabetical regardless
    // of insertion order (Bob's budget row went in after Alice's, but
    // both his expenses came from her).
    expect(groceries?.contributors).toEqual(["Alice", "Bob"]);
  });

  it("only the requested year's figures show up", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Rent" }).returning();
      await db.insert(categoryEntries).values([
        { categoryId: cat.id, year: 2025, month: 12, amountPence: 100000 },
        { categoryId: cat.id, year: 2026, month: 1, amountPence: 110000 },
      ]);
      await linkCategoryToHousehold(cat.id, true, []);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    expect((await getHouseholdGrid(2025))[0].yearBudgetedPence).toBe(100000);
    expect((await getHouseholdGrid(2026))[0].yearBudgetedPence).toBe(110000);
  });

  it("an expense logged AFTER the category is already shared shows up as spent - the actual bug (logExpense never set sharedToHousehold, only the one-time backfill at the moment of sharing ever did)", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      await linkCategoryToHousehold(cat.id, true, []); // nothing to backfill - shared with no history yet
      await reconcileHouseholdDataForUser(alice.id);
      await logExpense({ categoryId: cat.id, amountPence: 4500, entryDate: "2026-09-10" });
      await reconcileHouseholdDataForUser(alice.id); // same reconcile app/grid/actions.ts now runs after logExpense
    })();
    const grid = await getHouseholdGrid(2026);
    expect(grid.find((r) => r.categoryName === "Groceries")?.months[9].spentPence).toBe(4500);
  });
});

describe("getHouseholdIncomeGrid", () => {
  it("sums a shared income source per month for the requested year", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [source] = await db.insert(incomeSources).values({ name: "Salary" }).returning();
      await db.insert(incomeEntries).values([
        { incomeSourceId: source.id, year: 2026, month: 8, amountPence: 250000 },
        { incomeSourceId: source.id, year: 2026, month: 9, amountPence: 250000 },
      ]);
      await shareIncomeSource(source.id, true);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    const grid = await getHouseholdIncomeGrid(2026);
    expect(grid).toEqual([
      { sourceName: "Salary", months: expect.objectContaining({ 8: 250000, 9: 250000, 1: 0 }), yearTotalPence: 500000, contributors: ["Test User"] },
    ]);
  });

  it("contributors dedupe by name across different income sources merged under the same name", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    const bob = await seedSignedInUser("bob-sub", "bob@example.com");
    await getSystemConn().db.update(users).set({ name: "Alice" }).where(eq(users.id, alice.id));
    await getSystemConn().db.update(users).set({ name: "Bob" }).where(eq(users.id, bob.id));

    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [source] = await db.insert(incomeSources).values({ name: "Salary" }).returning();
      await db.insert(incomeEntries).values({ incomeSourceId: source.id, year: 2026, month: 8, amountPence: 100000 });
      await shareIncomeSource(source.id, true);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    await asSignedInUser("bob-sub", "bob@example.com", async () => {
      const [source] = await db.insert(incomeSources).values({ name: "Salary" }).returning();
      await db.insert(incomeEntries).values({ incomeSourceId: source.id, year: 2026, month: 8, amountPence: 90000 });
      await shareIncomeSource(source.id, true);
      await reconcileHouseholdDataForUser(bob.id);
    })();

    const grid = await getHouseholdIncomeGrid(2026);
    expect(grid.find((r) => r.sourceName === "Salary")?.contributors).toEqual(["Alice", "Bob"]);
  });
});

describe("getHouseholdYears", () => {
  it("always includes the current year even with nothing shared", async () => {
    const years = await getHouseholdYears();
    expect(years).toContain(new Date().getFullYear());
  });

  it("includes every year that has shared data", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Rent" }).returning();
      await db.insert(categoryEntries).values({ categoryId: cat.id, year: 2019, month: 1, amountPence: 90000 });
      await linkCategoryToHousehold(cat.id, true, []);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    expect(await getHouseholdYears()).toContain(2019);
  });
});

describe("getHouseholdCellDetail", () => {
  it("attributes a cell's combined figure back to each contributing person", async () => {
    await setHouseholdEnabled(true);
    const alice = await seedSignedInUser("alice-sub", "alice@example.com");
    const bob = await seedSignedInUser("bob-sub", "bob@example.com");

    await asSignedInUser("alice-sub", "alice@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      await db.insert(categoryEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 30000 });
      const [e] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 12000, entryDate: "2026-09-05" }).returning();
      await linkCategoryToHousehold(cat.id, true, [e.id]);
      await reconcileHouseholdDataForUser(alice.id);
    })();
    await asSignedInUser("bob-sub", "bob@example.com", async () => {
      const [cat] = await db.insert(categories).values({ name: "Groceries" }).returning();
      const [e] = await db.insert(expenseEntries).values({ categoryId: cat.id, year: 2026, month: 9, amountPence: 8000, entryDate: "2026-09-10" }).returning();
      await setExpenseHouseholdShare(e.id, true);
      await reconcileHouseholdDataForUser(bob.id);
    })();

    const detail = await getHouseholdCellDetail("Groceries", 2026, 9);
    expect(detail.budgeted).toEqual([{ sourceUserId: alice.id, sourceUserName: "Test User", amountPence: 30000 }]);
    expect(detail.spent.map((s) => s.amountPence).sort((a, b) => a - b)).toEqual([8000, 12000]);
    expect(new Set(detail.spent.map((s) => s.sourceUserId))).toEqual(new Set([alice.id, bob.id]));
  });
});
