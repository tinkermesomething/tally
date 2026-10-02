"use server";

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
} from "@/lib/db/bank-sync";
import { pencilInExpense, discardPencilledExpense } from "@/lib/db/queries";

export async function categorizeImportedTransaction(
  id: number,
  input: { categoryId: number; debtPersonId?: number }
) {
  await categorizeTransaction(id, { categoryId: input.categoryId, debtPersonId: input.debtPersonId });
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
}

export async function categorizeImportedTransactionAsIncome(id: number, input: { incomeSourceId: number }) {
  await categorizeTransactionAsIncome(id, input);
  revalidatePath("/review");
  revalidatePath("/grid");
}

export async function ignoreImportedTransaction(id: number) {
  await ignoreTransaction(id);
  revalidatePath("/review");
}

export async function restoreImportedTransaction(id: number) {
  await restoreTransaction(id);
  revalidatePath("/review");
}

export async function bulkIgnoreImportedTransactions(ids: number[]) {
  await bulkIgnoreTransactions(ids);
  revalidatePath("/review");
}

export async function bulkCategorizeImportedTransactionsAsExpense(
  ids: number[],
  input: { categoryId: number }
) {
  await bulkCategorizeTransactionsAsExpense(ids, input);
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
  revalidatePath("/debt");
}

export async function bulkCategorizeImportedTransactionsAsIncome(
  ids: number[],
  input: { incomeSourceId: number }
) {
  await bulkCategorizeTransactionsAsIncome(ids, input);
  revalidatePath("/review");
  revalidatePath("/grid");
}

export async function pencilInPendingExpense(input: {
  categoryId: number;
  amountPence: number;
  // The pending preview's own date, when GoCardless has one yet - null
  // falls back to today server-side (this is a same-day guess either way).
  entryDate: string | null;
  note?: string;
}) {
  await pencilInExpense({ ...input, entryDate: input.entryDate ?? new Date().toISOString().slice(0, 10) });
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
  revalidatePath("/debt");
}

/** The booked transaction that just synced in matches a pencilled-in guess
 * - make the draft permanent and mark this bank row already-logged. */
export async function confirmImportedTransactionMatch(importedTransactionId: number, expenseEntryId: number) {
  await confirmPencilledMatch(importedTransactionId, expenseEntryId);
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
}

/** The pencilled-in guess was wrong - discard it, let the real bank
 * transaction go through normal categorizing. */
export async function discardImportedTransactionMatch(expenseEntryId: number) {
  await discardPencilledExpense(expenseEntryId);
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
  revalidatePath("/debt");
}
