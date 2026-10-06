"use server";

import { assertNonNegativePounds, assertPositivePounds } from "@/lib/validate";
import { toResult, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/lib/session";
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
  getIncomeSource,
  incrementIncomeEntry,
  logExpense as logExpenseQuery,
  moveCategoryParent as moveCategoryParentQuery,
  renameCategory as renameCategoryQuery,
  setCategoryEntryPaid,
  unarchiveCategory as unarchiveCategoryQuery,
  unarchiveIncomeSource as unarchiveIncomeSourceQuery,
  updateCategoryDueDay as updateCategoryDueDayQuery,
  updateCategoryDebtLink as updateCategoryDebtLinkQuery,
  updateCategoryGroup as updateCategoryGroupQuery,
  updateExpenseEntry as updateExpenseEntryQuery,
  upsertCategoryEntry,
  upsertIncomeEntry,
} from "@/lib/db/queries";
import { addDebtEntry } from "@/lib/db/debt";
import { moveCategoryOrder, reorderCategoryTo } from "@/lib/db/category-tree";
import { recordPayPeriodAnchor, refileExpensesFromAnchor, setPayAnchorSource } from "@/lib/db/pay-period";
import { poundsToPence } from "@/lib/money";
import { parseIsoDate } from "@/lib/date";
import { inTransaction } from "@/lib/db";

export async function updateAmount(input: {
  categoryId: number;
  year: number;
  month: number;
  pounds: number;
}) {
  await requireSession();
  assertNonNegativePounds(input.pounds);
  await upsertCategoryEntry({
    categoryId: input.categoryId,
    year: input.year,
    month: input.month,
    amountPence: poundsToPence(input.pounds),
  });
  revalidatePath("/grid");
}

export async function clearAmount(input: { categoryId: number; year: number; month: number }) {
  await requireSession();
  await deleteCategoryEntry(input);
  revalidatePath("/grid");
}

export async function clearIncomeAmount(input: {
  incomeSourceId: number;
  year: number;
  month: number;
}) {
  await requireSession();
  await deleteIncomeEntry(input);
  revalidatePath("/grid");
}

/** Bulk version of the per-cell "use last month's value" hint - only fills
 * genuinely blank cells (categories and income sources both), never
 * overwrites an existing entry, same as the per-cell hint it's built from. */
export async function copyPreviousMonthValues(input: { year: number; month: number }) {
  await requireSession();
  const data = await getGridData(input.year);

  await inTransaction(async () => {
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
  });

  revalidatePath("/grid");
}

export async function togglePaid(input: {
  categoryId: number;
  year: number;
  month: number;
  paid: boolean;
}) {
  await requireSession();
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
  /** ISO date - which real day the money actually left, not necessarily
   * today. Caller (the grid cell's confirm popup) defaults this sensibly
   * via defaultEntryDateFor, but the real value always comes from the user,
   * since entryDate is what decides which year/month the resulting expense
   * lands in (see logExpense) - silently hardcoding "today" here caused a
   * real bug: confirming an old month's cell after today filed the expense
   * under today's month instead. */
  entryDate: string;
}) {
  await requireSession();
  assertPositivePounds(input.pounds);
  const { entryDate } = input;
  await inTransaction(async () => {
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
  });
  revalidatePath("/grid");
}

export async function logExpense(input: {
  categoryId: number;
  pounds: number;
  entryDate: string;
  note?: string;
  /** Set when this expense is also paying someone back. logExpenseQuery
   * itself creates the real debt-ledger "repayment" entry (and falls back
   * to the category's own linkedDebtPersonId if this is omitted) - don't
   * duplicate that here. */
  debtPersonId?: number;
}) {
  await requireSession();
  return toResult(async () => {
    assertPositivePounds(input.pounds, "Expense amount must be greater than zero.");
    const amountPence = poundsToPence(input.pounds);
    await logExpenseQuery({
      categoryId: input.categoryId,
      amountPence,
      entryDate: input.entryDate,
      note: input.note,
      debtPersonId: input.debtPersonId,
    });
    revalidatePath("/grid");
    revalidatePath("/debt");
  });
}

export async function listExpenseEntries(categoryId: number, year: number, month: number) {
  await requireSession();
  return getExpenseEntriesForCell(categoryId, year, month);
}

export async function editExpenseEntry(
  id: number,
  input: { pounds?: number; note?: string; entryDate?: string }
) {
  await requireSession();
  if (input.pounds !== undefined) assertPositivePounds(input.pounds);
  await updateExpenseEntryQuery(id, {
    amountPence: input.pounds !== undefined ? poundsToPence(input.pounds) : undefined,
    note: input.note !== undefined ? input.note || null : undefined,
    entryDate: input.entryDate,
  });
  revalidatePath("/grid");
  revalidatePath("/entries");
}

