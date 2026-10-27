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
  logExpense as logExpenseQuery,
  logIncomeTransaction,
  moveCategoryParent as moveCategoryParentQuery,
  renameCategory as renameCategoryQuery,
  setCategoryEntryPaid,
  unarchiveCategory as unarchiveCategoryQuery,
  unarchiveIncomeSource as unarchiveIncomeSourceQuery,
  updateCategoryDueDay as updateCategoryDueDayQuery,
  updateCategoryDebtLink as updateCategoryDebtLinkQuery,
  bulkUpdateCategoryGroup as bulkUpdateCategoryGroupQuery,
  updateCategoryGroup as updateCategoryGroupQuery,
  updateExpenseEntry as updateExpenseEntryQuery,
  upsertCategoryEntry,
  upsertIncomeEntry,
} from "@/lib/db/queries";
import { moveCategoryOrder, reorderCategoryTo } from "@/lib/db/category-tree";
import { renameIncomeSource as renameIncomeSourceQuery, reorderIncomeSourceTo } from "@/lib/db/income-order";
import { getTagOptions, linkCategoryAndTag, listMissingTags, setExpenseTags, type MissingTagRow } from "@/lib/db/retro-tags";
import {
  bulkShareCategoriesToHousehold,
  linkCategoryToHousehold,
  listUnshared,
  setExpenseHouseholdShare,
  shareIncomeSource,
  type HouseholdShareRow,
} from "@/lib/db/household-tags";
import { isHouseholdEnabled, reconcileHouseholdDataForUser } from "@/lib/db/household";
import { setIncomeSourceColor } from "@/lib/db/queries";
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
  return requireSession(async () => {
    assertNonNegativePounds(input.pounds);
    await upsertCategoryEntry({
      categoryId: input.categoryId,
      year: input.year,
      month: input.month,
      amountPence: poundsToPence(input.pounds),
    });
    revalidatePath("/grid");
  });
}

export async function clearAmount(input: { categoryId: number; year: number; month: number }) {
  return requireSession(async () => {
    await deleteCategoryEntry(input);
    revalidatePath("/grid");
  });
}

export async function clearIncomeAmount(input: {
  incomeSourceId: number;
  year: number;
  month: number;
}) {
  return requireSession(async () => {
    await deleteIncomeEntry(input);
    revalidatePath("/grid");
  });
}

/** Bulk version of the per-cell "use last month's value" hint - only fills
 * genuinely blank cells (categories and income sources both), never
 * overwrites an existing entry, same as the per-cell hint it's built from. */
export async function copyPreviousMonthValues(input: { year: number; month: number }) {
  return requireSession(async () => {
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
  });
}

export async function togglePaid(input: {
  categoryId: number;
  year: number;
  month: number;
  paid: boolean;
}) {
  return requireSession(async () => {
    await setCategoryEntryPaid(input);
    revalidatePath("/grid");
  });
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
  return requireSession(async () => {
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
  });
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
  return requireSession((user) =>
    toResult(async () => {
      assertPositivePounds(input.pounds, "Expense amount must be greater than zero.");
      const amountPence = poundsToPence(input.pounds);
      await logExpenseQuery({
        categoryId: input.categoryId,
        amountPence,
        entryDate: input.entryDate,
        note: input.note,
        debtPersonId: input.debtPersonId,
      });
      // Logging into an already-shared category needs this reflected in
      // Household right away, not just whenever that page next happens to
      // load or the 15-minute tick runs - same eager-reconcile the
      // share-toggle actions already use.
      await reconcileHouseholdDataForUser(user.id);
      revalidatePath("/grid");
      revalidatePath("/debt");
      revalidatePath("/household");
    })
  );
}

export async function listExpenseEntries(categoryId: number, year: number, month: number) {
  return requireSession(() => getExpenseEntriesForCell(categoryId, year, month));
}

export async function editExpenseEntry(
  id: number,
  input: { pounds?: number; note?: string; entryDate?: string }
) {
  return requireSession(async (user) => {
    if (input.pounds !== undefined) assertPositivePounds(input.pounds);
    await updateExpenseEntryQuery(id, {
      amountPence: input.pounds !== undefined ? poundsToPence(input.pounds) : undefined,
      note: input.note !== undefined ? input.note || null : undefined,
      entryDate: input.entryDate,
    });
    await reconcileHouseholdDataForUser(user.id);
    revalidatePath("/grid");
    revalidatePath("/entries");
    revalidatePath("/household");
  });
}

