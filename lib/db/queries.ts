import { and, eq, sql } from "drizzle-orm";
import { db } from "./index";
import {
  categories,
  categoryEntries,
  expenseEntries,
  incomeEntries,
  incomeSources,
  reportPanels,
} from "./schema";

export type MonthCell = {
  amountPence: number | undefined;
  paid: boolean;
  spentPence: number;
  /** true when this cell's value is a computed sum of child categories,
   * rather than its own direct entry - read-only in the grid. */
  computed: boolean;
  /** When this cell is blank, the previous month's amount (crossing a year
   * boundary for January) - lets the UI offer a one-click "use last month's
   * value" instead of forcing a fresh number every month. */
  previousAmountPence?: number;
  /** True once today's date has passed the category's due day for this
   * month and it's still unpaid. Never true for a blank cell (nothing's
   * actually due if nothing was planned) or once paid. */
  overdue: boolean;
};

export type GridCategory = {
  id: number;
  name: string;
  groupName: string | null;
  isAnnual: boolean;
  annualMonth: number | null;
  dueDay: number | null;
  months: Record<number, MonthCell>;
  yearTotalPence: number;
  monthlyAveragePence: number;
  children: GridCategory[];
};

export type IncomeSourceRow = {
  id: number;
  name: string;
  months: Record<number, MonthCell>;
  yearTotalPence: number;
  monthlyAveragePence: number;
};

export type GridData = {
  year: number;
  categories: GridCategory[];
  incomeSources: IncomeSourceRow[];
  subtotalByMonth: number[]; // index 0 = January
  wagesByMonth: number[];
  availableByMonth: number[];
  remainingByMonth: number[];
  yearTotal: {
    subtotal: number;
    wages: number;
    available: number;
  };
};

type RawCategory = typeof categories.$inferSelect;
type RawEntry = typeof categoryEntries.$inferSelect;
type RawExpense = typeof expenseEntries.$inferSelect;

/** Builds a leaf category's own months map straight from its direct entries
 * + logged expenses - no rollup logic, used for both real leaf categories
 * and as the "direct" half of a parent's per-month fallback. */
function buildDirectMonths(
  categoryId: number,
  entries: RawEntry[],
  expenses: RawExpense[]
): Record<number, MonthCell> {
  const months: Record<number, MonthCell> = {};

  for (const entry of entries.filter((e) => e.categoryId === categoryId)) {
    months[entry.month] = {
      amountPence: entry.amountPence,
      paid: entry.paid,
      spentPence: 0,
      computed: false,
      overdue: false,
    };
  }

  for (const expense of expenses.filter((e) => e.categoryId === categoryId)) {
    const existing = months[expense.month];
    if (existing) {
      existing.spentPence += expense.amountPence;
    } else {
      months[expense.month] = {
        amountPence: undefined,
        paid: false,
        spentPence: expense.amountPence,
        computed: false,
        overdue: false,
      };
    }
  }

  return months;
}

/** Flags each unpaid, planned cell as overdue once today's date has passed
 * the category's due day for that cell's month - run after a category's
 * months map is otherwise complete. A blank cell (nothing planned) or a
 * paid one is never overdue. */
function applyOverdueFlags(
  months: Record<number, MonthCell>,
  dueDay: number | null,
  year: number,
  today: Date
) {
  if (dueDay == null) return;
  for (let month = 1; month <= 12; month++) {
    const cell = months[month];
    if (!cell || cell.paid || cell.amountPence === undefined) continue;
    // A day that doesn't exist in this month (31st in February, 30-day
    // months, etc.) clamps to the real last day instead of letting JS's
    // Date silently overflow into the next month - new Date(year, m, 31)
    // for February would otherwise resolve to March 3rd, pushing the
    // overdue flag days later than it should trigger.
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const dueDate = new Date(year, month - 1, Math.min(dueDay, lastDayOfMonth));
    cell.overdue = dueDate < today;
  }
}

/** For every blank month, attach a hint of what the previous month's amount
 * was (December of the prior year, for January) so the UI can offer a
 * one-click "use last month's value" - never auto-filled, always a choice. */
function attachPreviousMonthHints(
  months: Record<number, MonthCell>,
  previousDecemberAmountPence: number | undefined
) {
  for (let month = 1; month <= 12; month++) {
    if (months[month]?.amountPence !== undefined) continue;
    const previousAmount =
      month === 1 ? previousDecemberAmountPence : months[month - 1]?.amountPence;
    if (previousAmount === undefined) continue;
    months[month] = {
      amountPence: undefined,
      paid: false,
      spentPence: months[month]?.spentPence ?? 0,
      computed: false,
      overdue: false,
      previousAmountPence: previousAmount,
    };
  }
}

