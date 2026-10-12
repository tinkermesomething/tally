import { and, desc, eq, sql } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db, inTransaction } from "./index";
import { assertIsoDate } from "../validate";
import { markCellPaid, unpayCellIfNoExpenses } from "./cells";
import { resolvePeriodForDate } from "./pay-period";
import { addDebtEntry, deleteDebtEntriesForExpense } from "./debt";
import { addSavingsEntry, deleteSavingsEntriesForExpense, syncSavingsEntriesForExpense } from "./savings";
import { advanceBillsForExpense } from "./bills";
import {
  categories,
  categoryEntries,
  expenseEntries,
  incomeEntries,
  incomeSources,
  reportPanels,
} from "./schema";

// The grid rollup and the category tree live in their own files; re-exported so
// every existing `@/lib/db/queries` import keeps working.
export * from "./grid";
export * from "./category-tree";


export async function updateCategoryDueDay(categoryId: number, dueDay: number | null) {
  await db.update(categories).set({ dueDay }).where(eq(categories.id, categoryId));
}

export async function updateCategoryDebtLink(categoryId: number, linkedDebtPersonId: number | null) {
  await db.update(categories).set({ linkedDebtPersonId }).where(eq(categories.id, categoryId));
}

function categoryEntryMatch(categoryId: number, year: number, month: number) {
  return and(
    eq(categoryEntries.categoryId, categoryId),
    eq(categoryEntries.year, year),
    eq(categoryEntries.month, month)
  );
}

function incomeEntryMatch(incomeSourceId: number, year: number, month: number) {
  return and(
    eq(incomeEntries.incomeSourceId, incomeSourceId),
    eq(incomeEntries.year, year),
    eq(incomeEntries.month, month)
  );
}

export async function upsertCategoryEntry(input: {
  categoryId: number;
  year: number;
  month: number;
  amountPence: number;
}) {
  // One atomic statement against the unique (category, year, month) index.
  // A replaced amount leaves the cell's paid flag alone.
  await db
    .insert(categoryEntries)
    .values({ ...input, paid: false })
    .onConflictDoUpdate({
      target: [categoryEntries.categoryId, categoryEntries.year, categoryEntries.month],
      set: { amountPence: input.amountPence },
    });
}

/** Clearing a cell back to blank is a real, distinct state from "0" - it
 * means "nothing planned here", not "planned nothing". Deletes the row
 * outright rather than storing a 0, so the cell reverts to the same blank
 * state (and same "use last month" hint) it'd have if no one had ever
 * entered anything. Logged expenses (spentPence) are a separate table and
 * untouched - clearing the plan doesn't erase real transaction history. */
export async function deleteCategoryEntry(input: {
  categoryId: number;
  year: number;
  month: number;
}) {
  await db.delete(categoryEntries).where(categoryEntryMatch(input.categoryId, input.year, input.month));
}

export async function setCategoryEntryPaid(input: {
  categoryId: number;
  year: number;
  month: number;
  paid: boolean;
}) {
  await db
    .update(categoryEntries)
    .set({ paid: input.paid })
    .where(categoryEntryMatch(input.categoryId, input.year, input.month));
}

export async function renameCategory(categoryId: number, name: string) {
  await db.update(categories).set({ name }).where(eq(categories.id, categoryId));
}

export async function updateCategoryGroup(categoryId: number, groupName: string | null) {
  await db
    .update(categories)
    .set({ groupName })
    .where(eq(categories.id, categoryId));
}

export function logExpense(input: Parameters<typeof logExpenseUnsafe>[0]) {
  return inTransaction(() => logExpenseUnsafe(input));
}