export async function removeExpenseEntry(id: number) {
  return requireSession(async (user) => {
    await deleteExpenseEntryQuery(id);
    await reconcileHouseholdDataForUser(user.id);
    revalidatePath("/grid");
    revalidatePath("/entries");
    revalidatePath("/debt");
    revalidatePath("/household");
  });
}

/** Logs a real income_transactions row against an existing source - the
 * actual-ledger counterpart to logExpense, same as logExpense never touches
 * category_entries' budgeted amount, this never touches income_entries'.
 * Optionally also links it to a debt person as a "loan" - e.g. money
 * someone lent you, as opposed to a gift or wages, which don't touch the
 * debt ledger. Mirrors addLedgerEntry's own loan+incomeSourceId branch
 * (app/debt/actions.ts), just entered from the income side instead of the
 * debt side. */
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
  return requireSession(() =>
    toResult(async () => {
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

        await logIncomeTransaction({
          incomeSourceId: input.incomeSourceId,
          amountPence,
          entryDate: input.entryDate,
          year,
          month,
          debtPersonId: input.debtPersonId,
        });
      });
      revalidatePath("/entries");
      revalidatePath("/grid");
      revalidatePath("/debt");
    })
  );
}

export async function updateIncomeAmount(input: {
  incomeSourceId: number;
  year: number;
  month: number;
  pounds: number;
}) {
  return requireSession(async () => {
    assertNonNegativePounds(input.pounds);
    await upsertIncomeEntry({
      incomeSourceId: input.incomeSourceId,
      year: input.year,
      month: input.month,
      amountPence: poundsToPence(input.pounds),
    });
    revalidatePath("/grid");
  });
}

export async function createIncomeSource(name: string) {
  return requireSession(() =>
    toResult(async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name can't be empty.");
      await addIncomeSourceQuery(trimmed);
      revalidatePath("/grid");
    })
  );
}

export async function createCategory(input: {
  name: string;
  parentId: number | null;
  groupName: string | null;
  isAnnual: boolean;
  annualMonth: number | null;
}) {
  return requireSession(() =>
    toResult(async () => {
      const trimmed = input.name.trim();
      if (!trimmed) throw new Error("Name can't be empty.");
      await addCategoryQuery({ ...input, name: trimmed });
      revalidatePath("/grid");
      revalidatePath("/reports");
    })
  );
}

/** Drop a category at a position among its siblings (see reorderCategoryTo) -
 * what the press-and-hold drag calls. */
export async function moveCategoryToIndex(categoryId: number, toIndex: number, year: number): Promise<ActionResult> {
  return requireSession(() =>
    toResult(async () => {
      if (!Number.isInteger(year)) throw new Error("Pick a year.");
      await reorderCategoryTo(categoryId, toIndex, year);
      revalidatePath("/grid");
      revalidatePath("/settings");
      revalidatePath("/reports");
      revalidatePath("/entries");
    })
  );
}

/** Drop an income source at a position among the sources shown for `year` -
 * what the press-and-hold drag calls (see reorderIncomeSourceTo). */
export async function moveIncomeSourceToIndex(incomeSourceId: number, toIndex: number, year: number): Promise<ActionResult> {
  return requireSession(() =>
    toResult(async () => {
      if (!Number.isInteger(year)) throw new Error("Pick a year.");
      await reorderIncomeSourceTo(incomeSourceId, toIndex, year);
      revalidatePath("/grid");
      revalidatePath("/settings");
    })
  );
}

export async function renameIncomeSource(incomeSourceId: number, name: string): Promise<ActionResult> {
  return requireSession(() =>
    toResult(async () => {
      await renameIncomeSourceQuery(incomeSourceId, name);
      revalidatePath("/grid");
      revalidatePath("/settings");
      revalidatePath("/reports");
    })
  );
}

/** One place up or down among its siblings (see moveCategoryOrder). */
export async function reorderCategory(
  categoryId: number,
  direction: "up" | "down",
  year: number
): Promise<ActionResult> {
  return requireSession(() =>
    toResult(async () => {
      if (direction !== "up" && direction !== "down") throw new Error("Pick up or down.");
      if (!Number.isInteger(year)) throw new Error("Pick a year.");
      await moveCategoryOrder(categoryId, direction, year);
      revalidatePath("/grid");
      revalidatePath("/settings");
      revalidatePath("/reports");
      revalidatePath("/entries");
    })
  );
}

