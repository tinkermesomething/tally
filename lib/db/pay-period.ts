import { and, desc, eq, gt, gte, lt, lte } from "drizzle-orm";
import { db, inTransaction } from "./index";
import { markCellPaid, unpayCellIfNoExpenses } from "./cells";
import { expenseEntries, incomeSources, payPeriodAnchors } from "./schema";
import { parseIsoDate } from "../date";

/** Resolves which (year, month) budget period a real calendar date falls
 * into. With no pay-anchor income source configured, or for a date before
 * the earliest anchor ever recorded, this is plain calendar-month - see
 * parseIsoDate. Once a pay-anchor source has logged entries, any date
 * on/after the most recent anchor's receivedDate resolves to that anchor's
 * year/month instead of its own calendar month (wages received Aug 28,
 * counted as September - see payPeriodAnchors in lib/db/schema.ts). */
export async function resolvePeriodForDate(entryDate: string): Promise<{ year: number; month: number }> {
  const anchor = await db.query.payPeriodAnchors.findFirst({
    where: lte(payPeriodAnchors.receivedDate, entryDate),
    orderBy: (a, { desc }) => [desc(a.receivedDate), desc(a.id)],
  });
  if (anchor) {
    return { year: anchor.year, month: anchor.month };
  }
  return parseIsoDate(entryDate);
}

export async function getPayAnchorSource(): Promise<{ id: number; name: string } | null> {
  const source = await db.query.incomeSources.findFirst({
    where: eq(incomeSources.isPayAnchor, true),
  });
  return source ? { id: source.id, name: source.name } : null;
}

/** Marks one income source as the pay anchor, unmarking whatever source
 * held it before - at most one source can be the anchor at a time, since a
 * single boundary timeline (payPeriodAnchors) only makes sense for one
 * income stream. Pass null to turn the feature off entirely. */
export async function setPayAnchorSource(incomeSourceId: number | null) {
  await db.update(incomeSources).set({ isPayAnchor: false }).where(eq(incomeSources.isPayAnchor, true));
  if (incomeSourceId !== null) {
    await db.update(incomeSources).set({ isPayAnchor: true }).where(eq(incomeSources.id, incomeSourceId));
  }
}

/** Records a new period boundary - called whenever a dated entry is logged
 * against the designated pay-anchor source. Always appends rather than
 * upserting: a correction or a second same-month deposit just adds another
 * boundary, which resolvePeriodForDate's "most recent receivedDate" lookup
 * already handles correctly without needing a stored link back to it. */
export async function recordPayPeriodAnchor(input: {
  incomeSourceId: number;
  receivedDate: string;
  year: number;
  month: number;
}) {
  await db.insert(payPeriodAnchors).values(input);
}

export async function listPayPeriodAnchors() {
  return db.select().from(payPeriodAnchors).orderBy(desc(payPeriodAnchors.receivedDate));
}

/** The budget month a pay deposit funds: the month most of the 30 days
 * AFTER it fall in, i.e. the month of (date + 15 days). No cutoff day -
 * 30 Sep -> Oct, 28 Aug -> Sep, 31 Jul -> Aug, 3 Oct -> Oct. */
export function periodForReceivedDate(receivedDate: string): { year: number; month: number } {
  parseIsoDate(receivedDate); // rejects malformed input
  const d = new Date(`${receivedDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 15);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Records the anchor for a pay deposit categorized into the pay-anchor
 * source (auto rule, by hand or bulk), then re-files the expenses that the
 * new boundary moves. Returns the funded month, which is also the month
 * the deposit's own income entry belongs in. Skips the insert when the
 * latest anchor for that date already says the same thing, so re-running
 * for the same deposit never piles up duplicates. */
export function recordAnchorForWage(incomeSourceId: number, receivedDate: string) {
  return inTransaction(() => recordAnchorForWageUnsafe(incomeSourceId, receivedDate));
}

async function recordAnchorForWageUnsafe(incomeSourceId: number, receivedDate: string) {
  const period = periodForReceivedDate(receivedDate);
  const latestSameDay = await db.query.payPeriodAnchors.findFirst({
    where: eq(payPeriodAnchors.receivedDate, receivedDate),
    orderBy: (a, { desc }) => [desc(a.id)],
  });
  if (!latestSameDay || latestSameDay.year !== period.year || latestSameDay.month !== period.month) {
    await recordPayPeriodAnchor({ incomeSourceId, receivedDate, ...period });
    await refileExpensesFromAnchor(receivedDate);
  }
  return period;
}

/** Stored expense year/month are fixed at insert time, so a new anchor
 * does not move expenses that were already filed. This does: every expense
 * dated from `fromDate` up to the next later anchor is re-resolved and
 * moved when its period changed. The paid placeholders follow the same
 * rules as logExpense / deleteExpenseEntry: the destination cell is paid,
 * and the old cell reverts to unpaid when no expense is left in it.
 * Returns how many expenses moved. */
export function refileExpensesFromAnchor(fromDate: string): Promise<number> {
  return inTransaction(() => refileExpensesUnsafe(fromDate));
}

async function refileExpensesUnsafe(fromDate: string): Promise<number> {
  const next = await db.query.payPeriodAnchors.findFirst({
    where: gt(payPeriodAnchors.receivedDate, fromDate),
    orderBy: (a, { asc }) => [asc(a.receivedDate)],
  });
  const rows = await db
    .select()
    .from(expenseEntries)
    .where(
      and(
        gte(expenseEntries.entryDate, fromDate),
        next ? lt(expenseEntries.entryDate, next.receivedDate) : undefined
      )
    );

  let moved = 0;
  for (const e of rows) {
    const { year, month } = await resolvePeriodForDate(e.entryDate);
    if (year === e.year && month === e.month) continue;
    await db.update(expenseEntries).set({ year, month }).where(eq(expenseEntries.id, e.id));

    await markCellPaid(e.categoryId, year, month);
    await unpayCellIfNoExpenses(e.categoryId, e.year, e.month);
    moved++;
  }
  return moved;
}
