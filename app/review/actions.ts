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
} from "@/lib/db/bank-sync";

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
