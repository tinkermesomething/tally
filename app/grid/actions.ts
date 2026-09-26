"use server";

import { revalidatePath } from "next/cache";
import {
  addCategory as addCategoryQuery,
  addIncomeSource as addIncomeSourceQuery,
  logExpense as logExpenseQuery,
  renameCategory as renameCategoryQuery,
  setCategoryEntryPaid,
  updateCategoryGroup as updateCategoryGroupQuery,
  upsertCategoryEntry,
  upsertIncomeEntry,
} from "@/lib/db/queries";
import { poundsToPence } from "@/lib/money";

export async function updateAmount(input: {
  categoryId: number;
  year: number;
  month: number;
  pounds: number;
}) {
  await upsertCategoryEntry({
    categoryId: input.categoryId,
    year: input.year,
    month: input.month,
    amountPence: poundsToPence(input.pounds),
  });
  revalidatePath("/grid");
}

export async function togglePaid(input: {
  categoryId: number;
  year: number;
  month: number;
  paid: boolean;
}) {
  await setCategoryEntryPaid(input);
  revalidatePath("/grid");
}

export async function logExpense(input: {
  categoryId: number;
  pounds: number;
  entryDate: string;
  note?: string;
}) {
  if (!(input.pounds > 0)) {
    throw new Error("Expense amount must be greater than zero.");
  }
  await logExpenseQuery({
    categoryId: input.categoryId,
    amountPence: poundsToPence(input.pounds),
    entryDate: input.entryDate,
    note: input.note,
  });
  revalidatePath("/grid");
}

export async function updateIncomeAmount(input: {
  incomeSourceId: number;
  year: number;
  month: number;
  pounds: number;
}) {
  await upsertIncomeEntry({
    incomeSourceId: input.incomeSourceId,
    year: input.year,
    month: input.month,
    amountPence: poundsToPence(input.pounds),
  });
  revalidatePath("/grid");
}

export async function createIncomeSource(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name can't be empty.");
  await addIncomeSourceQuery(trimmed);
  revalidatePath("/grid");
}

export async function createCategory(input: {
  name: string;
  parentId: number | null;
  groupName: string | null;
  isAnnual: boolean;
  annualMonth: number | null;
}) {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("Name can't be empty.");
  await addCategoryQuery({ ...input, name: trimmed });
  revalidatePath("/grid");
  revalidatePath("/reports");
}

export async function renameCategory(categoryId: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  await renameCategoryQuery(categoryId, trimmed);
  revalidatePath("/grid");
}

export async function updateCategoryGroup(categoryId: number, groupName: string) {
  await updateCategoryGroupQuery(categoryId, groupName.trim() || null);
  revalidatePath("/grid");
  revalidatePath("/reports");
}
