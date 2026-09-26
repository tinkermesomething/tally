"use server";

import { revalidatePath } from "next/cache";
import {
  addDebtEntry,
  addPerson as addPersonQuery,
  archivePerson as archivePersonQuery,
  unarchivePerson as unarchivePersonQuery,
} from "@/lib/db/debt";
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
}) {
  if (!(input.pounds > 0)) {
    throw new Error("Amount must be greater than zero.");
  }
  await addDebtEntry({
    personId: input.personId,
    entryDate: input.entryDate,
    amountPence: poundsToPence(input.pounds),
    direction: input.direction,
    note: input.note,
  });
  revalidatePath(`/debt/${input.personId}`);
  revalidatePath("/debt");
}