export async function renameCategory(categoryId: number, name: string) {
  return requireSession(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await renameCategoryQuery(categoryId, trimmed);
    revalidatePath("/grid");
  });
}

export async function updateCategoryGroup(categoryId: number, groupName: string) {
  return requireSession(async () => {
    await updateCategoryGroupQuery(categoryId, groupName.trim() || null);
    revalidatePath("/grid");
    revalidatePath("/reports");
  });
}

/** Sets the group for every selected id in one go, from the Categories
 * tab's multi-select bar - ids that aren't top-level categories are
 * silently skipped (see bulkUpdateCategoryGroup), so `updated` can be
 * lower than `categoryIds.length` without that being an error. */
export async function bulkSetCategoryGroup(categoryIds: number[], groupName: string): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  return requireSession(async () => {
    try {
      const trimmed = groupName.trim();
      if (!trimmed) return { ok: false, error: "Enter a group name." };
      const ids = Array.isArray(categoryIds) ? categoryIds.filter((n) => Number.isInteger(n)) : [];
      const updated = await bulkUpdateCategoryGroupQuery(ids, trimmed);
      revalidatePath("/grid");
      revalidatePath("/reports");
      revalidatePath("/settings");
      return { ok: true, updated };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't set that group." };
    }
  });
}

/** Shares (or unshares) every selected id's own default in one go - leaf
 * categories only (see bulkShareCategoriesToHousehold), no backfill of
 * existing expenses (that still needs the per-category dialog). */
export async function bulkSetHouseholdShare(categoryIds: number[], share: boolean): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  return requireSession(async (user) => {
    try {
      const ids = Array.isArray(categoryIds) ? categoryIds.filter((n) => Number.isInteger(n)) : [];
      const updated = await bulkShareCategoriesToHousehold(ids, share);
      await reconcileHouseholdDataForUser(user.id);
      refreshTagged();
      return { ok: true, updated };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't update sharing." };
    }
  });
}

export async function updateCategoryDueDay(categoryId: number, dueDay: number | null) {
  return requireSession(async () => {
    if (dueDay !== null && (dueDay < 1 || dueDay > 31)) {
      throw new Error("Due day must be between 1 and 31.");
    }
    await updateCategoryDueDayQuery(categoryId, dueDay);
    revalidatePath("/grid");
    revalidatePath("/settings");
  });
}

export async function updateCategoryDebtLink(categoryId: number, linkedDebtPersonId: number | null) {
  return requireSession(async () => {
    await updateCategoryDebtLinkQuery(categoryId, linkedDebtPersonId);
    revalidatePath("/settings");
  });
}

export async function archiveCategory(categoryId: number) {
  return requireSession(async () => {
    await archiveCategoryQuery(categoryId);
    revalidatePath("/grid");
    revalidatePath("/reports");
    revalidatePath("/settings");
  });
}

/** Moves a category to a new parent (or null for top-level) starting this
 * calendar year - see moveCategoryParent for the year-scoping and leaf-only
 * validation this wraps. */
export async function moveCategory(categoryId: number, newParentId: number | null) {
  return requireSession(async () => {
    await moveCategoryParentQuery(categoryId, newParentId);
    revalidatePath("/grid");
    revalidatePath("/reports");
    revalidatePath("/settings");
  });
}

/** Marks one income source as the pay anchor (or clears it, with null) -
 * see setPayAnchorSource for why only one source can hold this at a time. */
export async function setPayAnchor(incomeSourceId: number | null) {
  return requireSession(async () => {
    await setPayAnchorSource(incomeSourceId);
    revalidatePath("/grid");
    revalidatePath("/settings");
  });
}

export async function archiveIncomeSource(id: number) {
  return requireSession(async () => {
    await archiveIncomeSourceQuery(id);
    revalidatePath("/grid");
    revalidatePath("/settings");
  });
}

export async function unarchiveCategory(categoryId: number) {
  return requireSession(async () => {
    await unarchiveCategoryQuery(categoryId);
    revalidatePath("/grid");
    revalidatePath("/reports");
    revalidatePath("/settings");
  });
}

export async function unarchiveIncomeSource(id: number) {
  return requireSession(async () => {
    await unarchiveIncomeSourceQuery(id);
    revalidatePath("/grid");
    revalidatePath("/settings");
  });
}


