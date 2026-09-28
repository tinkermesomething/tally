"use server";

import { revalidatePath } from "next/cache";
import {
  addCategory as addCategoryQuery,
  addIncomeSource as addIncomeSourceQuery,
  archiveCategory as archiveCategoryQuery,
  archiveIncomeSource as archiveIncomeSourceQuery,
  deleteCategoryEntry,
  deleteExpenseEntry as deleteExpenseEntryQuery,
  deleteIncomeEntry,
  getExpenseEntriesForCell,
  getGridData,
  incrementIncomeEntry,
  logExpense as logExpenseQuery,
  renameCategory as renameCategoryQuery,
  setCategoryEntryPaid,
  unarchiveCategory as unarchiveCategoryQuery,
  unarchiveIncomeSource as unarchiveIncomeSourceQuery,
  updateCategoryDueDay as updateCategoryDueDayQuery,
  updateCategoryGroup as updateCategoryGroupQuery,
  updateExpenseEntry as updateExpenseEntryQuery,
  upsertCategoryEntry,
  upsertIncomeEntry,
} from "@/lib/db/queries";
import { addDebtEntry } from "@/lib/db/debt";
import { poundsToPence } from "@/lib/money";
import { parseIsoDate } from "@/lib/date";

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
  if (input.pounds <= 0) {
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
  /** Set when this expense is also paying someone back - creates the real
   * debt-ledger "repayment" entry too (mirrors addLedgerEntry's own
   * repayment+categoryId branch, just entered from the expense side). */
  debtPersonId?: number;
}) {
  if (input.pounds <= 0) {
    throw new Error("Expense amount must be greater than zero.");
  }
  const amountPence = poundsToPence(input.pounds);
  await logExpenseQuery({
    categoryId: input.categoryId,
    amountPence,
    entryDate: input.entryDate,
    note: input.note,
    debtPersonId: input.debtPersonId,
  });
  if (input.debtPersonId) {
    await addDebtEntry({
      personId: input.debtPersonId,
      entryDate: input.entryDate,
      amountPence,
      direction: "repayment",
      note: input.note,
    });
  }
  revalidatePath("/grid");
  revalidatePath("/debt");
}

export async function listExpenseEntries(categoryId: number, year: number, month: number) {
  return getExpenseEntriesForCell(categoryId, year, month);
}

export async function editExpenseEntry(
  id: number,
  input: { pounds?: number; note?: string; entryDate?: string }
) {
  if (input.pounds !== undefined && input.pounds <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  await updateExpenseEntryQuery(id, {
    amountPence: input.pounds !== undefined ? poundsToPence(input.pounds) : undefined,
    note: input.note !== undefined ? input.note || null : undefined,
    entryDate: input.entryDate,
  });
  revalidatePath("/grid");
  revalidatePath("/entries");
}

export async function removeExpenseEntry(id: number) {
  await deleteExpenseEntryQuery(id);
  revalidatePath("/grid");
  revalidatePath("/entries");
}

/** Logs an actual income transaction (additive - matches how logExpense
 * accumulates rather than replaces) against an existing source. Optionally
 * also links it to a debt person as a "loan" - e.g. money someone lent you,
 * as opposed to a gift or wages, which don't touch the debt ledger. Mirrors
 * addLedgerEntry's own loan+incomeSourceId branch (app/debt/actions.ts),
 * just entered from the income side instead of the debt side. */
export async function logIncome(input: {
  incomeSourceId: number;
  pounds: number;
  entryDate: string;
  debtPersonId?: number;
}) {
  if (input.pounds <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  const amountPence = poundsToPence(input.pounds);
  const { year, month } = parseIsoDate(input.entryDate);
  await incrementIncomeEntry({ incomeSourceId: input.incomeSourceId, year, month, amountPence });
  if (input.debtPersonId) {
    await addDebtEntry({
      personId: input.debtPersonId,
      entryDate: input.entryDate,
      amountPence,
      direction: "loan",
    });
  }
  revalidatePath("/grid");
  revalidatePath("/debt");
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
