import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { bankAccounts, incomeSources, incomeTransactions, importedTransactions, debtLedgerEntries, people, payPeriodAnchors } from "@/lib/db/schema";
import {
  pencilInIncome,
  discardPencilledIncome,
  confirmPencilledIncome,
  logIncomeTransaction,
  getIncomeTransactionsForCell,
  updateIncomeTransaction,
} from "@/lib/db/queries";
import { stageImportedTransactions, confirmPencilledIncomeMatch, findPossibleManualIncomeDuplicate } from "@/lib/db/bank-sync";

let acctId: number;
let srcId: number;

beforeEach(async () => {
  resetDb();
  const [a] = await db
    .insert(bankAccounts)
    .values({ provider: "g", institutionId: "i", requisitionId: "r", externalAccountId: "e", displayName: "T", consentExpiresAt: new Date(Date.now() + 1e9) })
    .returning();
  acctId = a.id;
  srcId = (await db.insert(incomeSources).values({ name: "Gifts" }).returning())[0].id;
});

const stage = async (importedId: string, amountPence: number, bookingDate: string, payeeRaw = "GIFT") => {
  await stageImportedTransactions(acctId, [{ importedId, amountPence, bookingDate, payeeRaw }]);
  return (await db.select().from(importedTransactions).where(eq(importedTransactions.importedId, importedId)))[0];
};

