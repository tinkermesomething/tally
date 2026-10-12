import { desc, eq } from "drizzle-orm";
import { db } from "./index";
import { getSystemConn } from "./system-connection";
import { categories, expenseEntries, incomeEntries, incomeSources, householdSettings, householdExpenseEntries, householdIncomeEntries, users } from "./schema";

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

  const sys = sysDb();
  await sys.delete(householdExpenseEntries).where(eq(householdExpenseEntries.sourceUserId, userId));
  await sys.delete(householdIncomeEntries).where(eq(householdIncomeEntries.sourceUserId, userId));

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
}

/** Called from deleteUser (lib/db/users.ts) - a deleted account must not
 * leave orphaned entries attributed to a user id nothing resolves anymore. */
export async function removeHouseholdDataForUser(userId: number) {
  const sys = sysDb();
  await sys.delete(householdExpenseEntries).where(eq(householdExpenseEntries.sourceUserId, userId));
  await sys.delete(householdIncomeEntries).where(eq(householdIncomeEntries.sourceUserId, userId));
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
