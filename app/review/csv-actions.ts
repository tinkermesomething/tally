"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { inTransaction } from "@/lib/db";
import { isCsvMapping, type CsvMapping } from "@/lib/csv-import";
import {
  createCsvAccount,
  importCsvTransactions,
  previewCsvImport,
  previewForNewAccount,
  type CsvImportPlan,
  type CsvImportResult,
  type CsvTransactionInput,
  type DuplicatePolicy,
} from "@/lib/db/csv-import";

type Failure = { ok: false; error: string };
const fail = (err: unknown): Failure => ({ ok: false, error: err instanceof Error ? err.message : "Something went wrong." });

/** What an import would do - changes nothing. `accountId` null means a new
 * CSV-only account (nothing to compare against yet). */
export async function previewCsv(input: {
  accountId: number | null;
  transactions: CsvTransactionInput[];
}): Promise<{ ok: true; plan: CsvImportPlan } | Failure> {
  return requireSession(async () => {
    try {
      const plan = input.accountId === null ? previewForNewAccount(input.transactions) : await previewCsvImport(input.accountId, input.transactions);
      return { ok: true, plan };
    } catch (err) {
      return fail(err);
    }
  });
}

export async function importCsv(input: {
  accountId: number | null;
  newAccountName?: string;
  transactions: CsvTransactionInput[];
  duplicatePolicy: DuplicatePolicy;
  mapping: CsvMapping;
}): Promise<{ ok: true; accountId: number; result: CsvImportResult } | Failure> {
  return requireSession(async () => {
    try {
      if (!isCsvMapping(input.mapping)) throw new Error("That column mapping isn't valid.");
      if (input.duplicatePolicy !== "flag" && input.duplicatePolicy !== "skip") throw new Error("Pick what to do with possible duplicates.");
      // A new account and its rows are created together: a failed import never
      // leaves an empty account behind.
      const done = await inTransaction(async () => {
        const accountId = input.accountId ?? (await createCsvAccount(input.newAccountName ?? "")).id;
        const result = await importCsvTransactions(accountId, input.transactions, { duplicatePolicy: input.duplicatePolicy, mapping: input.mapping });
        return { accountId, result };
      });
      revalidatePath("/review");
      revalidatePath("/grid");
      revalidatePath("/entries");
      revalidatePath("/debt");
      revalidatePath("/settings");
      return { ok: true, ...done };
    } catch (err) {
      return fail(err);
    }
  });
}
