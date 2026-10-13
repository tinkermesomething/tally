import { and, asc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "./index";
import { assertIsoDate } from "../validate";
import { BILL_CADENCES, BILLS_LOOKAHEAD_DAYS, nextDueDateAfter, daysUntil, type BillCadence } from "../bills-math";
import { localIsoDate } from "../date";
import { bills, categories, categoryEntries } from "./schema";

export type { BillCadence };

export type BillWithStatus = {
  id: number;
  name: string;
  amountPence: number;
  cadence: BillCadence;
  cadenceDays: number | null;
  nextDueDate: string;
  categoryId: number | null;
  categoryName: string | null;
  daysUntilDue: number;
  /** True = derived live from a category's own due day (lib/db/grid.ts's
   * applyOverdueFlags has the exact same rule for the Grid's own Overdue
   * alert), not a real `bills` row - no id to edit/archive/mark-paid
   * against. See getCategoryDueBills. */
  synthetic: boolean;
};

export type BillInput = {
  name: string;
  amountPence: number;
  cadence: BillCadence;
  cadenceDays?: number | null;
  nextDueDate: string;
  categoryId?: number | null;
};

const MAX_NAME = 80;

function cleanBillInput(input: BillInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Give it a name.");
  if (name.length > MAX_NAME) throw new Error(`Keep the name under ${MAX_NAME} characters.`);
  if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) throw new Error("Amount must be greater than zero.");
  if (!(BILL_CADENCES as readonly string[]).includes(input.cadence)) throw new Error(`Unrecognized cadence: "${input.cadence}"`);
  const cadenceDays = input.cadence === "custom_days" ? (input.cadenceDays ?? null) : null;
  if (input.cadence === "custom_days" && (!Number.isInteger(cadenceDays) || (cadenceDays ?? 0) < 1)) {
    throw new Error("Enter how many days between each one.");
  }
  assertIsoDate(input.nextDueDate);
  return { name, amountPence: input.amountPence, cadence: input.cadence, cadenceDays, nextDueDate: input.nextDueDate, categoryId: input.categoryId ?? null };
}

export async function addBill(input: BillInput) {
  const clean = cleanBillInput(input);
  if (clean.categoryId !== null) {
    const category = await db.query.categories.findFirst({ where: eq(categories.id, clean.categoryId) });
    if (!category) throw new Error("That category no longer exists.");
  }
  const [created] = await db.insert(bills).values(clean).returning();
  return created;
}

export async function updateBill(id: number, input: BillInput) {
  const clean = cleanBillInput(input);
  if (clean.categoryId !== null) {
    const category = await db.query.categories.findFirst({ where: eq(categories.id, clean.categoryId) });
    if (!category) throw new Error("That category no longer exists.");
  }
  const [updated] = await db.update(bills).set(clean).where(eq(bills.id, id)).returning();
  if (!updated) throw new Error("That bill no longer exists.");
  return updated;
}

/** Marks one cycle paid by hand (no linked category, or paying early/off
 * the normal schedule) - advances exactly one cadence from the CURRENT
 * nextDueDate, same as the automatic path below, just not triggered by an
 * expense. */
export async function markBillPaid(id: number) {
  const bill = await db.query.bills.findFirst({ where: eq(bills.id, id) });
  if (!bill) throw new Error("That bill no longer exists.");
  const nextDueDate = nextDueDateAfter(bill.nextDueDate, bill.cadence as BillCadence, bill.cadenceDays);
  await db.update(bills).set({ nextDueDate }).where(eq(bills.id, id));
}

export async function archiveBill(id: number) {
  await db.update(bills).set({ archived: true }).where(eq(bills.id, id));
}

export async function unarchiveBill(id: number) {
  await db.update(bills).set({ archived: false }).where(eq(bills.id, id));
}

export async function getArchivedBills() {
  return db.query.bills.findMany({ where: eq(bills.archived, true), orderBy: (b, { asc }) => [asc(b.name)] });
}

async function getRealBills(today: string): Promise<BillWithStatus[]> {
  const rows = await db
    .select({
      id: bills.id,
      name: bills.name,
      amountPence: bills.amountPence,
      cadence: bills.cadence,
      cadenceDays: bills.cadenceDays,
      nextDueDate: bills.nextDueDate,
      categoryId: bills.categoryId,
      categoryName: categories.name,
    })
    .from(bills)
    .leftJoin(categories, eq(categories.id, bills.categoryId))
    .where(eq(bills.archived, false))
    .orderBy(asc(bills.nextDueDate));
  return rows.map((r) => ({ ...r, cadence: r.cadence as BillCadence, daysUntilDue: daysUntil(r.nextDueDate, today), synthetic: false }));
}

/** Every active category with a due day, surfaced as a bill automatically -
 * "the bills tab should populate with the entries that have a due date in
 * the categories," not require typing each one in by hand. The CURRENT
 * month's check mirrors lib/db/grid.ts's applyOverdueFlags exactly (same
 * no-entry/paid/overdue rule) so the Bills tab and the Grid's own Overdue
 * alert can never silently disagree about THIS month's category; this
 * then looks forward across however many further months fall inside
 * `lookaheadDays` (the Bills page's own adjustable "how far ahead" control,
 * defaulting to BILLS_LOOKAHEAD_DAYS), so a due day early next month still shows up
 * before it's actually due, not just once its own month arrives. No
 * category_entries row for a given month, or one with no amount set,
 * means nothing was planned for that month - not a bill. Already paid -
 * done, nothing to remind about for that cycle. A category already linked
 * to a real `bills` row is skipped here - that's the richer,
 * manually-tracked version of the same thing, shown once, not twice. Only
 * the nearest unpaid month per category is returned - a category that's
 * unpaid two months running shows once, for the sooner of the two. */
