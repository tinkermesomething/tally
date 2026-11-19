import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories, debtLedgerEntries, expenseEntries, savingsEntries } from "@/lib/db/schema";
import { addCategory, logExpense, pencilInExpense, splitExpenseEntry } from "@/lib/db/queries";
import { addPerson } from "@/lib/db/debt";
import { addBucket } from "@/lib/db/savings";
import { setExpenseHouseholdShare } from "@/lib/db/household-tags";

const YEAR = 2026;

beforeEach(() => resetDb());

async function cat(name: string) {
  return addCategory({ name, parentId: null, groupName: null, isAnnual: false, annualMonth: null });
}

describe("splitExpenseEntry", () => {
  it("replaces one entry with several across categories, preserving date and summing to the original", async () => {
    const pets = await cat("Pets");
    const household = await cat("Household");
    const original = await logExpense({ categoryId: pets.id, amountPence: 5000, entryDate: `${YEAR}-10-05`, note: "Amazon order" });

    const created = await splitExpenseEntry(original.id, [
      { categoryId: pets.id, amountPence: 2000, note: "Cat food" },
      { categoryId: household.id, amountPence: 3000, note: "Cleaning supplies" },
    ]);

    expect(created).toHaveLength(2);
    expect(created.map((c) => c.amountPence).sort()).toEqual([2000, 3000]);
    expect(created.every((c) => c.entryDate === `${YEAR}-10-05`)).toBe(true);
    expect(await db.select().from(expenseEntries).where(eq(expenseEntries.id, original.id))).toHaveLength(0);
  });

  it("refuses when the parts don't add up to the original amount", async () => {
    const cat1 = await cat("Pets");
    const original = await logExpense({ categoryId: cat1.id, amountPence: 5000, entryDate: `${YEAR}-10-05` });
    await expect(
      splitExpenseEntry(original.id, [
        { categoryId: cat1.id, amountPence: 2000 },
        { categoryId: cat1.id, amountPence: 2000 },
      ])
    ).rejects.toThrow("add up");
  });

  it("refuses fewer than 2 parts", async () => {
    const cat1 = await cat("Pets");
    const original = await logExpense({ categoryId: cat1.id, amountPence: 5000, entryDate: `${YEAR}-10-05` });
    await expect(splitExpenseEntry(original.id, [{ categoryId: cat1.id, amountPence: 5000 }])).rejects.toThrow("at least 2");
  });

  it("refuses to split a pencilled-in (provisional) entry", async () => {
    const cat1 = await cat("Pets");
    const cat2 = await cat("Household");
    const original = await pencilInExpense({ categoryId: cat1.id, amountPence: 5000, entryDate: `${YEAR}-10-05` });
    await expect(
      splitExpenseEntry(original.id, [
        { categoryId: cat1.id, amountPence: 2000 },
        { categoryId: cat2.id, amountPence: 3000 },
      ])
    ).rejects.toThrow("pencilled-in");
  });

  it("refuses a debt-tagged entry without acknowledgeTagLoss, and drops the tag's ledger row once acknowledged", async () => {
    const cat1 = await cat("Pets");
    const cat2 = await cat("Household");
    const bob = await addPerson("Bob");
    const original = await logExpense({ categoryId: cat1.id, amountPence: 5000, entryDate: `${YEAR}-10-05`, debtPersonId: bob.id });
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(1);

    const parts = [{ categoryId: cat1.id, amountPence: 2000 }, { categoryId: cat2.id, amountPence: 3000 }];
    await expect(splitExpenseEntry(original.id, parts)).rejects.toThrow("tagged");

    await splitExpenseEntry(original.id, parts, true);
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(0);
  });

  it("refuses a savings-tagged entry without acknowledgeTagLoss, and drops the deposit once acknowledged", async () => {
    const cat1 = await cat("Pets");
    const cat2 = await cat("Household");
    const bucket = await addBucket({ name: "Holiday" });
    const original = await logExpense({ categoryId: cat1.id, amountPence: 5000, entryDate: `${YEAR}-10-05`, bucketId: bucket.id });
    expect(await db.select().from(savingsEntries)).toHaveLength(1);

    const parts = [{ categoryId: cat1.id, amountPence: 2000 }, { categoryId: cat2.id, amountPence: 3000 }];
    await expect(splitExpenseEntry(original.id, parts)).rejects.toThrow("tagged");

    await splitExpenseEntry(original.id, parts, true);
    expect(await db.select().from(savingsEntries)).toHaveLength(0);
  });

  it("refuses a household-shared entry without acknowledgeTagLoss", async () => {
    const cat1 = await cat("Pets");
    const cat2 = await cat("Household");
    const original = await logExpense({ categoryId: cat1.id, amountPence: 5000, entryDate: `${YEAR}-10-05` });
    await setExpenseHouseholdShare(original.id, true);

    const parts = [{ categoryId: cat1.id, amountPence: 2000 }, { categoryId: cat2.id, amountPence: 3000 }];
    await expect(splitExpenseEntry(original.id, parts)).rejects.toThrow("tagged");
    await splitExpenseEntry(original.id, parts, true);
  });

  it("carries the new category's own linked debt/savings tag onto its piece, same as logging fresh", async () => {
    const bob = await addPerson("Bob");
    const linked = await cat("Repay Bob");
    await db.update(categories).set({ linkedDebtPersonId: bob.id }).where(eq(categories.id, linked.id));
    const plain = await cat("Misc");
    const original = await logExpense({ categoryId: plain.id, amountPence: 5000, entryDate: `${YEAR}-10-05` });

    await splitExpenseEntry(original.id, [
      { categoryId: linked.id, amountPence: 2000 },
      { categoryId: plain.id, amountPence: 3000 },
    ]);

    const ledger = await db.select().from(debtLedgerEntries);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ personId: bob.id, amountPence: 2000 });
  });
});
