import { and, asc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "./index";
import { assertIsoDate } from "../validate";
import { BILL_CADENCES, nextDueDateAfter, daysUntil, type BillCadence } from "../bills-math";
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
 * the categories," not require typing each one in by hand. Mirrors
 * lib/db/grid.ts's applyOverdueFlags EXACTLY (same no-entry/paid/overdue
 * rule) so the Bills tab and the Grid's own Overdue alert can never
 * silently disagree about the same category: no category_entries row this
 * month, or one with no amount set, means nothing was planned - not a
 * bill. Already paid this month - done, nothing to remind about (will
 * reappear once next month's cell exists and isn't paid). A category
 * already linked to a real `bills` row is skipped here - that's the
 * richer, manually-tracked version of the same thing, shown once, not
 * twice. */
async function getCategoryDueBills(today: string): Promise<BillWithStatus[]> {
  const [year, month] = today.split("-").map(Number);
  const linkedCategoryIds = (
    await db.select({ categoryId: bills.categoryId }).from(bills).where(and(eq(bills.archived, false), isNotNull(bills.categoryId)))
  ).map((r) => r.categoryId!);

  const dueDayCategories = await db.query.categories.findMany({
    where: and(isNull(categories.archivedAt), isNotNull(categories.dueDay)),
  });
  const candidateIds = dueDayCategories.map((c) => c.id).filter((id) => !linkedCategoryIds.includes(id));
  if (candidateIds.length === 0) return [];

  const entries = await db
    .select()
    .from(categoryEntries)
    .where(and(inArray(categoryEntries.categoryId, candidateIds), eq(categoryEntries.year, year), eq(categoryEntries.month, month)));
  const entryByCategory = new Map(entries.map((e) => [e.categoryId, e]));

  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const result: BillWithStatus[] = [];
  for (const cat of dueDayCategories) {
    if (!candidateIds.includes(cat.id)) continue;
    const entry = entryByCategory.get(cat.id);
    if (!entry || entry.paid) continue; // nothing planned, or already done this month
    const day = Math.min(cat.dueDay!, lastDayOfMonth);
    const nextDueDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    result.push({
      id: -cat.id, // negative = never a real bills.id - never passed to markBillPaid/updateBill/archiveBill
      name: cat.name,
      amountPence: entry.amountPence,
      cadence: "monthly",
      cadenceDays: null,
      nextDueDate,
      categoryId: cat.id,
      categoryName: cat.name,
      daysUntilDue: daysUntil(nextDueDate, today),
      synthetic: true,
    });
  }
  return result;
}

export async function getBills(today: string = localIsoDate()): Promise<BillWithStatus[]> {
  const [real, fromCategories] = await Promise.all([getRealBills(today), getCategoryDueBills(today)]);
  return [...real, ...fromCategories].sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

/** The bell's own list - due soon or already overdue, soonest first. */
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
