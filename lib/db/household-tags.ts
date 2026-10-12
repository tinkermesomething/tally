import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, inTransaction } from "./index";
import { categories, expenseEntries, incomeSources } from "./schema";

/** Sharing entries to the household tab - a smaller, parallel module to
 * lib/db/retro-tags.ts (debt/savings), not a third kind bolted onto it.
 * That file's TagTargets/TagAdds are shaped around "tag with WHICH person
 * or bucket" - household sharing has no "which" at all, there's only one
 * household, so forcing it into that same generic type would make both
 * harder to read. Same two-level pattern though: a whole category (every
 * expense in it, past and future) or one entry at a time.
 *
 * Nothing here reaches outside this user's own file - these functions only
 * ever flip this user's own sharedToHousehold columns. Getting a shared row
 * into the actual shared tab is lib/db/household.ts's reconcile, called by
 * the action layer right after each of these (see app/grid/actions.ts). */

export type HouseholdShareRow = {
  expenseEntryId: number;
  entryDate: string;
  note: string | null;
  amountPence: number;
  categoryName: string;
};

const MAX_ROWS = 1000;

/** Confirmed, not-yet-shared expenses in a category - same filters as
 * listMissingTags (lib/db/retro-tags.ts): pencilled-in drafts and
 * zero/negative amounts are skipped. */
export async function listUnshared(categoryId: number): Promise<{ rows: HouseholdShareRow[]; total: number }> {
  const entries = await db
    .select({
      id: expenseEntries.id,
      entryDate: expenseEntries.entryDate,
      note: expenseEntries.note,
      amountPence: expenseEntries.amountPence,
      categoryName: categories.name,
    })
    .from(expenseEntries)
    .innerJoin(categories, eq(expenseEntries.categoryId, categories.id))
    .where(
      and(
        eq(expenseEntries.categoryId, categoryId),
        eq(expenseEntries.provisional, false),
        eq(expenseEntries.sharedToHousehold, false),
        sql`${expenseEntries.amountPence} > 0`
      )
    )
    .orderBy(desc(expenseEntries.entryDate), desc(expenseEntries.id));
  const rows: HouseholdShareRow[] = entries.map((e) => ({
    expenseEntryId: e.id,
    entryDate: e.entryDate,
    note: e.note,
    amountPence: e.amountPence,
    categoryName: e.categoryName,
  }));
  return { rows: rows.slice(0, MAX_ROWS), total: rows.length };
}

/** Shares the chosen expenses - each id re-checked against what's
 * unshared RIGHT NOW, so a stale list can't double-share or touch an id
 * that moved to a different category since. */
export function shareCategoryExpenses(categoryId: number, expenseEntryIds: number[]): Promise<{ shared: number }> {
  if (expenseEntryIds.length === 0) return Promise.resolve({ shared: 0 });
  return inTransaction(async () => {
    const { rows } = await listUnshared(categoryId);
    const validIds = new Set(rows.map((r) => r.expenseEntryId));
    const toShare = [...new Set(expenseEntryIds)].filter((id) => validIds.has(id));
    if (toShare.length === 0) return { shared: 0 };
    await db.update(expenseEntries).set({ sharedToHousehold: true }).where(inArray(expenseEntries.id, toShare));
    return { shared: toShare.length };
  });
}

/** Sets (or clears) a category's own household-share default and, when
 * turning it on, shares the ticked existing expenses in the same
 * transaction - same shape as linkCategoryAndTag (retro-tags.ts). Turning
 * it OFF only clears the category's own default for new expenses; already
 * -shared expenses stay shared (same "unlinking leaves history alone"
 * rule linkCategoryToBucket already follows). */
export function linkCategoryToHousehold(categoryId: number, share: boolean, expenseEntryIds: number[] = []): Promise<{ shared: number }> {
  return inTransaction(async () => {
    const category = await db.query.categories.findFirst({ where: eq(categories.id, categoryId) });
    if (!category) throw new Error("That category no longer exists.");
    await db.update(categories).set({ sharedToHousehold: share }).where(eq(categories.id, categoryId));
    if (!share) return { shared: 0 };
    return shareCategoryExpenses(categoryId, expenseEntryIds);
  });
}

/** The per-entry override - same rule as setExpenseTags: sets it regardless
 * of what the category default says. */
export async function setExpenseHouseholdShare(expenseEntryId: number, share: boolean) {
  const updated = await db
    .update(expenseEntries)
    .set({ sharedToHousehold: share })
    .where(eq(expenseEntries.id, expenseEntryId))
    .returning({ id: expenseEntries.id });
  if (updated.length === 0) throw new Error("That entry no longer exists.");
}

/** Whole-source sharing - income_entries has no per-transaction row to
 * tag individually (see this file's own top comment), so this is the only
 * lever: on shares every month past and future, off stops sharing new
 * months (same "history stays, future doesn't" rule as the category
 * toggle above). */
export async function shareIncomeSource(incomeSourceId: number, share: boolean) {
  const updated = await db
    .update(incomeSources)
    .set({ sharedToHousehold: share })
    .where(eq(incomeSources.id, incomeSourceId))
    .returning({ id: incomeSources.id });
  if (updated.length === 0) throw new Error("That income source no longer exists.");
}
