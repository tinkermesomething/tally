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
import { categories, expenseEntries, incomeEntries, incomeSources } from "@/lib/db/schema";
import { shareCategoryExpenses, shareIncomeSource, setExpenseHouseholdShare } from "@/lib/db/household-tags";
import {
  getHouseholdExpenses,
  getHouseholdIncome,
  isHouseholdEnabled,
  reconcileHouseholdDataForUser,
  removeHouseholdDataForUser,
  setHouseholdEnabled,
} from "@/lib/db/household";
import { deleteUser } from "@/lib/db/users";

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
