import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { bankAccounts, categories, importedTransactions } from "@/lib/db/schema";
import { logExpense, pencilInExpense, confirmPencilledExpense, discardPencilledExpense } from "@/lib/db/queries";
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
