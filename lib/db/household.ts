import { and, desc, eq } from "drizzle-orm";
import { db } from "./index";
import { getSystemConn } from "./system-connection";
import {
  categories,
  categoryEntries,
  expenseEntries,
  incomeEntries,
  incomeSources,
  householdSettings,
  householdExpenseEntries,
  householdIncomeEntries,
  householdCategoryBudgets,
  users,
} from "./schema";

/** Every function here either reads/writes the shared keystore connection
 * directly (same reasoning as lib/db/users.ts - admin-only or instance-wide
 * state has no per-user owner) or reads the AMBIENT per-request `db`
 * (reconcile/removeHouseholdDataForUser, deliberately - they need to be
 * called from INSIDE a specific user's own context, never through sysDb(),
 * so that user's own data is what gets read). */
const sysDb = () => getSystemConn().db;

export async function isHouseholdEnabled(): Promise<boolean> {
  const row = await sysDb().query.householdSettings.findFirst();
  return row?.enabled ?? false;
}

/** Admin-only toggle - see app/household/actions.ts for the enforcement. */
export async function setHouseholdEnabled(enabled: boolean) {
  const sys = sysDb();
  const existing = await sys.query.householdSettings.findFirst();
  if (existing) {
    await sys.update(householdSettings).set({ enabled }).where(eq(householdSettings.id, existing.id));
  } else {
    await sys.insert(householdSettings).values({ enabled });
  }
}

/** Full delete-then-reinsert of ONE user's shared rows - deliberately not a
 * diff. An edit, a delete, or an un-share on their own expense/income
 * "just works" on the next call with no extra code anywhere to hunt down
 * every mutation path that might touch a shared row; the cost is a short
 * staleness window for anything not triggered by one of
 * lib/db/household-tags.ts's own actions directly (see the scheduled-sync
 * wiring in lib/scheduled-sync.ts, the self-healing backstop for that).
 *
 * Must be called from INSIDE that user's own per-user db context (the
 * ambient `db` below has to resolve to THEIRS) - every real caller already
 * is one: the action layer right after a share toggle, or
 * lib/scheduled-sync.ts's own per-user loop. Skips entirely (no connection
 * work wasted) when the feature is off instance-wide. */
export async function reconcileHouseholdDataForUser(userId: number) {
  if (!(await isHouseholdEnabled())) return;

  const sharedExpenses = await db
    .select({
      id: expenseEntries.id,
      amountPence: expenseEntries.amountPence,
      entryDate: expenseEntries.entryDate,
      note: expenseEntries.note,
      categoryName: categories.name,
    })
    .from(expenseEntries)
    .innerJoin(categories, eq(expenseEntries.categoryId, categories.id))
    .where(eq(expenseEntries.sharedToHousehold, true));

  const sharedIncome = await db
    .select({
      id: incomeEntries.id,
      incomeSourceId: incomeEntries.incomeSourceId,
      year: incomeEntries.year,
      month: incomeEntries.month,
      amountPence: incomeEntries.amountPence,
      sourceName: incomeSources.name,
    })
    .from(incomeEntries)
    .innerJoin(incomeSources, eq(incomeEntries.incomeSourceId, incomeSources.id))
    .where(eq(incomeSources.sharedToHousehold, true));

  // Budgeted figures - a category/month thing, not per-entry, so this
  // reads from categories.sharedToHousehold (the CATEGORY flag) rather
  // than anything on expenseEntries. Not year-scoped, same "reconcile
  // everything every time" simplicity as the two above.
  const sharedBudgets = await db
    .select({
      id: categoryEntries.id,
      categoryId: categoryEntries.categoryId,
      year: categoryEntries.year,
      month: categoryEntries.month,
      amountPence: categoryEntries.amountPence,
      categoryName: categories.name,
      groupName: categories.groupName,
    })
    .from(categoryEntries)
    .innerJoin(categories, eq(categoryEntries.categoryId, categories.id))
    .where(eq(categories.sharedToHousehold, true));

  const sys = sysDb();
  await sys.delete(householdExpenseEntries).where(eq(householdExpenseEntries.sourceUserId, userId));
  await sys.delete(householdIncomeEntries).where(eq(householdIncomeEntries.sourceUserId, userId));
  await sys.delete(householdCategoryBudgets).where(eq(householdCategoryBudgets.sourceUserId, userId));

  if (sharedExpenses.length > 0) {
    await sys.insert(householdExpenseEntries).values(
      sharedExpenses.map((e) => ({
        sourceUserId: userId,
        sourceExpenseEntryId: e.id,
        categoryName: e.categoryName,
        amountPence: e.amountPence,
        entryDate: e.entryDate,
        note: e.note,
      }))
    );
  }
  if (sharedIncome.length > 0) {
    await sys.insert(householdIncomeEntries).values(
      sharedIncome.map((e) => ({
        sourceUserId: userId,
        sourceIncomeSourceId: e.incomeSourceId,
        sourceName: e.sourceName,
        year: e.year,
        month: e.month,
        amountPence: e.amountPence,
      }))
    );
  }
  if (sharedBudgets.length > 0) {
    await sys.insert(householdCategoryBudgets).values(
      sharedBudgets.map((b) => ({
        sourceUserId: userId,
        sourceCategoryId: b.categoryId,
        categoryName: b.categoryName,
        groupName: b.groupName,
        year: b.year,
        month: b.month,
        amountPence: b.amountPence,
      }))
    );
  }
}