/** The real amount a cell counts as, for SUBTOTAL/AVAILABLE/Remaining: what
 * was actually spent if anything's been logged against it, otherwise the
 * plan. Deliberately not keyed on `paid` - a cell can be marked paid with
 * no expense ever logged against it (older data, or paid via a path that
 * doesn't log one), and treating "paid" as "we know the real number"
 * silently zeroed out the plan for every cell like that. */
function effectiveAmountPence(cell: MonthCell): number {
  return cell.spentPence > 0 ? cell.spentPence : (cell.amountPence ?? 0);
}

function summarize(months: Record<number, MonthCell>) {
  let yearTotalPence = 0;
  let monthsWithData = 0;
  for (let month = 1; month <= 12; month++) {
    const amount = months[month]?.amountPence;
    if (amount !== undefined) {
      yearTotalPence += amount;
      monthsWithData += 1;
    }
  }
  return {
    yearTotalPence,
    monthlyAveragePence:
      monthsWithData > 0 ? Math.round(yearTotalPence / monthsWithData) : 0,
  };
}

export async function getGridData(year: number): Promise<GridData> {
  const cats = await db.query.categories.findMany({
    where: eq(categories.archived, false),
    orderBy: (c, { asc }) => [asc(c.sortOrder)],
  });

  const entries = await db
    .select()
    .from(categoryEntries)
    .where(eq(categoryEntries.year, year));

  const expenses = await db
    .select()
    .from(expenseEntries)
    .where(eq(expenseEntries.year, year));

  const income = await db
    .select()
    .from(incomeEntries)
    .where(eq(incomeEntries.year, year));

  const sources = await db.query.incomeSources.findMany({
    where: eq(incomeSources.archived, false),
    orderBy: (s, { asc }) => [asc(s.sortOrder)],
  });

  // Previous December's data (for January's "use last month" hint), which
  // may live in the prior year's rows.
  const prevDecCategoryEntries = await db
    .select()
    .from(categoryEntries)
    .where(and(eq(categoryEntries.year, year - 1), eq(categoryEntries.month, 12)));
  const prevDecIncomeEntries = await db
    .select()
    .from(incomeEntries)
    .where(and(eq(incomeEntries.year, year - 1), eq(incomeEntries.month, 12)));

  const prevDecByCategory = new Map(
    prevDecCategoryEntries.map((e) => [e.categoryId, e.amountPence])
  );
  const prevDecByIncomeSource = new Map(
    prevDecIncomeEntries.map((e) => [e.incomeSourceId, e.amountPence])
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const subtotalByMonth = Array(12).fill(0);
  const remainingByMonth = Array(12).fill(0);
  const wagesByMonth = Array(12).fill(0);

  for (const entry of income) {
    wagesByMonth[entry.month - 1] += entry.amountPence;
  }

  const topLevel = cats.filter((c) => c.parentId === null);
  const childrenByParent = new Map<number, RawCategory[]>();
  for (const c of cats) {
    if (c.parentId === null) continue;
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }

  const gridCategories: GridCategory[] = topLevel.map((category) => {
    const childCats = childrenByParent.get(category.id) ?? [];
    const children: GridCategory[] = childCats.map((child) => {
      const childMonths = buildDirectMonths(child.id, entries, expenses);
      attachPreviousMonthHints(childMonths, prevDecByCategory.get(child.id));
      applyOverdueFlags(childMonths, child.dueDay, year, today);
      return {
        id: child.id,
        name: child.name,
        groupName: child.groupName,
        isAnnual: child.isAnnual,
        annualMonth: child.annualMonth,
        dueDay: child.dueDay,
        months: childMonths,
        children: [],
        ...summarize(childMonths),
      };
    });

    const directMonths = buildDirectMonths(category.id, entries, expenses);
    attachPreviousMonthHints(directMonths, prevDecByCategory.get(category.id));
    applyOverdueFlags(directMonths, category.dueDay, year, today);
    const months: Record<number, MonthCell> = {};

    // Annual children (e.g. a once-a-year subscription) are expected to be
    // empty most months - they shouldn't gate whether the *regular* children
    // add up to a full month. Require every regular (non-annual) child to
    // have an entry before trusting the sum; a single stray entry on one
    // child (logged early, or before the rest are known) must not silently
    // replace an accurate historical total with a partial one.
    const regularChildCats = childCats.filter((c) => !c.isAnnual);

    for (let month = 1; month <= 12; month++) {
      const regularChildCellsThisMonth = regularChildCats
        .map((c) => children.find((gc) => gc.id === c.id)!.months[month])
        .filter((cell): cell is MonthCell => cell?.amountPence !== undefined);

      const allRegularChildrenPresent =
        regularChildCats.length > 0 &&
        regularChildCellsThisMonth.length === regularChildCats.length;

      if (allRegularChildrenPresent) {
        const allChildCellsThisMonth = children
          .map((c) => c.months[month])
          .filter((cell): cell is MonthCell => cell?.amountPence !== undefined);
        const amountPence = allChildCellsThisMonth.reduce(
          (sum, c) => sum + (c.amountPence ?? 0),
          0
        );
        const spentPence = allChildCellsThisMonth.reduce(
          (sum, c) => sum + c.spentPence,
          0
        );
        const paid = allChildCellsThisMonth.every((c) => c.paid);
        const overdue = allChildCellsThisMonth.some((c) => c.overdue);
        months[month] = { amountPence, paid, spentPence, computed: true, overdue };
      } else if (directMonths[month]) {
        months[month] = directMonths[month];
      }
    }

    for (let month = 1; month <= 12; month++) {
      const cell = months[month];
      if (!cell) continue;
      const effectivePence = effectiveAmountPence(cell);
      subtotalByMonth[month - 1] += effectivePence;
      if (!cell.paid) remainingByMonth[month - 1] += effectivePence;
    }

    return {
      id: category.id,
      name: category.name,
      groupName: category.groupName,
      isAnnual: category.isAnnual,
      annualMonth: category.annualMonth,
      dueDay: category.dueDay,
      months,
      children,
      ...summarize(months),
    };
  });

  const incomeSourceRows: IncomeSourceRow[] = sources.map((source) => {
    const months: Record<number, MonthCell> = {};
    for (const entry of income.filter((e) => e.incomeSourceId === source.id)) {
      months[entry.month] = {
        amountPence: entry.amountPence,
        paid: true,
        spentPence: 0,
        computed: false,
        overdue: false,
      };
    }
    attachPreviousMonthHints(months, prevDecByIncomeSource.get(source.id));
    return {
      id: source.id,
      name: source.name,
      months,
      ...summarize(months),
    };
  });

  const availableByMonth = subtotalByMonth.map(
    (subtotal, i) => wagesByMonth[i] - subtotal
  );

  return {
    year,
    categories: gridCategories,
    incomeSources: incomeSourceRows,
    subtotalByMonth,
    wagesByMonth,
    availableByMonth,
    remainingByMonth,
    yearTotal: {
      subtotal: subtotalByMonth.reduce((a, b) => a + b, 0),
      wages: wagesByMonth.reduce((a, b) => a + b, 0),
      available: availableByMonth.reduce((a, b) => a + b, 0),
    },
  };
}

export async function getAvailableYears(): Promise<number[]> {
  const currentYear = new Date().getFullYear();
  const rows = await db
    .select({ year: categoryEntries.year })
    .from(categoryEntries)
    .groupBy(categoryEntries.year);
  const years = new Set(rows.map((r) => r.year));
  years.add(currentYear);
  years.add(currentYear + 1);
  return Array.from(years).sort((a, b) => a - b);
}

export type CategoryTreeNode = {
  id: number;
  name: string;
  groupName: string | null;
  isAnnual: boolean;
  annualMonth: number | null;
  dueDay: number | null;
  children: CategoryTreeNode[];
};

/** Lightweight structural view of categories (no months/amounts) for the
 * Settings page - just the tree shape, for rename/regroup/archive. */
export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  const cats = await db.query.categories.findMany({
    where: eq(categories.archived, false),
    orderBy: (c, { asc }) => [asc(c.sortOrder)],
  });
  const childrenByParent = new Map<number, typeof cats>();
  for (const c of cats) {
    if (c.parentId === null) continue;
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }
  return cats
    .filter((c) => c.parentId === null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      groupName: c.groupName,
      isAnnual: c.isAnnual,
      annualMonth: c.annualMonth,
      dueDay: c.dueDay,
      children: (childrenByParent.get(c.id) ?? []).map((child) => ({
        id: child.id,
        name: child.name,
        groupName: child.groupName,
        isAnnual: child.isAnnual,
        annualMonth: child.annualMonth,
        dueDay: child.dueDay,
        children: [],
      })),
    }));
}