async function logExpenseUnsafe(input: {
  categoryId: number;
  amountPence: number;
  entryDate: string; // ISO date, e.g. "2026-09-26"
  note?: string;
  /** Set when this expense is also a debt repayment. Explicit value always
   * wins; omit (not null) to fall back to the category's own
   * linkedDebtPersonId, if it has one. Pass null to force "no debt tag" even
   * if the category has a link. */
  debtPersonId?: number | null;
  /** Which savings bucket this expense also pays into. Same rule as
   * debtPersonId: omit to use the category's own link, null for none. */
  bucketId?: number | null;
  /** Set when this expense was created by categorizing a staged bank-sync
   * row, rather than typed in directly - purely for traceability back to
   * its source (lib/db/bank-sync.ts). */
  importedTransactionId?: number;
  /** Pencilled in from a pending-at-the-bank preview, not yet confirmed
   * against the real settled transaction - see pencilInExpense. */
  provisional?: boolean;
}) {
  assertIsoDate(input.entryDate);
  const { year, month } = await resolvePeriodForDate(input.entryDate);

  const category = await db.query.categories.findFirst({ where: eq(categories.id, input.categoryId) });
  const debtPersonId: number | undefined =
    input.debtPersonId !== undefined ? (input.debtPersonId ?? undefined) : (category?.linkedDebtPersonId ?? undefined);
  const bucketId: number | undefined =
    input.bucketId !== undefined ? (input.bucketId ?? undefined) : (category?.linkedBucketId ?? undefined);

  const [created] = await db
    .insert(expenseEntries)
    .values({
      categoryId: input.categoryId,
      year,
      month,
      amountPence: input.amountPence,
      entryDate: input.entryDate,
      note: input.note || null,
      debtPersonId,
      importedTransactionId: input.importedTransactionId,
      provisional: input.provisional ?? false,
    })
    .returning();

  // Tagging an expense as a debt repayment must actually move the ledger,
  // not just label the expense for traceability - that was the bug: ticking
  // the box looked like it worked but never touched debt_ledger_entries.
  if (debtPersonId) {
    await addDebtEntry({
      personId: debtPersonId,
      entryDate: input.entryDate,
      amountPence: input.amountPence,
      direction: "repayment",
      note: input.note,
      expenseEntryId: created.id,
    });
  }

  // A category linked to a savings bucket pays into it automatically.
  if (bucketId) {
    await addSavingsEntry({
      bucketId,
      entryDate: input.entryDate,
      amountPence: input.amountPence,
      direction: "deposit",
      note: input.note,
      expenseEntryId: created.id,
    });
  }

  // Otherwise a logged expense correctly counts toward SUBTOTAL/AVAILABLE but
  // still shows up in "Remaining to pay" as if it hadn't happened yet. A
  // provisional entry gets the same treatment - that's the point of
  // pencilling it in: reflect money the bank's already earmarked.
  await markCellPaid(input.categoryId, year, month);

  // Unlike the debt/savings auto-tags above, a bill's due date only moves
  // once the expense is CONFIRMED (see confirmPencilledExpense, which
  // calls this same advance) - discarding a pencilled-in guess has no
  // "unadvance" to undo it with, so advancing early would be a one-way
  // mistake a wrong guess can't take back.
  if (!input.provisional) await advanceBillsForExpense(input.categoryId, input.entryDate);

  return created;
}

export type ExpenseEntryRow = {
  id: number;
  categoryId: number;
  categoryName: string;
  year: number;
  month: number;
  amountPence: number;
  note: string | null;
  entryDate: string;
  provisional: boolean;
  /** What this expense counts towards (see lib/db/retro-tags.ts). */
  debtPersonId: number | null;
  debtPersonName: string | null;
  savingsBucketId: number | null;
  savingsBucketName: string | null;
};

const expenseRowColumns = {
  id: expenseEntries.id,
  categoryId: expenseEntries.categoryId,
  categoryName: categories.name,
  year: expenseEntries.year,
  month: expenseEntries.month,
  amountPence: expenseEntries.amountPence,
  note: expenseEntries.note,
  entryDate: expenseEntries.entryDate,
  provisional: expenseEntries.provisional,
  debtPersonId: expenseEntries.debtPersonId,
  debtPersonName: sql<string | null>`(select p.name from people p where p.id = ${expenseEntries.debtPersonId})`,
  savingsBucketId: sql<number | null>`(select s.bucket_id from savings_entries s where s.expense_entry_id = ${expenseEntries.id} order by s.id limit 1)`,
  savingsBucketName: sql<string | null>`(select b.name from savings_entries s join savings_buckets b on b.id = s.bucket_id where s.expense_entry_id = ${expenseEntries.id} order by s.id limit 1)`,
};

/** Individual logged expenses for one category/month - the breakdown behind
 * a grid cell's "Paid £X" total, which is just their sum. */
