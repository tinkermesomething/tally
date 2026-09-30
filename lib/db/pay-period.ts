import { desc, eq, lte } from "drizzle-orm";
import { db } from "./index";
import { incomeSources, payPeriodAnchors } from "./schema";
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