async function getCategoryDueBills(today: string, lookaheadDays: number): Promise<BillWithStatus[]> {
  const linkedCategoryIds = (
    await db.select({ categoryId: bills.categoryId }).from(bills).where(and(eq(bills.archived, false), isNotNull(bills.categoryId)))
  ).map((r) => r.categoryId!);

  const dueDayCategories = await db.query.categories.findMany({
    where: and(isNull(categories.archivedAt), isNotNull(categories.dueDay)),
  });
  const candidateIds = dueDayCategories.map((c) => c.id).filter((id) => !linkedCategoryIds.includes(id));
  if (candidateIds.length === 0) return [];

  // Every (year, month) pair the lookahead window could touch - walking
  // forward from today's own month until that month's last day is past
  // the window (so a due day anywhere in that final month is covered).
  const [todayYear, todayMonth] = today.split("-").map(Number);
  const months: { year: number; month: number }[] = [];
  for (let y = todayYear, m = todayMonth; ; ) {
    months.push({ year: y, month: m });
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    if (daysUntil(monthEnd, today) >= lookaheadDays) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  // Candidate categories are always a small, per-household set - fetching
  // every entry of theirs and filtering in JS (rather than an OR'd
  // year/month WHERE clause, awkward to express across a year boundary)
  // matches this codebase's usual small-dataset convention.
  const entries = await db.select().from(categoryEntries).where(inArray(categoryEntries.categoryId, candidateIds));
  const entryByCategoryMonth = new Map(entries.map((e) => [`${e.categoryId}:${e.year}:${e.month}`, e]));

  const result: BillWithStatus[] = [];
  for (const cat of dueDayCategories) {
    if (!candidateIds.includes(cat.id)) continue;
    for (const { year, month } of months) {
      const entry = entryByCategoryMonth.get(`${cat.id}:${year}:${month}`);
      if (!entry || entry.paid) continue; // nothing planned that month, or already done
      const lastDayOfMonth = new Date(year, month, 0).getDate();
      const day = Math.min(cat.dueDay!, lastDayOfMonth);
      const nextDueDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const daysUntilDue = daysUntil(nextDueDate, today);
      if (daysUntilDue > lookaheadDays) break; // this and every later month are further still
      result.push({
        id: -cat.id, // negative = never a real bills.id - never passed to markBillPaid/updateBill/archiveBill
        name: cat.name,
        amountPence: entry.amountPence,
        cadence: "monthly",
        cadenceDays: null,
        nextDueDate,
        categoryId: cat.id,
        categoryName: cat.name,
        daysUntilDue,
        synthetic: true,
      });
      break; // nearest unpaid month found for this category - stop looking further out
    }
  }
  return result;
}

/** `lookaheadDays` only scopes the due-day-derived bills, not real ones -
 * a REAL bill was explicitly, deliberately added by the person; one with a
 * distant nextDueDate (yearly, say) should keep showing regardless of
 * whatever window the page happens to be set to, the same as it always
 * has. (Tried capping both the same way - regressed exactly this: a real
 * bill whose due date sat past the selected window just vanished, which
 * is wrong for something someone chose to track on purpose.) */
export async function getBills(today: string = localIsoDate(), lookaheadDays: number = BILLS_LOOKAHEAD_DAYS): Promise<BillWithStatus[]> {
  const [real, fromCategories] = await Promise.all([getRealBills(today), getCategoryDueBills(today, lookaheadDays)]);
  return [...real, ...fromCategories].sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

/** The bell's own list - due soon or already overdue, soonest first. Filters
 * the FULL combined list itself (real bills aren't capped by `getBills`'s
 * own `lookaheadDays` - see its comment), always by its own fixed window,
 * independent of whatever lookahead the Bills page itself happens to be
 * showing. */
export async function getUpcomingBills(withinDays: number, today: string = localIsoDate()): Promise<BillWithStatus[]> {
  const all = await getBills(today);
  return all.filter((b) => b.daysUntilDue <= withinDays);
}

/** Called from logExpense (lib/db/queries.ts) for every expense, not just
 * ones the user explicitly marks as a bill payment - same "the category
 * link does the work" model as a category linked to a debt person or
 * savings bucket. Advances exactly ONE cycle per expense: a bill with
 * several unpaid cycles behind it catches up one logged expense at a
 * time, which matches reality (one expense per cycle) and never silently
 * jumps the due date past cycles nothing was actually paid for. Only
 * expenses dated ON OR AFTER the current due date count - an expense
 * backdated before it isn't "paying this cycle". */
export async function advanceBillsForExpense(categoryId: number, entryDate: string) {
  const due = await db
    .select({ id: bills.id, nextDueDate: bills.nextDueDate, cadence: bills.cadence, cadenceDays: bills.cadenceDays })
    .from(bills)
    .where(and(eq(bills.categoryId, categoryId), eq(bills.archived, false), lte(bills.nextDueDate, entryDate)));
  for (const b of due) {
    const nextDueDate = nextDueDateAfter(b.nextDueDate, b.cadence as BillCadence, b.cadenceDays);
    await db.update(bills).set({ nextDueDate }).where(eq(bills.id, b.id));
  }
}
