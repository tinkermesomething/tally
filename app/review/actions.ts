"use server";

import { assertPositivePence } from "@/lib/validate";
import { localIsoDate } from "@/lib/date";
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
  setTransactionNote,
} from "@/lib/db/bank-sync";
import { pencilInExpense, discardPencilledExpense } from "@/lib/db/queries";

export async function categorizeImportedTransaction(
  id: number,
  input: { categoryId: number; debtPersonId?: number }
) {
  await requireSession();
  await categorizeTransaction(id, { categoryId: input.categoryId, debtPersonId: input.debtPersonId });
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
}

export async function categorizeImportedTransactionAsIncome(
  id: number,
  input: { incomeSourceId: number; debtPersonId?: number }
) {
  await requireSession();
  await categorizeTransactionAsIncome(id, input);
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/debt");
}

/** Not revalidated: the row keeps its own copy, and redrawing the whole
 * list on every note would drop what you are doing. */
export async function saveImportedTransactionNote(id: number, note: string) {
  await requireSession();
  await setTransactionNote(id, note);
}

export async function ignoreImportedTransaction(id: number) {
  await requireSession();
  await ignoreTransaction(id);
  revalidatePath("/review");
}

export async function restoreImportedTransaction(id: number) {
  await requireSession();
  await restoreTransaction(id);
  revalidatePath("/review");
}

export async function bulkIgnoreImportedTransactions(ids: number[]) {
  await requireSession();
  await bulkIgnoreTransactions(ids);
  revalidatePath("/review");
}

export async function bulkCategorizeImportedTransactionsAsExpense(
  ids: number[],
  input: { categoryId: number; debtPersonId?: number }
) {
  await requireSession();
  await bulkCategorizeTransactionsAsExpense(ids, input);
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
  revalidatePath("/debt");
}

export async function bulkCategorizeImportedTransactionsAsIncome(
  ids: number[],
  input: { incomeSourceId: number; debtPersonId?: number }
) {
  await requireSession();
  await bulkCategorizeTransactionsAsIncome(ids, input);
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/debt");
}

export async function pencilInPendingExpense(input: {
  categoryId: number;
  amountPence: number;
  // The pending preview's own date, when GoCardless has one yet - null
  // falls back to today server-side (this is a same-day guess either way).
  entryDate: string | null;
  note?: string;
}) {
  await requireSession();
  assertPositivePence(input.amountPence);
  await pencilInExpense({ ...input, entryDate: input.entryDate ?? localIsoDate() });
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
  revalidatePath("/debt");
}

/** The booked transaction that just synced in matches a pencilled-in guess
 * - make the draft permanent and mark this bank row already-logged. */
export async function confirmImportedTransactionMatch(importedTransactionId: number, expenseEntryId: number) {
  await requireSession();
  await confirmPencilledMatch(importedTransactionId, expenseEntryId);
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
}

/** The pencilled-in guess was wrong - discard it, let the real bank
 * transaction go through normal categorizing. */
export async function discardImportedTransactionMatch(expenseEntryId: number) {
  await requireSession();
  await discardPencilledExpense(expenseEntryId);
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
  revalidatePath("/debt");
}
