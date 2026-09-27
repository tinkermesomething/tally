"use server";

import { revalidatePath } from "next/cache";
import {
  addCategory as addCategoryQuery,
  addIncomeSource as addIncomeSourceQuery,
  archiveCategory as archiveCategoryQuery,
  archiveIncomeSource as archiveIncomeSourceQuery,
  deleteCategoryEntry,
  deleteIncomeEntry,
  getGridData,
  logExpense as logExpenseQuery,
  renameCategory as renameCategoryQuery,
  setCategoryEntryPaid,
  unarchiveCategory as unarchiveCategoryQuery,
  unarchiveIncomeSource as unarchiveIncomeSourceQuery,
  updateCategoryDueDay as updateCategoryDueDayQuery,
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

export async function clearAmount(input: { categoryId: number; year: number; month: number }) {
  await deleteCategoryEntry(input);
  revalidatePath("/grid");
}

export async function clearIncomeAmount(input: {
  incomeSourceId: number;
  year: number;
  month: number;
}) {
  await deleteIncomeEntry(input);
  revalidatePath("/grid");
}

/** Bulk version of the per-cell "use last month's value" hint - only fills
 * genuinely blank cells (categories and income sources both), never
 * overwrites an existing entry, same as the per-cell hint it's built from. */
export async function copyPreviousMonthValues(input: { year: number; month: number }) {
  const data = await getGridData(input.year);

  const allCategories = data.categories.flatMap((c) => [c, ...c.children]);
  for (const category of allCategories) {
    const cell = category.months[input.month];
    if (cell?.computed) continue;
    if (cell?.amountPence === undefined && cell?.previousAmountPence !== undefined) {
      await upsertCategoryEntry({
        categoryId: category.id,
        year: input.year,
        month: input.month,
        amountPence: cell.previousAmountPence,
      });
    }
  }

  for (const source of data.incomeSources) {
    const cell = source.months[input.month];
    if (cell?.amountPence === undefined && cell?.previousAmountPence !== undefined) {
      await upsertIncomeEntry({
        incomeSourceId: source.id,
        year: input.year,
        month: input.month,
        amountPence: cell.previousAmountPence,
      });
    }
  }

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

/** Ticking "paid" is also the moment the actual amount is known, which may
 * differ from what was allocated - so it both marks the entry paid and logs
 * an expense for the confirmed amount in one action, instead of requiring a
 * separate trip through the Log Expense dialog. */
export async function confirmPayment(input: {
  categoryId: number;
  year: number;
  month: number;
  pounds: number;
}) {
  if (!(input.pounds > 0)) {
    throw new Error("Amount must be greater than zero.");
  }
  const entryDate = new Date().toISOString().slice(0, 10);
  await setCategoryEntryPaid({
    categoryId: input.categoryId,
    year: input.year,
    month: input.month,
    paid: true,
  });
  await logExpenseQuery({
    categoryId: input.categoryId,
    amountPence: poundsToPence(input.pounds),
    entryDate,
  });
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

export async function updateCategoryDueDay(categoryId: number, dueDay: number | null) {
  if (dueDay !== null && (dueDay < 1 || dueDay > 31)) {
    throw new Error("Due day must be between 1 and 31.");
  }
  await updateCategoryDueDayQuery(categoryId, dueDay);
  revalidatePath("/grid");
  revalidatePath("/settings");
}

export async function archiveCategory(categoryId: number) {
  await archiveCategoryQuery(categoryId);
  revalidatePath("/grid");
  revalidatePath("/reports");
  revalidatePath("/settings");
}

export async function archiveIncomeSource(id: number) {
  await archiveIncomeSourceQuery(id);
  revalidatePath("/grid");
  revalidatePath("/settings");
}

export async function unarchiveCategory(categoryId: number) {
  await unarchiveCategoryQuery(categoryId);
  revalidatePath("/grid");
  revalidatePath("/reports");
  revalidatePath("/settings");
}

export async function unarchiveIncomeSource(id: number) {
  await unarchiveIncomeSourceQuery(id);
  revalidatePath("/grid");
  revalidatePath("/settings");
}
