import { and, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "./index";
import { getAppSettings } from "./settings";
import { effectiveParentOf, groupChildrenByParent, resolveEffectiveParents } from "./category-tree";
import {
  categories,
  categoryEntries,
  categoryParentMoves,
  expenseEntries,
  incomeEntries,
  incomeSources,
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