export async function getExpenseEntriesForCell(
  categoryId: number,
  year: number,
  month: number
): Promise<ExpenseEntryRow[]> {
  const rows = await db
    .select(expenseRowColumns)
    .from(expenseEntries)
    .innerJoin(categories, eq(expenseEntries.categoryId, categories.id))
    .where(
      and(
        eq(expenseEntries.categoryId, categoryId),
        eq(expenseEntries.year, year),
        eq(expenseEntries.month, month)
      )
    )
    .orderBy(expenseEntries.entryDate);
  return rows;
}

/** All logged expenses for a year, optionally narrowed to one month - the
 * data behind the "Logged entries" ledger page. `month` undefined means the
 * full year. */
export async function getExpenseEntriesForMonth(
  year: number,
  month?: number
): Promise<ExpenseEntryRow[]> {
  const rows = await db
    .select(expenseRowColumns)
    .from(expenseEntries)
    .innerJoin(categories, eq(expenseEntries.categoryId, categories.id))
    .where(
      month === undefined
        ? eq(expenseEntries.year, year)
        : and(eq(expenseEntries.year, year), eq(expenseEntries.month, month))
    )
    .orderBy(desc(expenseEntries.entryDate));
  return rows;
}

export async function updateExpenseEntry(
  id: number,
  input: { amountPence?: number; note?: string | null; entryDate?: string }
) {
  const set: Partial<typeof expenseEntries.$inferInsert> = {};
  if (input.amountPence !== undefined) set.amountPence = input.amountPence;
  if (input.note !== undefined) set.note = input.note;
  if (input.entryDate !== undefined) {
    assertIsoDate(input.entryDate);
    set.entryDate = input.entryDate;
    const { year, month } = await resolvePeriodForDate(input.entryDate);
    set.year = year;
    set.month = month;
  }
  await db.update(expenseEntries).set(set).where(eq(expenseEntries.id, id));
  // The deposit this expense made (if any) follows its amount and date.
  await syncSavingsEntriesForExpense(id, { amountPence: input.amountPence, entryDate: input.entryDate });
}

/** Real, permanent delete - unlike everything else in this app (categories,
 * income sources, people are all soft-deleted), a logged expense is a
 * transaction record: "I entered this wrong" should just remove it, there's
 * no future value in keeping a row around that never happened. Also cleans
 * up any debt-ledger entry this expense auto-created (see logExpense) -
 * otherwise deleting a debt-tagged expense leaves the ledger permanently
 * wrong, since debt_ledger_entries doesn't cascade. */
export function deleteExpenseEntry(id: number) {
  return inTransaction(() => deleteExpenseEntryUnsafe(id));
}

async function deleteExpenseEntryUnsafe(id: number) {
  const entry = await db.query.expenseEntries.findFirst({ where: eq(expenseEntries.id, id) });
  if (!entry) return;
  await deleteDebtEntriesForExpense(id);
  await deleteSavingsEntriesForExpense(id);
  await db.delete(expenseEntries).where(eq(expenseEntries.id, id));

  await unpayCellIfNoExpenses(entry.categoryId, entry.year, entry.month);
}

/** "Pencil in" a pending-at-the-bank transaction as a real expense ahead of
 * it settling - counts immediately (that's the point), flagged
 * `provisional` until the matching real transaction arrives and gets
 * confirmed or discarded (see confirmPencilledExpense/discardPencilledExpense
 * in lib/db/bank-sync.ts). Expense-only: incoming money needs no equivalent
 * - the user isn't a business, it just arrives. */
export async function pencilInExpense(input: {
  categoryId: number;
  amountPence: number;
  entryDate: string;
  note?: string;
  debtPersonId?: number;
  bucketId?: number;
}) {
  return logExpense({ ...input, provisional: true });
}

/** Undo for a pencilled-in expense that turned out wrong (amount never
 * settled, or settled differently and won't auto-match) - just
 * deleteExpenseEntry (which already cleans up any debt-ledger entry) with a
 * guard: refuses to touch a non-provisional entry, since this is for
 * discarding a guess, not deleting a confirmed one. */
