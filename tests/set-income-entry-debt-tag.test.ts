import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { debtLedgerEntries, incomeSources, incomeTransactions } from "@/lib/db/schema";
import { addIncomeSource, logIncomeTransaction } from "@/lib/db/queries";
import { addPerson } from "@/lib/db/debt";
import { setIncomeEntryDebtTag } from "@/lib/db/retro-tags";

const YEAR = 2026;

beforeEach(() => resetDb());

async function logEntry(sourceId: number) {
  return logIncomeTransaction({ incomeSourceId: sourceId, amountPence: 2000, entryDate: `${YEAR}-10-05`, year: YEAR, month: 10 });
}

describe("setIncomeEntryDebtTag", () => {
  it("sets a person on an untagged entry, creating the ledger row", async () => {
    const source = await addIncomeSource("Gifts");
    const entry = await logEntry(source.id);
    const bob = await addPerson("Bob");

    await setIncomeEntryDebtTag(entry.id, bob.id);

    const [updated] = await db.select().from(incomeTransactions).where(eq(incomeTransactions.id, entry.id));
    expect(updated.debtPersonId).toBe(bob.id);
    const ledger = await db.select().from(debtLedgerEntries).where(eq(debtLedgerEntries.incomeTransactionId, entry.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ personId: bob.id, direction: "loan", amountPence: 2000 });
  });

  it("moves the tag to a different person - exactly one ledger row survives", async () => {
    const source = await addIncomeSource("Gifts");
    const entry = await logEntry(source.id);
    const bob = await addPerson("Bob");
    const alice = await addPerson("Alice");
    await setIncomeEntryDebtTag(entry.id, bob.id);
    const [firstLedgerRow] = await db.select().from(debtLedgerEntries).where(eq(debtLedgerEntries.incomeTransactionId, entry.id));

    await setIncomeEntryDebtTag(entry.id, alice.id);

    const ledger = await db.select().from(debtLedgerEntries).where(eq(debtLedgerEntries.incomeTransactionId, entry.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].personId).toBe(alice.id);
    expect(ledger[0].id).not.toBe(firstLedgerRow.id);
  });

  it("clears the tag on a non-required source - ledger row removed", async () => {
    const source = await addIncomeSource("Gifts");
    const entry = await logEntry(source.id);
    const bob = await addPerson("Bob");
    await setIncomeEntryDebtTag(entry.id, bob.id);

    await setIncomeEntryDebtTag(entry.id, null);

    const [updated] = await db.select().from(incomeTransactions).where(eq(incomeTransactions.id, entry.id));
    expect(updated.debtPersonId).toBeNull();
    expect(await db.select().from(debtLedgerEntries).where(eq(debtLedgerEntries.incomeTransactionId, entry.id))).toHaveLength(0);
  });

  it("refuses to clear the tag when the source requires one", async () => {
    const source = await addIncomeSource("Loans");
    await db.update(incomeSources).set({ requiresDebtPerson: true }).where(eq(incomeSources.id, source.id));
    const bob = await addPerson("Bob");
    const entry = await logIncomeTransaction({ incomeSourceId: source.id, amountPence: 2000, entryDate: `${YEAR}-10-05`, year: YEAR, month: 10, debtPersonId: bob.id });

    await expect(setIncomeEntryDebtTag(entry.id, null)).rejects.toThrow("requires tagging");

    const [updated] = await db.select().from(incomeTransactions).where(eq(incomeTransactions.id, entry.id));
    expect(updated.debtPersonId).toBe(bob.id);
  });

  it("setting the same person twice is a no-op - the ledger row's id is stable", async () => {
    const source = await addIncomeSource("Gifts");
    const entry = await logEntry(source.id);
    const bob = await addPerson("Bob");
    await setIncomeEntryDebtTag(entry.id, bob.id);
    const [before] = await db.select().from(debtLedgerEntries).where(eq(debtLedgerEntries.incomeTransactionId, entry.id));

    await setIncomeEntryDebtTag(entry.id, bob.id);

    const [after] = await db.select().from(debtLedgerEntries).where(eq(debtLedgerEntries.incomeTransactionId, entry.id));
    expect(after.id).toBe(before.id);
  });
});
