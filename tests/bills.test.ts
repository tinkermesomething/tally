import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { bankAccounts, categories, categoryEntries, importedTransactions } from "@/lib/db/schema";
import { logExpense, pencilInExpense, confirmPencilledExpense, discardPencilledExpense, updateCategoryDueDay } from "@/lib/db/queries";
import {
  addBill,
  archiveBill,
  getArchivedBills,
  getBills,
  getUpcomingBills,
  markBillPaid,
  unarchiveBill,
  updateBill,
} from "@/lib/db/bills";

beforeEach(() => resetDb());
const cat = async (name = "Subscriptions") => (await db.insert(categories).values({ name }).returning())[0].id;

/** A real importedTransactions row - confirmPencilledExpense's second
 * argument is a genuine FK (foreign_keys = ON), not a free-form number. */
async function stubImportedTransaction() {
  const [account] = await db
    .insert(bankAccounts)
    .values({ provider: "gocardless", institutionId: "i", requisitionId: "r", externalAccountId: "e", displayName: "Test account", consentExpiresAt: new Date(Date.now() + 9e9) })
    .returning();
  const [imp] = await db
    .insert(importedTransactions)
    .values({ bankAccountId: account.id, importedId: "stub", amountPence: -999, bookingDate: "2026-01-05", payeeRaw: "NETFLIX" })
    .returning();
  return imp.id;
}

describe("bills", () => {
  it("rejects a bad amount, an unrecognized cadence, and a missing custom interval", async () => {
    await expect(addBill({ name: "Netflix", amountPence: 0, cadence: "monthly", nextDueDate: "2026-01-01" })).rejects.toThrow(/greater than zero/);
    // @ts-expect-error - deliberately invalid at the type level too
    await expect(addBill({ name: "Netflix", amountPence: 999, cadence: "fortnightly", nextDueDate: "2026-01-01" })).rejects.toThrow(/Unrecognized cadence/);
    await expect(addBill({ name: "Netflix", amountPence: 999, cadence: "custom_days", nextDueDate: "2026-01-01" })).rejects.toThrow(/how many days/);
  });

  it("rejects a category that doesn't exist", async () => {
    await expect(addBill({ name: "Rent", amountPence: 1000_00, cadence: "monthly", nextDueDate: "2026-01-01", categoryId: 999 })).rejects.toThrow("no longer exists");
  });

  it("getBills reports days until due, sorted soonest first", async () => {
    await addBill({ name: "Yearly insurance", amountPence: 5000, cadence: "yearly", nextDueDate: "2026-06-01" });
    await addBill({ name: "Netflix", amountPence: 999, cadence: "monthly", nextDueDate: "2026-01-05" });
    const bills = await getBills("2026-01-01");
    expect(bills.map((b) => b.name)).toEqual(["Netflix", "Yearly insurance"]);
    expect(bills[0].daysUntilDue).toBe(4);
  });

  it("a real bill further out than the lookahead window still shows - lookaheadDays only scopes due-day-derived bills", async () => {
    await addBill({ name: "Yearly insurance", amountPence: 5000, cadence: "yearly", nextDueDate: "2026-06-01" });
    const bills = await getBills("2026-01-01", 14); // 151 days out, way past a 2-week window
    expect(bills.map((b) => b.name)).toEqual(["Yearly insurance"]);
  });

  it("getUpcomingBills filters by the threshold, including overdue (negative days)", async () => {
    await addBill({ name: "Overdue", amountPence: 100, cadence: "weekly", nextDueDate: "2025-12-20" });
    await addBill({ name: "Soon", amountPence: 100, cadence: "weekly", nextDueDate: "2026-01-05" });
    await addBill({ name: "Later", amountPence: 100, cadence: "weekly", nextDueDate: "2026-06-01" });
    const upcoming = await getUpcomingBills(14, "2026-01-01");
    expect(upcoming.map((b) => b.name)).toEqual(["Overdue", "Soon"]);
  });

  it("markBillPaid advances exactly one cadence from the current due date", async () => {
    const bill = await addBill({ name: "Netflix", amountPence: 999, cadence: "monthly", nextDueDate: "2026-01-05" });
    await markBillPaid(bill.id);
    const [updated] = await getBills("2026-01-01");
    expect(updated.nextDueDate).toBe("2026-02-05");
  });

  it("updateBill replaces the fields and re-validates a new category", async () => {
    const categoryId = await cat();
    const bill = await addBill({ name: "Netflix", amountPence: 999, cadence: "monthly", nextDueDate: "2026-01-05" });
    await updateBill(bill.id, { name: "Netflix Premium", amountPence: 1299, cadence: "monthly", nextDueDate: "2026-01-10", categoryId });
    const [updated] = await getBills("2026-01-01");
    expect(updated).toMatchObject({ name: "Netflix Premium", amountPence: 1299, nextDueDate: "2026-01-10", categoryName: "Subscriptions" });
  });

  it("archive/unarchive", async () => {
    const bill = await addBill({ name: "Netflix", amountPence: 999, cadence: "monthly", nextDueDate: "2026-01-05" });
    await archiveBill(bill.id);
    expect(await getBills()).toHaveLength(0);
    expect(await getArchivedBills()).toHaveLength(1);
    await unarchiveBill(bill.id);
    expect(await getBills()).toHaveLength(1);
  });

  describe("auto-advance from a real expense (lib/db/queries.ts logExpense)", () => {
    it("a confirmed expense on/after the due date in the linked category advances it", async () => {
      const categoryId = await cat();
      await addBill({ name: "Netflix", amountPence: 999, cadence: "monthly", nextDueDate: "2026-01-05", categoryId });
      await logExpense({ categoryId, amountPence: 999, entryDate: "2026-01-05" });
      const [updated] = await getBills("2026-01-01");
      expect(updated.nextDueDate).toBe("2026-02-05");
    });

    it("an expense BEFORE the due date does not count as paying this cycle", async () => {
      const categoryId = await cat();
      await addBill({ name: "Netflix", amountPence: 999, cadence: "monthly", nextDueDate: "2026-01-05", categoryId });
      await logExpense({ categoryId, amountPence: 999, entryDate: "2026-01-01" });
      const [bill] = await getBills("2026-01-01");
      expect(bill.nextDueDate).toBe("2026-01-05");
    });

    it("a PENCILLED-IN expense does not advance it yet - only confirming does", async () => {
      const categoryId = await cat();
      await addBill({ name: "Netflix", amountPence: 999, cadence: "monthly", nextDueDate: "2026-01-05", categoryId });
      const pencilled = await pencilInExpense({ categoryId, amountPence: 999, entryDate: "2026-01-05" });

      let [current] = await getBills("2026-01-01");
      expect(current.nextDueDate).toBe("2026-01-05");

      await confirmPencilledExpense(pencilled.id, await stubImportedTransaction());
      [current] = await getBills("2026-01-01");
      expect(current.nextDueDate).toBe("2026-02-05");
    });

    it("discarding a pencilled-in expense leaves the due date untouched", async () => {
      const categoryId = await cat();
      await addBill({ name: "Netflix", amountPence: 999, cadence: "monthly", nextDueDate: "2026-01-05", categoryId });
      const pencilled = await pencilInExpense({ categoryId, amountPence: 999, entryDate: "2026-01-05" });
      await discardPencilledExpense(pencilled.id);
      const [bill] = await getBills("2026-01-01");
      expect(bill.nextDueDate).toBe("2026-01-05");
    });

    it("an expense in an unrelated category never touches the bill", async () => {
      const categoryId = await cat("Subscriptions");
      const otherCategoryId = await cat("Groceries");
      await addBill({ name: "Netflix", amountPence: 999, cadence: "monthly", nextDueDate: "2026-01-05", categoryId });
      await logExpense({ categoryId: otherCategoryId, amountPence: 999, entryDate: "2026-01-05" });
      const [bill] = await getBills("2026-01-01");
      expect(bill.nextDueDate).toBe("2026-01-05");
    });
  });
});