export async function discardPencilledExpense(id: number) {
  const entry = await db.query.expenseEntries.findFirst({ where: eq(expenseEntries.id, id) });
  if (!entry) return;
  if (!entry.provisional) {
    throw new Error("Not a provisional entry - use the regular delete instead.");
  }
  await deleteExpenseEntry(id);
}

/** The real transaction settled matching what was pencilled in - makes the
 * draft permanent (just flips the flag; the debt-ledger entry, if any, was
 * already created correctly when it was pencilled in and needs no change)
 * and links it back to the real bank transaction for traceability. */
export async function confirmPencilledExpense(id: number, importedTransactionId: number) {
  const entry = await db.query.expenseEntries.findFirst({ where: eq(expenseEntries.id, id) });
  if (!entry) return;
  if (!entry.provisional) {
    throw new Error("Not a provisional entry.");
  }
  await db
    .update(expenseEntries)
    .set({ provisional: false, importedTransactionId })
    .where(eq(expenseEntries.id, id));
  await advanceBillsForExpense(entry.categoryId, entry.entryDate);
}

export async function upsertIncomeEntry(input: {
  incomeSourceId: number;
  year: number;
  month: number;
  amountPence: number;
}) {
  await db
    .insert(incomeEntries)
    .values(input)
    .onConflictDoUpdate({
      target: [incomeEntries.incomeSourceId, incomeEntries.year, incomeEntries.month],
      set: { amountPence: input.amountPence },
    });
}

/** Adds to whatever's already there for that source/month instead of
 * replacing it - a one-off event (e.g. a friend's loan landing the same
 * month as regular income already logged) shouldn't clobber the rest of
 * that month's figure. */
export async function incrementIncomeEntry(input: {
  incomeSourceId: number;
  year: number;
  month: number;
  amountPence: number;
}) {
  await db
    .insert(incomeEntries)
    .values(input)
    .onConflictDoUpdate({
      target: [incomeEntries.incomeSourceId, incomeEntries.year, incomeEntries.month],
      set: { amountPence: sql`${incomeEntries.amountPence} + ${input.amountPence}` },
    });
}

export async function deleteIncomeEntry(input: {
  incomeSourceId: number;
  year: number;
  month: number;
}) {
  await db.delete(incomeEntries).where(incomeEntryMatch(input.incomeSourceId, input.year, input.month));
}

/** Next free sortOrder for a table, used when appending a new row to the end
 * of a manually-orderable list (categories, income sources, report panels).
 * Table and column are passed separately, rather than typing this generic
 * over a union of table types, since each caller's own table/column are
 * already concretely typed at the call site. */
async function nextSortOrder(table: SQLiteTable, sortOrderColumn: AnySQLiteColumn): Promise<number> {
  const [maxRow] = await db.select({ max: sql<number>`max(${sortOrderColumn})` }).from(table);
  return (maxRow?.max ?? -1) + 1;
}

export async function addCategory(input: {
  name: string;
  parentId: number | null;
  groupName: string | null;
  isAnnual: boolean;
  annualMonth: number | null;
}) {
  const sortOrder = await nextSortOrder(categories, categories.sortOrder);
  const [created] = await db
    .insert(categories)
    .values({
      name: input.name,
      parentId: input.parentId,
      // groupName only means anything on a top-level category - a child's
      // group is inherited from its parent for the pie chart, so storing one
      // on the child too would just be a second, driftable source of truth.
      groupName: input.parentId === null ? input.groupName : null,
      isAnnual: input.isAnnual,
      annualMonth: input.isAnnual ? input.annualMonth : null,
      sortOrder,
    })
    .returning();
  return created;
}

export async function addIncomeSource(name: string) {
  const sortOrder = await nextSortOrder(incomeSources, incomeSources.sortOrder);
  const [created] = await db.insert(incomeSources).values({ name, sortOrder }).returning();
  return created;
}

export async function archiveIncomeSource(id: number) {
  await db.update(incomeSources).set({ archivedAt: new Date() }).where(eq(incomeSources.id, id));
}

export async function getIncomeSource(id: number) {
  return db.query.incomeSources.findFirst({ where: eq(incomeSources.id, id) });
}

export async function unarchiveIncomeSource(id: number) {
  await db.update(incomeSources).set({ archivedAt: null }).where(eq(incomeSources.id, id));
}