describe("pencilInIncome / discardPencilledIncome / confirmPencilledIncome", () => {
  it("logs a real, immediately-counted provisional income transaction", async () => {
    const row = await pencilInIncome({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-13", year: 2026, month: 10 });
    expect(row.provisional).toBe(true);
    expect(row.amountPence).toBe(2000);
  });

  it("discard refuses a non-provisional (real) entry", async () => {
    const row = await logIncomeTransaction({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-13", year: 2026, month: 10 });
    await expect(discardPencilledIncome(row.id)).rejects.toThrow("Not a provisional entry");
  });

  it("discard removes a provisional entry and any loan it created", async () => {
    const [bob] = await db.insert(people).values({ name: "Bob" }).returning();
    const row = await pencilInIncome({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-13", year: 2026, month: 10, debtPersonId: bob.id });
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(1);
    await discardPencilledIncome(row.id);
    expect(await db.select().from(incomeTransactions)).toHaveLength(0);
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(0);
  });

  it("confirm refuses a non-provisional entry, flips the flag and links the real transaction otherwise", async () => {
    const importedRow = await stage("t1", 2000, "2026-10-13");
    const real = await logIncomeTransaction({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-13", year: 2026, month: 10 });
    await expect(confirmPencilledIncome(real.id, importedRow.id)).rejects.toThrow("Not a provisional entry");

    const pencil = await pencilInIncome({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-13", year: 2026, month: 10 });
    await confirmPencilledIncome(pencil.id, importedRow.id);
    const row = (await db.select().from(incomeTransactions).where(eq(incomeTransactions.id, pencil.id)))[0];
    expect(row.provisional).toBe(false);
    expect(row.importedTransactionId).toBe(importedRow.id);
  });
});

describe("findPossibleManualIncomeDuplicate", () => {
  it("ignores money-out (negative/zero) amounts entirely", async () => {
    expect(await findPossibleManualIncomeDuplicate(-2000, "2026-10-13")).toBeNull();
    expect(await findPossibleManualIncomeDuplicate(0, "2026-10-13")).toBeNull();
  });

  it("does not link a manual entry far outside the +/-1 day window", async () => {
    await logIncomeTransaction({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-05", year: 2026, month: 10 });
    expect(await findPossibleManualIncomeDuplicate(2000, "2026-10-13")).toBeNull();
  });

  it("still links a manual entry within +/-1 day", async () => {
    const m = await logIncomeTransaction({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-12", year: 2026, month: 10 });
    expect(await findPossibleManualIncomeDuplicate(2000, "2026-10-13")).toBe(m.id);
  });
});

describe("pencilled-in income -> settled bank row", () => {
  it("links a booking that settles days after the pending date", async () => {
    const pencil = await pencilInIncome({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-09", year: 2026, month: 10, note: "birthday" });
    const row = await stage("t1", 2000, "2026-10-12");
    expect(row.possibleDuplicateIncomeTransactionId).toBe(pencil.id);
    expect(row.status).toBe("pending_review"); // payee differs from the pencilled note - surfaced for Confirm, not auto-matched
  });

  it("confirming then leaves exactly ONE income transaction, no longer provisional", async () => {
    const pencil = await pencilInIncome({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-09", year: 2026, month: 10, note: "GIFT" });
    const row = await stage("t1", 2000, "2026-10-12", "GIFT");
    // Same payee as the pencilled note - auto-replaces instead of just suggesting.
    const all = await db.select().from(incomeTransactions);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(pencil.id);
    expect(all[0].provisional).toBe(false);
    const imported = (await db.select().from(importedTransactions).where(eq(importedTransactions.id, row.id)))[0];
    expect(imported.status).toBe("ignored"); // already logged via the pencil, not left pending
  });

  it("a real bank row that is NOT the pay anchor source never touches pay period anchors", async () => {
    const pencil = await pencilInIncome({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-09", year: 2026, month: 10 });
    const row = await stage("t1", 2000, "2026-10-12");
    await confirmPencilledIncomeMatch(row.id, pencil.id);
    const updated = (await db.select().from(incomeTransactions).where(eq(incomeTransactions.id, pencil.id)))[0];
    // Stayed on the plain calendar date it was pencilled against - never
    // moved to an anchor period (this source isn't the pay anchor).
    expect(updated.year).toBe(2026);
    expect(updated.month).toBe(10);
  });
});

describe("pencilling in the pay-anchor source never shifts the anchor - only confirming does", () => {
  it("a pencilled guess is filed by plain calendar date, no anchor row created", async () => {
    const [wages] = await db.insert(incomeSources).values({ name: "Wages", isPayAnchor: true }).returning();
    // Pencilled as if it were a plain September payment - no anchor logic
    // involved at all at this point (see pencilInPendingIncome's own
    // comment in app/review/actions.ts).
    const pencil = await pencilInIncome({ incomeSourceId: wages.id, amountPence: 300000, entryDate: "2026-09-30", year: 2026, month: 9 });
    expect(pencil.year).toBe(2026);
    expect(pencil.month).toBe(9); // still September - not the Oct anchor period
    expect(await db.select().from(payPeriodAnchors)).toHaveLength(0);
  });

  it("confirming it THEN resolves the real anchor period (30 Sep funds October) and records the anchor", async () => {
    const [wages] = await db.insert(incomeSources).values({ name: "Wages", isPayAnchor: true }).returning();
    const pencil = await pencilInIncome({ incomeSourceId: wages.id, amountPence: 300000, entryDate: "2026-09-30", year: 2026, month: 9 });
    const row = await stage("t1", 300000, "2026-09-30");
    await confirmPencilledIncomeMatch(row.id, pencil.id);

    const updated = (await db.select().from(incomeTransactions).where(eq(incomeTransactions.id, pencil.id)))[0];
    expect(updated.year).toBe(2026);
    expect(updated.month).toBe(10); // moved from September to the anchor period
    expect(updated.provisional).toBe(false);
    const anchors = await db.select().from(payPeriodAnchors);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ receivedDate: "2026-09-30", year: 2026, month: 10 });
  });
});

describe("getIncomeTransactionsForCell / updateIncomeTransaction - the Received £X breakdown popover", () => {
  it("lists every transaction for that source/month, oldest first, with the source name joined in", async () => {
    await logIncomeTransaction({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-13", year: 2026, month: 10, note: "second" });
    await logIncomeTransaction({ incomeSourceId: srcId, amountPence: 1500, entryDate: "2026-10-01", year: 2026, month: 10, note: "first" });
    // A different month must not leak in.
    await logIncomeTransaction({ incomeSourceId: srcId, amountPence: 999, entryDate: "2026-09-01", year: 2026, month: 9 });

    const rows = await getIncomeTransactionsForCell(srcId, 2026, 10);
    expect(rows.map((r) => r.note)).toEqual(["first", "second"]);
    expect(rows[0]).toMatchObject({ sourceName: "Gifts", amountPence: 1500 });
  });

  it("updateIncomeTransaction edits amount and/or note only - never the date", async () => {
    const row = await logIncomeTransaction({ incomeSourceId: srcId, amountPence: 2000, entryDate: "2026-10-13", year: 2026, month: 10 });
    await updateIncomeTransaction(row.id, { amountPence: 2500, note: "corrected" });
    const [updated] = await getIncomeTransactionsForCell(srcId, 2026, 10);
    expect(updated).toMatchObject({ amountPence: 2500, note: "corrected", entryDate: "2026-10-13" });
  });
});