describe("bills auto-populated from a category's own due day (getBills merge)", () => {
  it("a category with a due day and a budgeted, unpaid month shows up as a bill", async () => {
    const categoryId = await cat("Rent");
    await updateCategoryDueDay(categoryId, 5);
    await db.insert(categoryEntries).values({ categoryId, year: 2026, month: 1, amountPence: 120000 });
    const bills = await getBills("2026-01-10");
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ name: "Rent", amountPence: 120000, nextDueDate: "2026-01-05", categoryId, synthetic: true, daysUntilDue: -5 });
  });

  it("no category_entries row this month - same as the Grid's own rule, nothing planned means not a bill", async () => {
    const categoryId = await cat("Rent");
    await updateCategoryDueDay(categoryId, 5);
    expect(await getBills("2026-01-10")).toHaveLength(0);
  });

  it("already paid this month - excluded, nothing to remind about", async () => {
    const categoryId = await cat("Rent");
    await updateCategoryDueDay(categoryId, 5);
    await db.insert(categoryEntries).values({ categoryId, year: 2026, month: 1, amountPence: 120000, paid: true });
    expect(await getBills("2026-01-10")).toHaveLength(0);
  });

  it("no due day set - never a bill", async () => {
    const categoryId = await cat("Rent");
    await db.insert(categoryEntries).values({ categoryId, year: 2026, month: 1, amountPence: 120000 });
    expect(await getBills("2026-01-10")).toHaveLength(0);
  });

  it("a due day past the real length of the month clamps, same as applyOverdueFlags", async () => {
    const categoryId = await cat("Rent");
    await updateCategoryDueDay(categoryId, 31);
    await db.insert(categoryEntries).values({ categoryId, year: 2026, month: 2, amountPence: 50000 }); // Feb 2026 has 28 days
    const [bill] = await getBills("2026-02-01");
    expect(bill.nextDueDate).toBe("2026-02-28");
  });

  it("a category already linked to a real bill is shown once, as the real bill, not twice", async () => {
    const categoryId = await cat("Rent");
    await updateCategoryDueDay(categoryId, 5);
    await db.insert(categoryEntries).values({ categoryId, year: 2026, month: 1, amountPence: 120000 });
    await addBill({ name: "Rent (tracked manually)", amountPence: 125000, cadence: "monthly", nextDueDate: "2026-01-05", categoryId });
    const bills = await getBills("2026-01-10");
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ name: "Rent (tracked manually)", synthetic: false });
  });

  it("an archived category never shows up, even with a due day and a budgeted month", async () => {
    const categoryId = await cat("Rent");
    await updateCategoryDueDay(categoryId, 5);
    await db.insert(categoryEntries).values({ categoryId, year: 2026, month: 1, amountPence: 120000 });
    const { archiveCategory } = await import("@/lib/db/queries");
    await archiveCategory(categoryId);
    expect(await getBills("2026-01-10")).toHaveLength(0);
  });

  it("real bills and category-derived bills are merged and sorted together by due date", async () => {
    const categoryId = await cat("Rent");
    await updateCategoryDueDay(categoryId, 20);
    await db.insert(categoryEntries).values({ categoryId, year: 2026, month: 1, amountPence: 120000 });
    await addBill({ name: "Netflix", amountPence: 999, cadence: "monthly", nextDueDate: "2026-01-05" });
    const bills = await getBills("2026-01-01");
    expect(bills.map((b) => b.name)).toEqual(["Netflix", "Rent"]);
  });

  describe("6-week lookahead (BILLS_LOOKAHEAD_DAYS)", () => {
    it("this month's due day already paid, next month's budgeted and unpaid - shows the NEXT month's one", async () => {
      const categoryId = await cat("Rent");
      await updateCategoryDueDay(categoryId, 5);
      await db.insert(categoryEntries).values([
        { categoryId, year: 2026, month: 1, amountPence: 120000, paid: true },
        { categoryId, year: 2026, month: 2, amountPence: 120000 },
      ]);
      const bills = await getBills("2026-01-10");
      expect(bills).toHaveLength(1);
      expect(bills[0]).toMatchObject({ nextDueDate: "2026-02-05", daysUntilDue: 26 });
    });

    it("next month's due day isn't budgeted yet - nothing to show once this month's is paid", async () => {
      const categoryId = await cat("Rent");
      await updateCategoryDueDay(categoryId, 5);
      await db.insert(categoryEntries).values({ categoryId, year: 2026, month: 1, amountPence: 120000, paid: true });
      expect(await getBills("2026-01-10")).toHaveLength(0);
    });

    it("a due day more than 6 weeks out is not shown even if budgeted and unpaid", async () => {
      const categoryId = await cat("Rent");
      await updateCategoryDueDay(categoryId, 5);
      // 2026-01-10 + 42 days = 2026-02-21 - March 5th is well past that.
      await db.insert(categoryEntries).values([
        { categoryId, year: 2026, month: 1, amountPence: 120000, paid: true },
        { categoryId, year: 2026, month: 2, amountPence: 120000, paid: true },
        { categoryId, year: 2026, month: 3, amountPence: 120000 },
      ]);
      expect(await getBills("2026-01-10")).toHaveLength(0);
    });

    it("unpaid in both this month and next - shows only the sooner one, not both", async () => {
      const categoryId = await cat("Rent");
      await updateCategoryDueDay(categoryId, 5);
      await db.insert(categoryEntries).values([
        { categoryId, year: 2026, month: 1, amountPence: 120000 },
        { categoryId, year: 2026, month: 2, amountPence: 120000 },
      ]);
      const bills = await getBills("2026-01-01");
      expect(bills).toHaveLength(1);
      expect(bills[0].nextDueDate).toBe("2026-01-05");
    });

    it("a lookahead window spanning three calendar months still finds a late match", async () => {
      // 2026-01-20 + 42 days = 2026-03-03, so January, February AND March
      // all fall inside the window - this due day is budgeted and unpaid
      // only in March.
      const categoryId = await cat("Rent");
      await updateCategoryDueDay(categoryId, 1);
      await db.insert(categoryEntries).values({ categoryId, year: 2026, month: 3, amountPence: 120000 });
      const bills = await getBills("2026-01-20");
      expect(bills).toHaveLength(1);
      expect(bills[0].nextDueDate).toBe("2026-03-01");
    });
  });
});