export async function getArchivedIncomeSources() {
  return db.query.incomeSources.findMany({
    where: (s, { isNotNull }) => isNotNull(s.archivedAt),
    orderBy: (s, { asc }) => [asc(s.name)],
  });
}

/** Soft-delete - archived categories (and their entries/history) are never
 * actually removed, just hidden from the grid. Archiving a parent cascades
 * to its children: a child left behind under an archived, invisible parent
 * would still exist in the DB but be unreachable from any screen. */
export async function archiveCategory(id: number) {
  const now = new Date();
  await inTransaction(async () => {
  await db.update(categories).set({ archivedAt: now }).where(eq(categories.id, id));
  // Cascades by original parentId, not effective (moved-to) parent - a
  // category moved under `id` via moveCategoryParent has its own, unrelated
  // parentId column and won't be swept up here. Rare in practice (you'd
  // have to move a child under a parent, then archive that exact parent),
  // and the child just becomes orphaned-but-visible under its original
  // parent for future years rather than silently vanishing, so it's a
  // known gap rather than a silent-data-loss risk.
  await db.update(categories).set({ archivedAt: now }).where(eq(categories.parentId, id));
  });
}

export async function unarchiveCategory(id: number) {
  await inTransaction(async () => {
    await db.update(categories).set({ archivedAt: null }).where(eq(categories.id, id));
    await db.update(categories).set({ archivedAt: null }).where(eq(categories.parentId, id));
  });
}

export async function getArchivedCategories() {
  return db.query.categories.findMany({
    where: (c, { isNotNull }) => isNotNull(c.archivedAt),
    orderBy: (c, { asc }) => [asc(c.name)],
  });
}

/** Lightweight active income source list (no months/amounts) for Settings. */
export async function getIncomeSourceList(): Promise<
  { id: number; name: string; isPayAnchor: boolean; color: string | null }[]
> {
  return db.query.incomeSources.findMany({
    where: (s, { isNull }) => isNull(s.archivedAt),
    orderBy: (s, { asc }) => [asc(s.sortOrder)],
  });
}

export type ReportPanelPick = { type: "group"; value: string } | { type: "category"; value: number };

export type ReportPanel = {
  id: number;
  name: string;
  selection: ReportPanelPick[];
  sortOrder: number;
};

export const MAX_REPORT_PANELS = 3;

export async function getReportPanels(): Promise<ReportPanel[]> {
  const rows = await db.query.reportPanels.findMany({
    orderBy: (p, { asc }) => [asc(p.sortOrder)],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    selection: JSON.parse(r.selection) as ReportPanelPick[],
    sortOrder: r.sortOrder,
  }));
}

export async function createReportPanel(name: string, selection: ReportPanelPick[]) {
  const existing = await db.select({ id: reportPanels.id }).from(reportPanels);
  if (existing.length >= MAX_REPORT_PANELS) {
    throw new Error(`You can only have ${MAX_REPORT_PANELS} custom report panels.`);
  }
  const sortOrder = await nextSortOrder(reportPanels, reportPanels.sortOrder);
  const [created] = await db
    .insert(reportPanels)
    .values({
      name,
      selection: JSON.stringify(selection),
      sortOrder,
    })
    .returning();
  return created;
}

export async function updateReportPanel(
  id: number,
  input: { name?: string; selection?: ReportPanelPick[] }
) {
  const set: { name?: string; selection?: string } = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.selection !== undefined) set.selection = JSON.stringify(input.selection);
  await db.update(reportPanels).set(set).where(eq(reportPanels.id, id));
}

export async function deleteReportPanel(id: number) {
  await db.delete(reportPanels).where(eq(reportPanels.id, id));
}


/** Sets (or, with null, clears back to the automatic palette colour) the colour
 * of an income source's row in the Grid. Only a plain "#rrggbb" is accepted:
 * the value ends up in CSS, so nothing else may get through. */
export async function setIncomeSourceColor(id: number, color: string | null) {
  const value = color === null || color === "" ? null : color.trim();
  if (value !== null && !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error("Colour must look like #1a2b3c.");
  const updated = await db.update(incomeSources).set({ color: value }).where(eq(incomeSources.id, id)).returning({ id: incomeSources.id });
  if (updated.length === 0) throw new Error("That income source no longer exists.");
}