export async function removeExpenseEntry(id: number) {
  await requireSession();
  await deleteExpenseEntryQuery(id);
  revalidatePath("/grid");
  revalidatePath("/entries");
  revalidatePath("/debt");
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
  /** Required when incomeSourceId is the designated pay anchor (see
   * lib/db/pay-period.ts) - which budget month this payment counts toward,
   * independent of its real calendar date (e.g. received Aug 28, counted
   * as September). Ignored for any non-anchor source, which always derives
   * its period from entryDate as before. */
  periodYear?: number;
  periodMonth?: number;
  debtPersonId?: number;
}) {
  await requireSession();
  return toResult(async () => {
    assertPositivePounds(input.pounds);
    const amountPence = poundsToPence(input.pounds);
    await inTransaction(async () => {
      const source = await getIncomeSource(input.incomeSourceId);
      if (!source) {
        throw new Error("Income source not found.");
      }

      let year: number;
      let month: number;
      if (source.isPayAnchor) {
        if (input.periodYear === undefined || input.periodMonth === undefined) {
          throw new Error("Pick which budget month this pay anchor entry counts toward.");
        }
        year = input.periodYear;
        month = input.periodMonth;
        await recordPayPeriodAnchor({
          incomeSourceId: input.incomeSourceId,
          receivedDate: input.entryDate,
          year,
          month,
        });
        await refileExpensesFromAnchor(input.entryDate);
      } else {
        ({ year, month } = parseIsoDate(input.entryDate));
      }

      await incrementIncomeEntry({ incomeSourceId: input.incomeSourceId, year, month, amountPence });
      if (input.debtPersonId) {
        await addDebtEntry({
          personId: input.debtPersonId,
          entryDate: input.entryDate,
          amountPence,
          direction: "loan",
        });
      }
    });
    revalidatePath("/entries");
    revalidatePath("/grid");
    revalidatePath("/debt");
  });
}

export async function updateIncomeAmount(input: {
  incomeSourceId: number;
  year: number;
  month: number;
  pounds: number;
}) {
  await requireSession();
  assertNonNegativePounds(input.pounds);
  await upsertIncomeEntry({
    incomeSourceId: input.incomeSourceId,
    year: input.year,
    month: input.month,
    amountPence: poundsToPence(input.pounds),
  });
  revalidatePath("/grid");
}

export async function createIncomeSource(name: string) {
  await requireSession();
  return toResult(async () => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name can't be empty.");
    await addIncomeSourceQuery(trimmed);
    revalidatePath("/grid");
  });
}

export async function createCategory(input: {
  name: string;
  parentId: number | null;
  groupName: string | null;
  isAnnual: boolean;
  annualMonth: number | null;
}) {
  await requireSession();
  return toResult(async () => {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error("Name can't be empty.");
    await addCategoryQuery({ ...input, name: trimmed });
    revalidatePath("/grid");
    revalidatePath("/reports");
  });
}

/** Drop a category at a position among its siblings (see reorderCategoryTo) -
 * what the press-and-hold drag calls. */
export async function moveCategoryToIndex(categoryId: number, toIndex: number, year: number): Promise<ActionResult> {
  await requireSession();
  return toResult(async () => {
    if (!Number.isInteger(year)) throw new Error("Pick a year.");
    await reorderCategoryTo(categoryId, toIndex, year);
    revalidatePath("/grid");
    revalidatePath("/settings");
    revalidatePath("/reports");
    revalidatePath("/entries");
  });
}

/** One place up or down among its siblings (see moveCategoryOrder). */
export async function reorderCategory(
  categoryId: number,
  direction: "up" | "down",
  year: number
): Promise<ActionResult> {
  await requireSession();
  return toResult(async () => {
    if (direction !== "up" && direction !== "down") throw new Error("Pick up or down.");
    if (!Number.isInteger(year)) throw new Error("Pick a year.");
    await moveCategoryOrder(categoryId, direction, year);
    revalidatePath("/grid");
    revalidatePath("/settings");
    revalidatePath("/reports");
    revalidatePath("/entries");
  });
}

export async function renameCategory(categoryId: number, name: string) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;
  await renameCategoryQuery(categoryId, trimmed);
  revalidatePath("/grid");
}

export async function updateCategoryGroup(categoryId: number, groupName: string) {
  await requireSession();
  await updateCategoryGroupQuery(categoryId, groupName.trim() || null);
  revalidatePath("/grid");
  revalidatePath("/reports");
}

export async function updateCategoryDueDay(categoryId: number, dueDay: number | null) {
  await requireSession();
  if (dueDay !== null && (dueDay < 1 || dueDay > 31)) {
    throw new Error("Due day must be between 1 and 31.");
  }
  await updateCategoryDueDayQuery(categoryId, dueDay);
  revalidatePath("/grid");
  revalidatePath("/settings");
}

export async function updateCategoryDebtLink(categoryId: number, linkedDebtPersonId: number | null) {
  await requireSession();
  await updateCategoryDebtLinkQuery(categoryId, linkedDebtPersonId);
  revalidatePath("/settings");
}

export async function archiveCategory(categoryId: number) {
  await requireSession();
  await archiveCategoryQuery(categoryId);
  revalidatePath("/grid");
  revalidatePath("/reports");
  revalidatePath("/settings");
}

/** Moves a category to a new parent (or null for top-level) starting this
 * calendar year - see moveCategoryParent for the year-scoping and leaf-only
 * validation this wraps. */
export async function moveCategory(categoryId: number, newParentId: number | null) {
  await requireSession();
  await moveCategoryParentQuery(categoryId, newParentId);
  revalidatePath("/grid");
  revalidatePath("/reports");
  revalidatePath("/settings");
}

/** Marks one income source as the pay anchor (or clears it, with null) -
 * see setPayAnchorSource for why only one source can hold this at a time. */
export async function setPayAnchor(incomeSourceId: number | null) {
  await requireSession();
  await setPayAnchorSource(incomeSourceId);
  revalidatePath("/grid");
  revalidatePath("/settings");
}

export async function archiveIncomeSource(id: number) {
  await requireSession();
  await archiveIncomeSourceQuery(id);
  revalidatePath("/grid");
  revalidatePath("/settings");
}

export async function unarchiveCategory(categoryId: number) {
  await requireSession();
  await unarchiveCategoryQuery(categoryId);
  revalidatePath("/grid");
  revalidatePath("/reports");
  revalidatePath("/settings");
}

export async function unarchiveIncomeSource(id: number) {
  await requireSession();
  await unarchiveIncomeSourceQuery(id);
  revalidatePath("/grid");
  revalidatePath("/settings");
}
