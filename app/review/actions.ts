"use server";

import { revalidatePath } from "next/cache";
import {
  categorizeTransaction,
  ignoreTransaction,
  restoreTransaction,
  bulkIgnoreTransactions,
} from "@/lib/db/bank-sync";

export async function categorizeImportedTransaction(
  id: number,
  input: { categoryId: number; debtPersonId?: number }
) {
  await categorizeTransaction(id, { categoryId: input.categoryId, debtPersonId: input.debtPersonId ?? null });
  revalidatePath("/review");
  revalidatePath("/grid");
  revalidatePath("/entries");
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
