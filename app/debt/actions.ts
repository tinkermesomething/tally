"use server";

import { revalidatePath } from "next/cache";
import {
  addDebtEntry,
  addPerson as addPersonQuery,
  archivePerson as archivePersonQuery,
  unarchivePerson as unarchivePersonQuery,
} from "@/lib/db/debt";
import { incrementIncomeEntry, logExpense as logExpenseQuery } from "@/lib/db/queries";
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
  if (!(input.pounds > 0)) {
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
    const [year, month] = input.entryDate.split("-").map(Number);
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
