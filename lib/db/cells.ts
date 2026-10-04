import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { categoryEntries, expenseEntries } from "./schema";

/** Logging an expense means the money is gone - the same real-world fact as
 * ticking "paid" - so the category's cell for that month is marked paid.
 * No plan for the month yet? A 0-pence cell is created to carry the flag. */
export async function markCellPaid(categoryId: number, year: number, month: number) {
  await db
    .insert(categoryEntries)
    .values({ categoryId, year, month, amountPence: 0, paid: true })
    .onConflictDoUpdate({
      target: [categoryEntries.categoryId, categoryEntries.year, categoryEntries.month],
      set: { paid: true },
    });
}

/** The reverse: once a cell has no logged expense left, the "paid" flag the
 * expenses set automatically no longer reflects anything real. */
export async function unpayCellIfNoExpenses(categoryId: number, year: number, month: number) {
  const remaining = await db.query.expenseEntries.findFirst({
    where: and(eq(expenseEntries.categoryId, categoryId), eq(expenseEntries.year, year), eq(expenseEntries.month, month)),
  });
  if (remaining) return;
  await db
    .update(categoryEntries)
    .set({ paid: false })
    .where(and(eq(categoryEntries.categoryId, categoryId), eq(categoryEntries.year, year), eq(categoryEntries.month, month)));
}
