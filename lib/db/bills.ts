import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "./index";
import { assertIsoDate } from "../validate";
import { BILL_CADENCES, nextDueDateAfter, daysUntil, type BillCadence } from "../bills-math";
import { localIsoDate } from "../date";
import { bills, categories } from "./schema";

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

export async function getBills(today: string = localIsoDate()): Promise<BillWithStatus[]> {
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
  return rows.map((r) => ({ ...r, cadence: r.cadence as BillCadence, daysUntilDue: daysUntil(r.nextDueDate, today) }));
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
