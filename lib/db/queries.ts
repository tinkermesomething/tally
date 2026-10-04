import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db, inTransaction } from "./index";
import { assertIsoDate } from "../validate";
import { markCellPaid, unpayCellIfNoExpenses } from "./cells";
import { resolvePeriodForDate } from "./pay-period";
import { getAppSettings } from "./settings";
import { addDebtEntry, deleteDebtEntriesForExpense } from "./debt";
import {
  categories,
  categoryEntries,
  categoryParentMoves,
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
  isPayAnchor: boolean;
  months: Record<number, MonthCell>;
  yearTotalPence: number;
  monthlyAveragePence: number;
};

export type GridData = {
  year: number;
  categories: GridCategory[];
  incomeSources: IncomeSourceRow[];
  /** Effective (spent-if-known, else planned) total per month - feeds only
   * the main expense table's own SUBTOTAL footer row, a per-category-column
   * total. Everything else (the top stat cards, the WAGES/AVAILABLE summary
   * bar) uses the planned/actuallySpent pair below instead - two distinct
   * numbers, not this blended one, since conflating them is what caused the
   * "why did my numbers change" confusion this was split out to fix. */
  subtotalByMonth: number[]; // index 0 = January
  /** What's budgeted/allocated for the month, full stop - never moves based
   * on what's actually been paid. */
  plannedByMonth: number[];
  wagesByMonth: number[];
  /** Income minus planned - "if I stick to the whole plan, this is left."
   * A stable, forward-looking projection. */
  availableByMonth: number[];
  /** Sum of only the paid/logged amounts - money that's actually gone. */
  actuallySpentByMonth: number[];
  /** What rolled into this month from the previous one's own leftToSpend -
   * compounds across the whole chain (see getYearEndLeftToSpend), never
   * clamped to zero, so an overspend carries forward as a negative amount
   * just as a surplus carries forward as a positive one. Surfaced
   * separately so the UI can show it, not just fold it silently into
   * leftToSpendByMonth below. */
  carryOverByMonth: number[];
  /** Income minus actuallySpent, PLUS whatever carried in from last month -
   * "how much of my wage is still free right now," a live number that
   * moves as you log/pay things through the month. */
  leftToSpendByMonth: number[];
  yearTotal: {
    subtotal: number;
    planned: number;
    wages: number;
    available: number;
    actuallySpent: number;
    leftToSpend: number;
  };
};

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

/** What counts toward actuallySpentByMonth: real logged spending always
 * counts - it happened, full stop, regardless of `paid` - and only falls
 * back to the planned amount, gated on `paid`, for the "ticked paid with
 * no expense ever logged" case. Deliberately NOT `cell.paid ?
 * effectiveAmountPence(cell) : 0` - on a rollup cell, `paid` is an
 * aggregate across children, and can be false even when the cell's own
 * spentPence is fully confirmed, just because some unrelated sibling's
 * separate planned amount hasn't come due yet this month. Gating real,
 * already-spent money behind an aggregate that a different child can drag
 * down is exactly the bug this exists to avoid. */
