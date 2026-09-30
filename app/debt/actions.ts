"use server";

import { revalidatePath } from "next/cache";
import {
  addDebtEntry,
  addPerson as addPersonQuery,
  archivePerson as archivePersonQuery,
  deleteDebtEntry,
  unarchivePerson as unarchivePersonQuery,
  updateDebtEntry,
} from "@/lib/db/debt";
import { incrementIncomeEntry, logExpense as logExpenseQuery } from "@/lib/db/queries";
import { resolvePeriodForDate } from "@/lib/db/pay-period";
import { poundsToPence } from "@/lib/money";

export async function createPerson(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name can't be empty.");
  const person = await addPersonQuery(trimmed);
  revalidatePath("/debt");
  return person;
}

export async function removePerson(personId: number) {
  await archivePersonQuery(personId);
  revalidatePath("/debt");
  revalidatePath("/settings");
}

export async function restorePerson(personId: number) {
  await unarchivePersonQuery(personId);
  revalidatePath("/debt");
  revalidatePath("/settings");
}

export async function addLedgerEntry(input: {
  personId: number;
  pounds: number;
  entryDate: string;
  direction: "loan" | "repayment";
  note?: string;
  /** direction "loan" only: also credits this month's income under the
   * chosen source, e.g. a friend's loan landing as real money in. */
  incomeSourceId?: number;
  /** direction "repayment" only: also logs a real expense under this
   * category, e.g. paying a loan back out of the Misc budget. */
  categoryId?: number;
}) {
  if (input.pounds <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  const amountPence = poundsToPence(input.pounds);

  await addDebtEntry({
    personId: input.personId,
    entryDate: input.entryDate,
    amountPence,
    direction: input.direction,
    note: input.note,
  });

  if (input.direction === "loan" && input.incomeSourceId) {
    // Respects an existing pay-period boundary (if any) the same as every
    // other logged entry - but doesn't create a new one; only the primary
    // Add Income flow can do that, since it's the only place with a
    // "counts toward" picker for the anchor source itself.
    const { year, month } = await resolvePeriodForDate(input.entryDate);
    await incrementIncomeEntry({ incomeSourceId: input.incomeSourceId, year, month, amountPence });
  }

  if (input.direction === "repayment" && input.categoryId) {
    await logExpenseQuery({
      categoryId: input.categoryId,
      amountPence,
      entryDate: input.entryDate,
      note: input.note,
      debtPersonId: input.personId,
    });
  }

  revalidatePath(`/debt/${input.personId}`);
  revalidatePath("/debt");
  revalidatePath("/grid");
  revalidatePath("/reports");
}

export async function editLedgerEntry(
  personId: number,
  id: number,
  input: { pounds?: number; direction?: "loan" | "repayment"; entryDate?: string; note?: string }
) {
  if (input.pounds !== undefined && input.pounds <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  await updateDebtEntry(id, {
    amountPence: input.pounds !== undefined ? poundsToPence(input.pounds) : undefined,
    direction: input.direction,
    entryDate: input.entryDate,
    note: input.note !== undefined ? input.note || null : undefined,
  });
  revalidatePath(`/debt/${personId}`);
  revalidatePath("/debt");
}

export async function removeLedgerEntry(personId: number, id: number) {
  await deleteDebtEntry(id);
  revalidatePath(`/debt/${personId}`);
  revalidatePath("/debt");
}
