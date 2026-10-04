import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { bankAccounts, categories, expenseEntries, importedTransactions } from "@/lib/db/schema";
import { pencilInExpense, logExpense } from "@/lib/db/queries";
import { stageImportedTransactions, confirmPencilledMatch } from "@/lib/db/bank-sync";

let acctId: number;
let catId: number;

beforeEach(async () => {
  resetDb();
  const [a] = await db
    .insert(bankAccounts)
    .values({ provider: "g", institutionId: "i", requisitionId: "r", externalAccountId: "e", displayName: "T", consentExpiresAt: new Date(Date.now() + 1e9) })
    .returning();
  acctId = a.id;
  catId = (await db.insert(categories).values({ name: "Food" }).returning())[0].id;
});

const stage = async (importedId: string, amountPence: number, bookingDate: string, payeeRaw = "TESCO") => {
  await stageImportedTransactions(acctId, [{ importedId, amountPence, bookingDate, payeeRaw }]);
  return (await db.select().from(importedTransactions).where(eq(importedTransactions.importedId, importedId)))[0];
};

describe("pencilled-in expense -> settled bank row", () => {
  it("links a booking that settles days after the pending date (weekend gap)", async () => {
    // Pending showed Fri 9 Oct; the bank booked it Mon 12 Oct.
    const pencil = await pencilInExpense({ categoryId: catId, amountPence: 1234, entryDate: "2026-10-09", note: "weekly shop" });
    const row = await stage("t1", -1234, "2026-10-12");
    expect(row.possibleDuplicateExpenseEntryId).toBe(pencil.id);
    expect(row.status).toBe("pending_review"); // payee differs: surfaced for Confirm, never auto-categorized into a 2nd expense
  });

  it("confirming then leaves exactly ONE expense", async () => {
    const pencil = await pencilInExpense({ categoryId: catId, amountPence: 1234, entryDate: "2026-10-09", note: "weekly shop" });
    const row = await stage("t1", -1234, "2026-10-12");
    await confirmPencilledMatch(row.id, row.possibleDuplicateExpenseEntryId!);
    const all = await db.select().from(expenseEntries);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(pencil.id);
    expect(all[0].provisional).toBe(false);
  });

  it("two identical pencilled purchases pair one-to-one with two bookings", async () => {
    const p1 = await pencilInExpense({ categoryId: catId, amountPence: 350, entryDate: "2026-10-09", note: "coffee" });
    const p2 = await pencilInExpense({ categoryId: catId, amountPence: 350, entryDate: "2026-10-10", note: "coffee" });
    const r1 = await stage("a", -350, "2026-10-12", "COSTA");
    const r2 = await stage("b", -350, "2026-10-12", "COSTA");
    expect([r1.possibleDuplicateExpenseEntryId, r2.possibleDuplicateExpenseEntryId].sort()).toEqual([p1.id, p2.id].sort());
  });

  it("prefers the pencilled draft over an unrelated manual entry of the same amount", async () => {
    await logExpense({ categoryId: catId, amountPence: 1234, entryDate: "2026-10-12" });
    const pencil = await pencilInExpense({ categoryId: catId, amountPence: 1234, entryDate: "2026-10-09", note: "weekly shop" });
    const row = await stage("t1", -1234, "2026-10-12");
    expect(row.possibleDuplicateExpenseEntryId).toBe(pencil.id);
  });

  it("does not link a manual entry far outside the +/-1 day window", async () => {
    await logExpense({ categoryId: catId, amountPence: 1234, entryDate: "2026-10-05" });
    const row = await stage("t1", -1234, "2026-10-12");
    expect(row.possibleDuplicateExpenseEntryId).toBeNull();
  });

  it("still links a manual entry within +/-1 day", async () => {
    const m = await logExpense({ categoryId: catId, amountPence: 1234, entryDate: "2026-10-11" });
    const row = await stage("t1", -1234, "2026-10-12");
    expect(row.possibleDuplicateExpenseEntryId).toBe(m.id);
  });
});

// The real October 2026 case: pencilled Oct 2 with the bank's (future) pending
// date Oct 6, truncated payee text; the booking then arrived dated Oct 2.
describe("auto-replace: a booked row replaces its matching pencilled draft", () => {
  it("replaces the draft instead of creating a second expense", async () => {
    const pencil = await pencilInExpense({ categoryId: catId, amountPence: 1349, entryDate: "2026-10-06", note: "TESCO STORES 5439" });
    const row = await stage("t1", -1349, "2026-10-02", "TESCO STORES 5439 BRANCH GB");
    const all = await db.select().from(expenseEntries);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(pencil.id);
    expect(all[0].provisional).toBe(false);
    expect(all[0].importedTransactionId).toBe(row.id);
    expect(row.status).toBe("ignored"); // "already logged", same as a manual confirm
  });

  it("pairs two identical purchases one-to-one", async () => {
    await pencilInExpense({ categoryId: catId, amountPence: 1000, entryDate: "2026-10-06", note: "GoHenry Junior ISA" });
    await pencilInExpense({ categoryId: catId, amountPence: 1000, entryDate: "2026-10-06", note: "GoHenry Junior ISA" });
    await stage("a", -1000, "2026-10-02", "GOHENRY JUNIOR ISALYMINGTON GB");
    await stage("b", -1000, "2026-10-02", "GOHENRY JUNIOR ISALYMINGTON GB");
    const all = await db.select().from(expenseEntries);
    expect(all).toHaveLength(2);
    expect(all.every((e) => !e.provisional && e.importedTransactionId !== null)).toBe(true);
    expect(new Set(all.map((e) => e.importedTransactionId)).size).toBe(2);
  });

  it("a third identical booking (no draft left) is not swallowed", async () => {
    await pencilInExpense({ categoryId: catId, amountPence: 1000, entryDate: "2026-10-06", note: "GoHenry Junior ISA" });
    await stage("a", -1000, "2026-10-02", "GOHENRY JUNIOR ISALYMINGTON GB");
    const third = await stage("c", -1000, "2026-10-02", "GOHENRY JUNIOR ISALYMINGTON GB");
    expect(third.status).toBe("pending_review");
  });

  it("different merchant, same amount: does NOT auto-replace", async () => {
    await pencilInExpense({ categoryId: catId, amountPence: 1349, entryDate: "2026-10-06", note: "TESCO STORES 5439" });
    const row = await stage("t1", -1349, "2026-10-02", "SAINSBURYS LONDON GB");
    expect(row.status).toBe("pending_review");
    expect((await db.select().from(expenseEntries))[0].provisional).toBe(true);
  });

  it("never auto-replaces a manual (non-pencilled) entry", async () => {
    await logExpense({ categoryId: catId, amountPence: 1349, entryDate: "2026-10-02", note: "TESCO STORES 5439" });
    const row = await stage("t1", -1349, "2026-10-02", "TESCO STORES 5439 BRANCH GB");
    expect(row.status).toBe("pending_review");
  });
});