function confirmedSpentPence(cell: MonthCell): number {
  if (cell.spentPence > 0) return cell.spentPence;
  return cell.paid ? (cell.amountPence ?? 0) : 0;
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

export type ParentMove = { id: number; categoryId: number; parentId: number | null; effectiveYear: number };

/** For each category, resolves its effective parent for a given year: the
 * parentId of its most recent move with effectiveYear <= year, or its
 * original (creation-time) parentId if no qualifying move exists - the
 * same year-relative principle as archivedAt, generalized to handle a
 * category moving more than once. Pure function, no DB access, so it's
 * cheap to unit test against a plain list of moves. */
export function resolveEffectiveParents(
  cats: { id: number; parentId: number | null }[],
  moves: ParentMove[],
  year: number
): Map<number, number | null> {
  const movesByCategory = new Map<number, ParentMove[]>();
  for (const m of moves) {
    const list = movesByCategory.get(m.categoryId) ?? [];
    list.push(m);
    movesByCategory.set(m.categoryId, list);
  }
  const result = new Map<number, number | null>();
  for (const c of cats) {
    const qualifying = (movesByCategory.get(c.id) ?? [])
      .filter((m) => m.effectiveYear <= year)
      // Most recent effectiveYear wins; ties (more than one move within
      // the same year - the common case, since a move always takes effect
      // "this year") break on id, so the most recently made move wins
      // rather than whichever happened to come first in an untied sort.
      .sort((a, b) => b.effectiveYear - a.effectiveYear || b.id - a.id);
    result.set(c.id, qualifying.length > 0 ? qualifying[0].parentId : c.parentId);
  }
  return result;
}

/** The only correct way to read a resolveEffectiveParents() result. Plain
 * `effectiveParents.get(id) ?? category.parentId` is a real bug: `??`
 * can't tell "no entry for this id" apart from "entry is null" - and a
 * resolved effective parent of null (genuinely top-level) is one of the
 * most common, valid results this map produces. That pattern silently
 * discarded every "moved to top-level" resolution, falling back to the
 * category's stale original parentId instead. */
function effectiveParentOf(
  effectiveParents: Map<number, number | null>,
  category: { id: number; parentId: number | null }
): number | null {
  return effectiveParents.has(category.id) ? (effectiveParents.get(category.id) ?? null) : category.parentId;
}

/** parent id -> its children, using each category's EFFECTIVE parent for the
 * year being viewed (not necessarily its original parentId). */
function groupChildrenByParent<T extends { id: number; parentId: number | null }>(
  cats: T[],
  effectiveParents: Map<number, number | null>
): Map<number, T[]> {
  const byParent = new Map<number, T[]>();
  for (const c of cats) {
    const parentId = effectiveParentOf(effectiveParents, c);
    if (parentId === null) continue;
    const list = byParent.get(parentId) ?? [];
    list.push(c);
    byParent.set(parentId, list);
  }
  return byParent;
}

async function getEffectiveParentMap(year: number): Promise<Map<number, number | null>> {
  const cats = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
  const moves = await db.select().from(categoryParentMoves);
  return resolveEffectiveParents(cats, moves, year);
}

/** Moves a category to a new parent (or to top-level, if newParentId is
 * null) starting this calendar year - past years keep showing it under
 * its old grouping, so moving something today never rewrites what a past
 * year's rollup said. Only a genuine leaf category can move: this app's
 * rollup logic is strictly two levels deep, so a category currently acting
 * as someone else's parent can't also become a child, and a category can
 * only be nested under a genuine top-level category, never under another
 * child (which would make three levels). */
export async function moveCategoryParent(categoryId: number, newParentId: number | null) {
  if (newParentId === categoryId) {
    throw new Error("A category can't be its own parent.");
  }
  const category = await db.query.categories.findFirst({ where: eq(categories.id, categoryId) });
  if (!category) throw new Error("Category not found.");

  const currentYear = new Date().getFullYear();
  const effectiveParents = await getEffectiveParentMap(currentYear);

  const hasChildrenNow = Array.from(effectiveParents.values()).some((p) => p === categoryId);
  if (hasChildrenNow) {
    throw new Error("Can't move a category that currently has its own subcategories.");
  }

  if (newParentId !== null) {
    const newParent = await db.query.categories.findFirst({ where: eq(categories.id, newParentId) });
    if (!newParent) throw new Error("Target category not found.");
    const targetEffectiveParent = effectiveParentOf(effectiveParents, newParent);
    if (targetEffectiveParent !== null) {
      throw new Error("Can't nest under a subcategory - only top-level categories can have children.");
    }
  }

  await db.insert(categoryParentMoves).values({
    categoryId,
    parentId: newParentId,
    effectiveYear: currentYear,
  });
}

/** December's leftToSpend for `year`, as the carry-over seed for January of
 * `year + 1` - recurses backward through getGridData itself (which already
 * seeds ITS OWN January the same way), so the chain compounds correctly
 * across any number of years. The recursion is bounded by the caller: it
 * only ever gets invoked for a year at or after the configured carry-over
 * start point (see the `startIndex` check in getGridData), never
 * unconditionally walked back through all of history - a user's imported,
 * pre-tracking data (which this app never asked them to log with the same
 * precision as live use) must never silently feed a rollover chain they
 * didn't ask it to. */
async function getYearEndLeftToSpend(year: number): Promise<number> {
  const priorYear = await getGridData(year);
  return priorYear.leftToSpendByMonth[11];
}

export async function getGridData(year: number): Promise<GridData> {
  // A category archived sometime in year X disappears starting year X (this
  // is when you noticed it stopped applying) but stays visible/counted for
  // every year before that - archiving something today must never change
  // what a past year's SUBTOTAL/AVAILABLE said. So `year` is visible when
  // archivedAt is null, or falls in a *later* calendar year than `year`.
  const startOfNextYear = new Date(year + 1, 0, 1);
  const cats = await db.query.categories.findMany({
    where: or(isNull(categories.archivedAt), gte(categories.archivedAt, startOfNextYear)),
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

  // Same year-relative visibility as categories - see the comment on cats above.
  const sources = await db.query.incomeSources.findMany({
    where: or(isNull(incomeSources.archivedAt), gte(incomeSources.archivedAt, startOfNextYear)),
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

  // First tracked period (Settings > Preferences) - the same boundary the
  // Left to spend carry-over chain starts from, see below. Used to decide
  // whether a parent's own logged spending counts (see ownLoggedSpentPence).
  const { carryOverStartYear, carryOverStartMonth } = await getAppSettings();
  const startIndex = carryOverStartYear * 12 + carryOverStartMonth;

  const subtotalByMonth = Array(12).fill(0);
  const plannedByMonth = Array(12).fill(0);
  const actuallySpentByMonth = Array(12).fill(0);
  const wagesByMonth = Array(12).fill(0);

  for (const entry of income) {
    wagesByMonth[entry.month - 1] += entry.amountPence;
  }

  const parentMoves = await db.select().from(categoryParentMoves);
  const effectiveParents = resolveEffectiveParents(cats, parentMoves, year);

  const topLevel = cats.filter((c) => effectiveParentOf(effectiveParents, c) === null);
  const childrenByParent = groupChildrenByParent(cats, effectiveParents);

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
    const childById = new Map(children.map((c) => [c.id, c]));

    // Money logged straight against a PARENT category (e.g. a bank
    // transaction categorized to "personal expenses" itself rather than one
    // of its sub-categories) is real spending, and has to count even when
    // the parent's cell is a children-driven rollup - otherwise it silently
    // vanishes from actually-spent/left-to-spend (confirmed live: a real
    // 47.00). Counts only logged expenses (spentPence), never the
    // "ticked paid" fallback of a legacy lump-sum plan, and only from the
    // first tracked period onward: before that, parents still carry old
    // lump-sum "confirm payment" entries that overlap their sub-categories'
    // own spending, so history is left exactly as it was calculated.
    const ownLoggedSpentPence = (month: number): number =>
      year * 12 + month >= startIndex ? (directMonths[month]?.spentPence ?? 0) : 0;

    // Annual children (e.g. a once-a-year subscription) are expected to be
    // empty most months - they shouldn't gate whether the *regular* children
    // add up to a full month. Require every regular (non-annual) child to
    // have an entry before trusting the sum; a single stray entry on one
    // child (logged early, or before the rest are known) must not silently
    // replace an accurate historical total with a partial one.
    const regularChildCats = childCats.filter((c) => !c.isAnnual);

    for (let month = 1; month <= 12; month++) {
      const regularChildCellsThisMonth = regularChildCats
        .map((c) => childById.get(c.id)?.months[month])
        .filter((cell): cell is MonthCell => cell?.amountPence !== undefined);

      // Named for what it actually checks - every regular child has a
      // planned/spent entry this month, not merely that the child exists.
      const allRegularChildrenHaveEntries =
        regularChildCats.length > 0 &&
        regularChildCellsThisMonth.length === regularChildCats.length;

      // "Actually spent" is a live, partial, always-growing number (see the
      // GridData comment on actuallySpentByMonth) - unlike the planned
      // total, it must never be gated on every sibling having an entry.
      // Hiding real, already-logged spending because one untouched sibling
      // (e.g. a pay-as-you-go subscription nobody's topped up yet this
      // month) has nothing yet is actively misleading, not conservative -
      // it makes "Left to spend" overstate how much money is really still
      // free. Sum whatever's genuinely there, across every child
      // (annual or not), with no gate at all.
      const anyChildCellsThisMonth = children
        .map((c) => c.months[month])
        .filter((cell): cell is MonthCell => cell !== undefined);
      const spentPence =
        anyChildCellsThisMonth.reduce((sum, c) => sum + c.spentPence, 0) + ownLoggedSpentPence(month);

      if (allRegularChildrenHaveEntries) {
        const plannedCells = children
          .map((c) => c.months[month])
          .filter((cell): cell is MonthCell => cell?.amountPence !== undefined);
        const amountPence = plannedCells.reduce(
          (sum, c) => sum + (c.amountPence ?? 0),
          0
        );
        // A child with nothing actually charged or planned this month has
        // nothing to be "paid" about - it shouldn't be able to block the
        // whole parent just because nobody explicitly ticked it (e.g. a
        // pay-as-you-go subscription untouched this month). Only children
        // that actually carry money have to be confirmed paid.
        const paid = plannedCells.every(
          (c) => c.paid || effectiveAmountPence(c) === 0
        );
        const overdue = plannedCells.some((c) => c.overdue);
        months[month] = { amountPence, paid, spentPence, computed: true, overdue };
      } else if (anyChildCellsThisMonth.some((c) => c.spentPence > 0)) {
        // No COMPLETE plan for the month (not every child has an entry
        // yet), but don't throw away the real, PARTIAL planned total
        // either - same "sum whatever's genuinely there" principle
        // spentPence already uses above. This used to leave amountPence
        // fully undefined here, which silently zeroed the WHOLE category's
        // contribution out of plannedByMonth (BUDGETED) the moment even
        // one child (often a pay-as-you-go one that's simply unused some
        // months, e.g. "OTHER" or "O2 mobile") had no entry yet - even
        // when its siblings carried hundreds of pounds of real plan.
        // undefined only when genuinely NO child has a planned figure,
        // matching how an empty cell is already treated everywhere else.
        const plannedCells = anyChildCellsThisMonth.filter((c) => c.amountPence !== undefined);
        const amountPence =
          plannedCells.length > 0
            ? plannedCells.reduce((sum, c) => sum + (c.amountPence ?? 0), 0)
            : undefined;
        const paid = anyChildCellsThisMonth.every(
          (c) => c.paid || effectiveAmountPence(c) === 0
        );
        const overdue = anyChildCellsThisMonth.some((c) => c.overdue);
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
      plannedByMonth[month - 1] += cell.amountPence ?? 0;
    }

    // actuallySpentByMonth never trusts a rollup cell's own aggregate `paid`
    // flag - it can be false even when one specific child's own money is
    // fully confirmed spent, just because a different, unrelated sibling's
    // plan hasn't come due yet this month. `cell.computed` says which path
    // the display logic already took: a rollup (sum each child's own
    // confirmed spend individually, so no sibling can drag another's real
    // spending out) or a direct entry (a real leaf, or a parent's own
    // direct spending for a month its children's rollup didn't apply to -
    // e.g. general spending logged straight against a category that also
    // has one specific child broken out separately). Using the cell as-is
    // for the direct case, rather than always summing children, is what a
    // naive "has children -> sum children" rule gets wrong.
    for (let month = 1; month <= 12; month++) {
      const cell = months[month];
      if (!cell) continue;
      if (cell.computed) {
        for (const child of children) {
          const childCell = child.months[month];
          if (!childCell) continue;
          actuallySpentByMonth[month - 1] += confirmedSpentPence(childCell);
        }
        actuallySpentByMonth[month - 1] += ownLoggedSpentPence(month);
      } else {
        actuallySpentByMonth[month - 1] += confirmedSpentPence(cell);
      }
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
      isPayAnchor: source.isPayAnchor,
      months,
      ...summarize(months),
    };
  });

  const availableByMonth = plannedByMonth.map(
    (planned, i) => wagesByMonth[i] - planned
  );

  // Left to spend carries forward: unspent money doesn't vanish at a period
  // boundary, it's still sitting in the real account next month. Each
  // month's carry-in is the PREVIOUS month's own leftToSpend - which
  // already includes that month's own carry-in - so this compounds
  // correctly across the whole chain, not just one month back. Can go
  // negative (carrying an overspend forward) just as easily as positive.
  //
  // Bounded by carryOverStartYear/Month (Settings > Preferences): nothing
  // carries into the configured start period itself, and the chain never
  // reaches further back than that - a user's older, imported/retroactive
  // data was never tracked with the precision live use gets, so blindly
  // compounding it produces a fictional number, not a real one. Months at
  // or after the start point still compound normally.
  const januaryIndex = year * 12 + 1;
  const carryOverSeed = januaryIndex > startIndex ? await getYearEndLeftToSpend(year - 1) : 0;

  const carryOverByMonth: number[] = [];
  const leftToSpendByMonth: number[] = [];
  let runningCarry = carryOverSeed;
  for (let i = 0; i < 12; i++) {
    const monthIndex = year * 12 + (i + 1);
    const carryIn = monthIndex > startIndex ? runningCarry : 0;
    carryOverByMonth.push(carryIn);
    const value = wagesByMonth[i] + carryIn - actuallySpentByMonth[i];
    leftToSpendByMonth.push(value);
    runningCarry = value;
  }

  return {
    year,
    categories: gridCategories,
    incomeSources: incomeSourceRows,
    subtotalByMonth,
    plannedByMonth,
    wagesByMonth,
    availableByMonth,
    actuallySpentByMonth,
    carryOverByMonth,
    leftToSpendByMonth,
    yearTotal: {
      subtotal: subtotalByMonth.reduce((a, b) => a + b, 0),
      planned: plannedByMonth.reduce((a, b) => a + b, 0),
      wages: wagesByMonth.reduce((a, b) => a + b, 0),
      available: availableByMonth.reduce((a, b) => a + b, 0),
      actuallySpent: actuallySpentByMonth.reduce((a, b) => a + b, 0),
      leftToSpend: leftToSpendByMonth.reduce((a, b) => a + b, 0),
    },
  };
}

// How far ahead of the current year to always offer, even with no data
// yet - a future year can't have any category_entries rows until someone
// actually visits it and enters something, so it has to be offered
// proactively rather than discovered from existing data (unlike past
// years, which show up on their own via the query below).
const YEARS_AHEAD_ALWAYS_OFFERED = 5;

export async function getAvailableYears(): Promise<number[]> {
  const currentYear = new Date().getFullYear();
  const rows = await db
    .select({ year: categoryEntries.year })
    .from(categoryEntries)
    .groupBy(categoryEntries.year);
  const years = new Set(rows.map((r) => r.year));
  for (let y = currentYear; y <= currentYear + YEARS_AHEAD_ALWAYS_OFFERED; y++) {
    years.add(y);
  }
  return Array.from(years).sort((a, b) => a - b);
}

export type CategoryTreeNode = {
  id: number;
  name: string;
  groupName: string | null;
  isAnnual: boolean;
  annualMonth: number | null;
  dueDay: number | null;
  linkedDebtPersonId: number | null;
  children: CategoryTreeNode[];
};

/** Lightweight structural view of categories (no months/amounts) for the
 * Settings page - just the tree shape, for rename/regroup/archive/move.
 * Uses the current calendar year's effective grouping (Settings manages
 * the live app, not a historical view) - see resolveEffectiveParents. */
export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  const currentYear = new Date().getFullYear();
  const cats = await db.query.categories.findMany({
    where: isNull(categories.archivedAt),
    orderBy: (c, { asc }) => [asc(c.sortOrder)],
  });
  const moves = await db.select().from(categoryParentMoves);
  const effectiveParents = resolveEffectiveParents(cats, moves, currentYear);

  const childrenByParent = groupChildrenByParent(cats, effectiveParents);
  return cats
    .filter((c) => effectiveParentOf(effectiveParents, c) === null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      groupName: c.groupName,
      isAnnual: c.isAnnual,
      annualMonth: c.annualMonth,
      dueDay: c.dueDay,
      linkedDebtPersonId: c.linkedDebtPersonId,
      children: (childrenByParent.get(c.id) ?? []).map((child) => ({
        id: child.id,
        name: child.name,
        groupName: child.groupName,
        isAnnual: child.isAnnual,
        annualMonth: child.annualMonth,
        dueDay: child.dueDay,
        linkedDebtPersonId: child.linkedDebtPersonId,
        children: [],
      })),
    }));
}

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

  let debtPersonId: number | undefined;
  if (input.debtPersonId !== undefined) {
    debtPersonId = input.debtPersonId ?? undefined;
  } else {
    const category = await db.query.categories.findFirst({
      where: eq(categories.id, input.categoryId),
    });
    debtPersonId = category?.linkedDebtPersonId ?? undefined;
  }

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

  // Otherwise a logged expense correctly counts toward SUBTOTAL/AVAILABLE but
  // still shows up in "Remaining to pay" as if it hadn't happened yet. A
  // provisional entry gets the same treatment - that's the point of
  // pencilling it in: reflect money the bank's already earmarked.
  await markCellPaid(input.categoryId, year, month);

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
  { id: number; name: string; isPayAnchor: boolean }[]
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
