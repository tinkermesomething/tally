"use server";

import { assertPositivePence } from "@/lib/validate";
import { localIsoDate, parseIsoDate } from "@/lib/date";
import { requireSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import {
  categorizeTransaction,
  categorizeTransactionAsIncome,
  ignoreTransaction,
  restoreTransaction,
  bulkIgnoreTransactions,
  bulkCategorizeTransactionsAsExpense,
  bulkCategorizeTransactionsAsIncome,
  confirmPencilledMatch,
  confirmPencilledIncomeMatch,
  setTransactionNote,
} from "@/lib/db/bank-sync";
import { pencilInExpense, discardPencilledExpense, pencilInIncome, discardPencilledIncome } from "@/lib/db/queries";

export async function categorizeImportedTransaction(
  id: number,
  input: { categoryId: number; debtPersonId?: number }
) {
  return requireSession(async () => {
    await categorizeTransaction(id, { categoryId: input.categoryId, debtPersonId: input.debtPersonId });
    revalidatePath("/review");
    revalidatePath("/grid");
    revalidatePath("/entries");
  });
}

export async function categorizeImportedTransactionAsIncome(
  id: number,
  input: { incomeSourceId: number; debtPersonId?: number }
) {
  return requireSession(async () => {
    await categorizeTransactionAsIncome(id, input);
    revalidatePath("/review");
    revalidatePath("/grid");
    revalidatePath("/debt");
  });
}

/** Not revalidated: the row keeps its own copy, and redrawing the whole
 * list on every note would drop what you are doing. */
export async function saveImportedTransactionNote(id: number, note: string) {
  return requireSession(() => setTransactionNote(id, note));
}

export async function ignoreImportedTransaction(id: number) {
  return requireSession(async () => {
    await ignoreTransaction(id);
    revalidatePath("/review");
  });
}

export async function restoreImportedTransaction(id: number) {
  return requireSession(async () => {
    await restoreTransaction(id);
    revalidatePath("/review");
  });
}

export async function bulkIgnoreImportedTransactions(ids: number[]) {
  return requireSession(async () => {
    await bulkIgnoreTransactions(ids);
    revalidatePath("/review");
  });
}

export async function bulkCategorizeImportedTransactionsAsExpense(
  ids: number[],
  input: { categoryId: number; debtPersonId?: number }
) {
  return requireSession(async () => {
    await bulkCategorizeTransactionsAsExpense(ids, input);
    revalidatePath("/review");
    revalidatePath("/grid");
    revalidatePath("/entries");
    revalidatePath("/debt");
  });
}

export async function bulkCategorizeImportedTransactionsAsIncome(
  ids: number[],
  input: { incomeSourceId: number; debtPersonId?: number }
) {
  return requireSession(async () => {
    await bulkCategorizeTransactionsAsIncome(ids, input);
    revalidatePath("/review");
    revalidatePath("/grid");
    revalidatePath("/debt");
  });
}

export async function pencilInPendingExpense(input: {
  categoryId: number;
  amountPence: number;
  // The pending preview's own date, when GoCardless has one yet - null
  // falls back to today server-side (this is a same-day guess either way).
  entryDate: string | null;
  note?: string;
  /** From the preview's rule-match suggestion (see getPendingPreview). */
  debtPersonId?: number;
  bucketId?: number;
}) {
  return requireSession(async () => {
    assertPositivePence(input.amountPence);
    await pencilInExpense({ ...input, entryDate: input.entryDate ?? localIsoDate() });
    revalidatePath("/review");
    revalidatePath("/grid");
    revalidatePath("/entries");
    revalidatePath("/debt");
  });
}

/** The booked transaction that just synced in matches a pencilled-in guess
 * - make the draft permanent and mark this bank row already-logged. */
export async function confirmImportedTransactionMatch(importedTransactionId: number, expenseEntryId: number) {
  return requireSession(async () => {
    await confirmPencilledMatch(importedTransactionId, expenseEntryId);
    revalidatePath("/review");
    revalidatePath("/grid");
    revalidatePath("/entries");
  });
}

/** The pencilled-in guess was wrong - discard it, let the real bank
 * transaction go through normal categorizing. */
export async function discardImportedTransactionMatch(expenseEntryId: number) {
  return requireSession(async () => {
    await discardPencilledExpense(expenseEntryId);
    revalidatePath("/review");
    revalidatePath("/grid");
    revalidatePath("/entries");
    revalidatePath("/debt");
  });
}

/** Money-in's mirror of pencilInPendingExpense. Always files by the
 * pending preview's own plain calendar date, even for the pay-anchor
 * source - a guess shouldn't move the anchor boundary or re-file
 * expenses; only confirmImportedTransactionIncomeMatch does that, once
 * it's real (see confirmPencilledIncomeMatch in lib/db/bank-sync.ts). */
export async function pencilInPendingIncome(input: {
  incomeSourceId: number;
  amountPence: number;
  entryDate: string | null;
  note?: string;
  debtPersonId?: number;
}) {
  return requireSession(async () => {
    assertPositivePence(input.amountPence);
    const entryDate = input.entryDate ?? localIsoDate();
    const { year, month } = parseIsoDate(entryDate);
    await pencilInIncome({ ...input, entryDate, year, month });
    revalidatePath("/review");
    revalidatePath("/grid");
    revalidatePath("/debt");
  });
}

/** The booked transaction that just synced in matches a pencilled-in
 * income guess - mirrors confirmImportedTransactionMatch. */
export async function confirmImportedTransactionIncomeMatch(importedTransactionId: number, incomeTransactionId: number) {
  return requireSession(async () => {
    await confirmPencilledIncomeMatch(importedTransactionId, incomeTransactionId);
    revalidatePath("/review");
    revalidatePath("/grid");
  });
}

/** The pencilled-in income guess was wrong - mirrors
 * discardImportedTransactionMatch. */
export async function discardImportedTransactionIncomeMatch(incomeTransactionId: number) {
  return requireSession(async () => {
    await discardPencilledIncome(incomeTransactionId);
    revalidatePath("/review");
    revalidatePath("/grid");
    revalidatePath("/debt");
  });
}