/** Called from deleteUser (lib/db/users.ts) - a deleted account must not
 * leave orphaned entries attributed to a user id nothing resolves anymore. */
export async function removeHouseholdDataForUser(userId: number) {
  const sys = sysDb();
  await sys.delete(householdExpenseEntries).where(eq(householdExpenseEntries.sourceUserId, userId));
  await sys.delete(householdIncomeEntries).where(eq(householdIncomeEntries.sourceUserId, userId));
  await sys.delete(householdCategoryBudgets).where(eq(householdCategoryBudgets.sourceUserId, userId));
}

// ---- read side for the Household page ----

export type HouseholdExpenseRow = {
  id: number;
  categoryName: string;
  amountPence: number;
  entryDate: string;
  note: string | null;
  sourceUserId: number;
  sourceUserName: string | null;
  sourceUserEmail: string;
  sourceUserColor: string | null;
};

export async function getHouseholdExpenses(): Promise<HouseholdExpenseRow[]> {
  return sysDb()
    .select({
      id: householdExpenseEntries.id,
      categoryName: householdExpenseEntries.categoryName,
      amountPence: householdExpenseEntries.amountPence,
      entryDate: householdExpenseEntries.entryDate,
      note: householdExpenseEntries.note,
      sourceUserId: householdExpenseEntries.sourceUserId,
      sourceUserName: users.name,
      sourceUserEmail: users.email,
      sourceUserColor: users.avatarColor,
    })
    .from(householdExpenseEntries)
    .innerJoin(users, eq(users.id, householdExpenseEntries.sourceUserId))
    .orderBy(desc(householdExpenseEntries.entryDate));
}

export type HouseholdIncomeRow = {
  id: number;
  sourceName: string;
  year: number;
  month: number;
  amountPence: number;
  sourceUserId: number;
  sourceUserName: string | null;
  sourceUserEmail: string;
};

export async function getHouseholdIncome(): Promise<HouseholdIncomeRow[]> {
  return sysDb()
    .select({
      id: householdIncomeEntries.id,
      sourceName: householdIncomeEntries.sourceName,
      year: householdIncomeEntries.year,
      month: householdIncomeEntries.month,
      amountPence: householdIncomeEntries.amountPence,
      sourceUserId: householdIncomeEntries.sourceUserId,
      sourceUserName: users.name,
      sourceUserEmail: users.email,
    })
    .from(householdIncomeEntries)
    .innerJoin(users, eq(users.id, householdIncomeEntries.sourceUserId))
    .orderBy(desc(householdIncomeEntries.year), desc(householdIncomeEntries.month));
}

// ---- the grid itself - "a copy of the budget, with shared entries" ----

export type HouseholdGridCell = { budgetedPence: number; spentPence: number };

export type HouseholdGridRow = {
  categoryName: string;
  groupName: string | null;
  months: Record<number, HouseholdGridCell>; // 1-12
  yearBudgetedPence: number;
  yearSpentPence: number;
};

/** One row per distinct category NAME (see lib/db/household.ts's own top
 * comment and the household feature's design notes for why name, not id,
 * is the grouping key - different users' category ids refer to entirely
 * different rows in entirely different files). Budgeted comes from
 * household_category_budgets, spent from household_expense_entries
 * (entryDate is free text "YYYY-MM-DD" - filtered/bucketed in JS, same as
 * every other small-dataset aggregation in this codebase does rather than
 * fight SQLite's text date functions for a household's worth of rows). */
