"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { poundsToPence } from "@/lib/money";
import { assertPositivePounds } from "@/lib/validate";
import {
  addBill as addBillQuery,
  archiveBill as archiveBillQuery,
  markBillPaid as markBillPaidQuery,
  unarchiveBill as unarchiveBillQuery,
  updateBill as updateBillQuery,
  type BillCadence,
} from "@/lib/db/bills";

export type BillFormInput = {
  name: string;
  pounds: number;
  cadence: BillCadence;
  cadenceDays?: number | null;
  nextDueDate: string;
  categoryId?: number | null;
};

function toBillInput(input: BillFormInput) {
  assertPositivePounds(input.pounds);
  return {
    name: input.name,
    amountPence: poundsToPence(input.pounds),
    cadence: input.cadence,
    cadenceDays: input.cadenceDays,
    nextDueDate: input.nextDueDate,
    categoryId: input.categoryId,
  };
}

export async function createBill(input: BillFormInput) {
  return requireSession(async () => {
    const bill = await addBillQuery(toBillInput(input));
    revalidatePath("/bills");
    return bill;
  });
}

export async function editBill(id: number, input: BillFormInput) {
  return requireSession(async () => {
    await updateBillQuery(id, toBillInput(input));
    revalidatePath("/bills");
  });
}

export async function markPaid(id: number) {
  return requireSession(async () => {
    await markBillPaidQuery(id);
    revalidatePath("/bills");
  });
}

export async function removeBill(id: number) {
  return requireSession(async () => {
    await archiveBillQuery(id);
    revalidatePath("/bills");
  });
}

export async function restoreBill(id: number) {
  return requireSession(async () => {
    await unarchiveBillQuery(id);
    revalidatePath("/bills");
  });
}