/** The colour of an income source's row in the Grid (null = automatic). */
export async function setIncomeColor(incomeSourceId: number, color: string | null): Promise<ActionResult> {
  return requireSession(() =>
    toResult(async () => {
      await setIncomeSourceColor(incomeSourceId, color);
      revalidatePath("/grid");
      revalidatePath("/settings");
    })
  );
}

// ---- tags on existing expenses (debt repayment / savings) ----

function refreshTagged() {
  for (const path of ["/grid", "/settings", "/debt", "/savings", "/entries", "/reports", "/household"]) revalidatePath(path);
}

/** The existing expenses in a category that linking it to this person / bucket
 * would add the tag to - shown as a list to tick before anything changes. */
export async function previewCategoryTags(
  categoryId: number,
  tags: { debtPersonId?: number; savingsBucketId?: number }
): Promise<{ ok: true; rows: MissingTagRow[]; total: number } | { ok: false; error: string }> {
  return requireSession(async () => {
    try {
      return { ok: true, ...(await listMissingTags(categoryId, tags)) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't look that up." };
    }
  });
}

/** Links a category to a person or bucket and tags the ticked existing expenses. */
export async function linkCategoryTagging(
  categoryId: number,
  link: { debtPersonId?: number; savingsBucketId?: number },
  expenseEntryIds: number[]
): Promise<{ ok: true; tagged: number; skipped: { id: number; reason: string }[] } | { ok: false; error: string }> {
  return requireSession(async () => {
    try {
      const ids = Array.isArray(expenseEntryIds) ? expenseEntryIds.filter((n) => Number.isInteger(n)) : [];
      const result = await linkCategoryAndTag(categoryId, link, ids);
      refreshTagged();
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't link that." };
    }
  });
}

/** Sets (or clears, with null) what ONE expense counts towards. */
export async function setEntryTags(expenseEntryId: number, changes: { debtPersonId?: number | null; savingsBucketId?: number | null }): Promise<ActionResult> {
  return requireSession(() =>
    toResult(async () => {
      await setExpenseTags(expenseEntryId, changes);
      refreshTagged();
    })
  );
}

/** The people and buckets an entry can be tagged with. */
export async function getEntryTagOptions() {
  return requireSession(() => getTagOptions());
}

// ---- household sharing (lib/db/household-tags.ts) ----

/** Whether to even show a "share to household" control anywhere - an
 * admin-only instance-wide switch (Settings > Admin), not per-user like
 * the Debts/Net worth nav toggles. */
export async function getHouseholdEnabledFlag(): Promise<boolean> {
  return requireSession(() => isHouseholdEnabled());
}

/** The existing expenses in a category that sharing it would add, shown as
 * a list to tick before anything changes - same shape as previewCategoryTags. */
export async function previewHouseholdShare(categoryId: number): Promise<{ ok: true; rows: HouseholdShareRow[]; total: number } | { ok: false; error: string }> {
  return requireSession(async () => {
    try {
      return { ok: true, ...(await listUnshared(categoryId)) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't look that up." };
    }
  });
}

/** Shares (or unshares) a category and, when sharing, the ticked existing
 * expenses - then reconciles so the Household tab reflects it right away
 * rather than waiting for the next background tick. */
export async function linkCategoryToHouseholdAction(
  categoryId: number,
  share: boolean,
  expenseEntryIds: number[]
): Promise<{ ok: true; shared: number } | { ok: false; error: string }> {
  return requireSession(async (user) => {
    try {
      const ids = Array.isArray(expenseEntryIds) ? expenseEntryIds.filter((n) => Number.isInteger(n)) : [];
      const result = await linkCategoryToHousehold(categoryId, share, ids);
      await reconcileHouseholdDataForUser(user.id);
      refreshTagged();
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't share that." };
    }
  });
}

/** The per-entry override. */
export async function setEntryHouseholdShare(expenseEntryId: number, share: boolean): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      await setExpenseHouseholdShare(expenseEntryId, share);
      await reconcileHouseholdDataForUser(user.id);
      refreshTagged();
    })
  );
}

/** Whole-source income sharing - see lib/db/household-tags.ts for why
 * there's no per-entry equivalent on the income side. */
export async function shareIncomeSourceAction(incomeSourceId: number, share: boolean): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      await shareIncomeSource(incomeSourceId, share);
      await reconcileHouseholdDataForUser(user.id);
      // Not refreshTagged() - this is an income path, not an expense tag.
      revalidatePath("/grid");
      revalidatePath("/settings");
      revalidatePath("/household");
    })
  );
}