export async function updateCategoryDueDay(categoryId: number, dueDay: number | null) {
  await db.update(categories).set({ dueDay }).where(eq(categories.id, categoryId));
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
  const existing = await db.query.categoryEntries.findFirst({
    where: categoryEntryMatch(input.categoryId, input.year, input.month),
  });

  if (existing) {
    await db
      .update(categoryEntries)
      .set({ amountPence: input.amountPence })
      .where(eq(categoryEntries.id, existing.id));
  } else {
    await db.insert(categoryEntries).values({ ...input, paid: false });
  }
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

export async function logExpense(input: {
  categoryId: number;
  amountPence: number;
  entryDate: string; // ISO date, e.g. "2026-09-26"
  note?: string;
  /** Set when this expense is also a debt repayment - purely for
   * traceability; the actual ledger effect is a separate row. */
  debtPersonId?: number;
}) {
  const [year, month] = input.entryDate.split("-").map(Number);
  await db.insert(expenseEntries).values({
    categoryId: input.categoryId,
    year,
    month,
    amountPence: input.amountPence,
    entryDate: input.entryDate,
    note: input.note || null,
    debtPersonId: input.debtPersonId,
  });
}

export async function upsertIncomeEntry(input: {
  incomeSourceId: number;
  year: number;
  month: number;
  amountPence: number;
}) {
  const existing = await db.query.incomeEntries.findFirst({
    where: incomeEntryMatch(input.incomeSourceId, input.year, input.month),
  });

  if (existing) {
    await db
      .update(incomeEntries)
      .set({ amountPence: input.amountPence })
      .where(eq(incomeEntries.id, existing.id));
  } else {
    await db.insert(incomeEntries).values(input);
  }
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
  const existing = await db.query.incomeEntries.findFirst({
    where: incomeEntryMatch(input.incomeSourceId, input.year, input.month),
  });

  if (existing) {
    await db
      .update(incomeEntries)
      .set({ amountPence: existing.amountPence + input.amountPence })
      .where(eq(incomeEntries.id, existing.id));
  } else {
    await db.insert(incomeEntries).values(input);
  }
}

export async function deleteIncomeEntry(input: {
  incomeSourceId: number;
  year: number;
  month: number;
}) {
  await db.delete(incomeEntries).where(incomeEntryMatch(input.incomeSourceId, input.year, input.month));
}

export async function addCategory(input: {
  name: string;
  parentId: number | null;
  groupName: string | null;
  isAnnual: boolean;
  annualMonth: number | null;
}) {
  const [maxRow] = await db
    .select({ max: sql<number>`max(${categories.sortOrder})` })
    .from(categories);
  const [created] = await db
    .insert(categories)
    .values({
      name: input.name,
      parentId: input.parentId,
      groupName: input.parentId === null ? input.groupName : null,
      isAnnual: input.isAnnual,
      annualMonth: input.isAnnual ? input.annualMonth : null,
      sortOrder: (maxRow?.max ?? -1) + 1,
    })
    .returning();
  return created;
}

export async function addIncomeSource(name: string) {
  const [maxRow] = await db
    .select({ max: sql<number>`max(${incomeSources.sortOrder})` })
    .from(incomeSources);
  const [created] = await db
    .insert(incomeSources)
    .values({ name, sortOrder: (maxRow?.max ?? -1) + 1 })
    .returning();
  return created;
}

export async function archiveIncomeSource(id: number) {
  await db.update(incomeSources).set({ archived: true }).where(eq(incomeSources.id, id));
}

export async function unarchiveIncomeSource(id: number) {
  await db.update(incomeSources).set({ archived: false }).where(eq(incomeSources.id, id));
}

export async function getArchivedIncomeSources() {
  return db.query.incomeSources.findMany({
    where: eq(incomeSources.archived, true),
    orderBy: (s, { asc }) => [asc(s.name)],
  });
}

/** Soft-delete - archived categories (and their entries/history) are never
 * actually removed, just hidden from the grid. Archiving a parent cascades
 * to its children: a child left behind under an archived, invisible parent
 * would still exist in the DB but be unreachable from any screen. */
export async function archiveCategory(id: number) {
  await db.update(categories).set({ archived: true }).where(eq(categories.id, id));
  await db.update(categories).set({ archived: true }).where(eq(categories.parentId, id));
}

export async function unarchiveCategory(id: number) {
  await db.update(categories).set({ archived: false }).where(eq(categories.id, id));
  await db.update(categories).set({ archived: false }).where(eq(categories.parentId, id));
}

export async function getArchivedCategories() {
  return db.query.categories.findMany({
    where: eq(categories.archived, true),
    orderBy: (c, { asc }) => [asc(c.name)],
  });
}

/** Lightweight active income source list (no months/amounts) for Settings. */
export async function getIncomeSourceList(): Promise<{ id: number; name: string }[]> {
  return db.query.incomeSources.findMany({
    where: eq(incomeSources.archived, false),
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
  const [maxRow] = await db
    .select({ max: sql<number>`max(${reportPanels.sortOrder})` })
    .from(reportPanels);
  const [created] = await db
    .insert(reportPanels)
    .values({
      name,
      selection: JSON.stringify(selection),
      sortOrder: (maxRow?.max ?? -1) + 1,
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