export async function getHouseholdGrid(year: number): Promise<HouseholdGridRow[]> {
  const sys = sysDb();
  const [budgets, expenses] = await Promise.all([
    sys
      .select({ categoryName: householdCategoryBudgets.categoryName, groupName: householdCategoryBudgets.groupName, month: householdCategoryBudgets.month, amountPence: householdCategoryBudgets.amountPence })
      .from(householdCategoryBudgets)
      .where(eq(householdCategoryBudgets.year, year)),
    sys
      .select({ categoryName: householdExpenseEntries.categoryName, entryDate: householdExpenseEntries.entryDate, amountPence: householdExpenseEntries.amountPence })
      .from(householdExpenseEntries),
  ]);

  const rows = new Map<string, HouseholdGridRow>();
  const ensure = (categoryName: string, groupName: string | null) => {
    let row = rows.get(categoryName);
    if (!row) {
      row = { categoryName, groupName, months: {}, yearBudgetedPence: 0, yearSpentPence: 0 };
      for (let m = 1; m <= 12; m++) row.months[m] = { budgetedPence: 0, spentPence: 0 };
      rows.set(categoryName, row);
    } else if (groupName && !row.groupName) {
      row.groupName = groupName;
    }
    return row;
  };

  for (const b of budgets) {
    const row = ensure(b.categoryName, b.groupName);
    row.months[b.month].budgetedPence += b.amountPence;
    row.yearBudgetedPence += b.amountPence;
  }
  const yearPrefix = `${year}-`;
  for (const e of expenses) {
    if (!e.entryDate.startsWith(yearPrefix)) continue;
    const month = parseInt(e.entryDate.slice(5, 7), 10);
    const row = ensure(e.categoryName, null);
    row.months[month].spentPence += e.amountPence;
    row.yearSpentPence += e.amountPence;
  }

  return [...rows.values()].sort(
    (a, b) => (a.groupName ?? "").localeCompare(b.groupName ?? "") || a.categoryName.localeCompare(b.categoryName)
  );
}

export type HouseholdIncomeGridRow = {
  sourceName: string;
  months: Record<number, number>; // 1-12, amountPence
  yearTotalPence: number;
};

/** Income has no separate "planned" figure in this app even for a single
 * user (income_entries already IS the plan, not a forecast of it) - same
 * here, amount only, no budgeted/spent split. */
export async function getHouseholdIncomeGrid(year: number): Promise<HouseholdIncomeGridRow[]> {
  const rows = await sysDb()
    .select({ sourceName: householdIncomeEntries.sourceName, month: householdIncomeEntries.month, amountPence: householdIncomeEntries.amountPence })
    .from(householdIncomeEntries)
    .where(eq(householdIncomeEntries.year, year));

  const map = new Map<string, HouseholdIncomeGridRow>();
  for (const r of rows) {
    let row = map.get(r.sourceName);
    if (!row) {
      row = { sourceName: r.sourceName, months: {}, yearTotalPence: 0 };
      for (let m = 1; m <= 12; m++) row.months[m] = 0;
      map.set(r.sourceName, row);
    }
    row.months[r.month] += r.amountPence;
    row.yearTotalPence += r.amountPence;
  }
  return [...map.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

/** Every year with any shared data at all, newest first - always includes
 * the current year even with nothing shared yet, so the year selector
 * isn't ever empty on a freshly-enabled instance. */
export async function getHouseholdYears(): Promise<number[]> {
  const sys = sysDb();
  const [budgetYears, incomeYears, expenseDates] = await Promise.all([
    sys.selectDistinct({ year: householdCategoryBudgets.year }).from(householdCategoryBudgets),
    sys.selectDistinct({ year: householdIncomeEntries.year }).from(householdIncomeEntries),
    sys.select({ entryDate: householdExpenseEntries.entryDate }).from(householdExpenseEntries),
  ]);
  const years = new Set<number>([
    new Date().getFullYear(),
    ...budgetYears.map((r) => r.year),
    ...incomeYears.map((r) => r.year),
    ...expenseDates.map((e) => parseInt(e.entryDate.slice(0, 4), 10)),
  ]);
  return [...years].sort((a, b) => b - a);
}

export type HouseholdCellDetail = {
  budgeted: { sourceUserId: number; sourceUserName: string | null; amountPence: number }[];
  spent: { sourceUserId: number; sourceUserName: string | null; amountPence: number; entryDate: string; note: string | null }[];
};

/** Who's actually behind one grid cell's combined number - click-to-expand
 * on the Household page, since "£450 combined" alone hides who spent it. */
export async function getHouseholdCellDetail(categoryName: string, year: number, month: number): Promise<HouseholdCellDetail> {
  const sys = sysDb();
  const budgeted = await sys
    .select({ sourceUserId: householdCategoryBudgets.sourceUserId, sourceUserName: users.name, amountPence: householdCategoryBudgets.amountPence })
    .from(householdCategoryBudgets)
    .innerJoin(users, eq(users.id, householdCategoryBudgets.sourceUserId))
    .where(and(eq(householdCategoryBudgets.categoryName, categoryName), eq(householdCategoryBudgets.year, year), eq(householdCategoryBudgets.month, month)));

  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const allForCategory = await sys
    .select({ sourceUserId: householdExpenseEntries.sourceUserId, sourceUserName: users.name, amountPence: householdExpenseEntries.amountPence, entryDate: householdExpenseEntries.entryDate, note: householdExpenseEntries.note })
    .from(householdExpenseEntries)
    .innerJoin(users, eq(users.id, householdExpenseEntries.sourceUserId))
    .where(eq(householdExpenseEntries.categoryName, categoryName));

  return { budgeted, spent: allForCategory.filter((e) => e.entryDate.startsWith(monthPrefix)) };
}
