import { asc, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { assertIsoDate } from "../validate";
import { people, debtLedgerEntries } from "./schema";

export type PersonWithBalance = {
  id: number;
  name: string;
  color: string | null;
  balancePence: number; // positive = you owe them, negative = they owe you
  entryCount: number;
};

const MAX_NAME = 80;

export type LedgerRow = {
  id: number;
  entryDate: string;
  amountPence: number;
  direction: "loan" | "repayment";
  note: string | null;
  runningBalancePence: number;
};

function signedAmount(direction: "loan" | "repayment", amountPence: number) {
  return direction === "loan" ? amountPence : -amountPence;
}

export async function getPeopleWithBalances(): Promise<PersonWithBalance[]> {
  // One aggregate query instead of loading the whole ledger and filtering it
  // once per person. Same sign rule as signedAmount: loans add, repayments subtract.
  return db
    .select({
      id: people.id,
      name: people.name,
      color: people.color,
      balancePence: sql<number>`coalesce(sum(case when ${debtLedgerEntries.direction} = 'loan' then ${debtLedgerEntries.amountPence} else -${debtLedgerEntries.amountPence} end), 0)`,
      entryCount: sql<number>`count(${debtLedgerEntries.id})`,
    })
    .from(people)
    .leftJoin(debtLedgerEntries, eq(debtLedgerEntries.personId, people.id))
    .where(eq(people.archived, false))
    .groupBy(people.id)
    .orderBy(asc(people.id));
}

export async function getPersonLedger(personId: number): Promise<{
  person: { id: number; name: string } | null;
  entries: LedgerRow[];
  balancePence: number;
}> {
  const person = await db.query.people.findFirst({
    where: eq(people.id, personId),
  });

  const entries = await db
    .select()
    .from(debtLedgerEntries)
    .where(eq(debtLedgerEntries.personId, personId))
    .orderBy(asc(debtLedgerEntries.entryDate), asc(debtLedgerEntries.id));

  let running = 0;
  const rows: LedgerRow[] = entries.map((e) => {
    running += signedAmount(e.direction, e.amountPence);
    return {
      id: e.id,
      entryDate: e.entryDate,
      amountPence: e.amountPence,
      direction: e.direction,
      note: e.note,
      runningBalancePence: running,
    };
  });

  return {
    person: person ? { id: person.id, name: person.name } : null,
    entries: rows,
    balancePence: running,
  };
}

export async function addPerson(name: string) {
  const [created] = await db.insert(people).values({ name }).returning();
  return created;
}

/** Renames a person. Only the name changes - ledger entries, colour and
 * balance are untouched. Same validation as renameIncomeSource
 * (lib/db/income-order.ts). */
export async function renamePerson(id: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give them a name.");
  if (trimmed.length > MAX_NAME) throw new Error(`Keep the name under ${MAX_NAME} characters.`);
  const updated = await db.update(people).set({ name: trimmed }).where(eq(people.id, id)).returning({ id: people.id });
  if (updated.length === 0) throw new Error("They no longer exist.");
}

/** This person's colour in the debt pie chart (null = automatic, a
 * palette colour picked by position). Same "#rrggbb" validation as
 * setIncomeSourceColor (lib/db/queries.ts) - the value ends up in CSS. */
export async function setPersonColor(id: number, color: string | null) {
  const value = color === null || color === "" ? null : color.trim();
  if (value !== null && !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error("Colour must look like #1a2b3c.");
  const updated = await db.update(people).set({ color: value }).where(eq(people.id, id)).returning({ id: people.id });
  if (updated.length === 0) throw new Error("They no longer exist.");
}

export async function addDebtEntry(input: {
  personId: number;
  entryDate: string;
  amountPence: number;
  direction: "loan" | "repayment";
  note?: string;
  /** Set when created automatically alongside an expense (logExpense), so a
   * later discard of a provisional expense can remove this too. */
  expenseEntryId?: number;
}) {
  assertIsoDate(input.entryDate);
  await db.insert(debtLedgerEntries).values({
    personId: input.personId,
    entryDate: input.entryDate,
    amountPence: input.amountPence,
    direction: input.direction,
    note: input.note || null,
    expenseEntryId: input.expenseEntryId,
  });
}

/** Cleanup for discarding a provisional expense - removes the ledger entry
 * it auto-created, if any. No-op if the expense never had a debt tag. */
export async function deleteDebtEntriesForExpense(expenseEntryId: number) {
  await db.delete(debtLedgerEntries).where(eq(debtLedgerEntries.expenseEntryId, expenseEntryId));
}

/** Edits a ledger entry's own fields (amount/direction/date/note) - doesn't
 * touch whatever expense/income entry a "log as expense"/"count as income"
 * link might have created alongside it at creation time (there's no stored
 * reference back to that row, mirroring how logExpense itself works). */
export async function updateDebtEntry(
  id: number,
  input: {
    amountPence?: number;
    direction?: "loan" | "repayment";
    entryDate?: string;
    note?: string | null;
  }
) {
  const set: Partial<typeof debtLedgerEntries.$inferInsert> = {};
  if (input.amountPence !== undefined) set.amountPence = input.amountPence;
  if (input.direction !== undefined) set.direction = input.direction;
  if (input.entryDate !== undefined) set.entryDate = input.entryDate;
  if (input.note !== undefined) set.note = input.note;
  await db.update(debtLedgerEntries).set(set).where(eq(debtLedgerEntries.id, id));
}

/** Real, permanent delete - same reasoning as expense entries: a ledger row
 * is a transaction record, not a concept worth soft-deleting. */
export async function deleteDebtEntry(id: number) {
  await db.delete(debtLedgerEntries).where(eq(debtLedgerEntries.id, id));
}

/** Soft-delete - keeps the ledger history intact (it's financial history,
 * shouldn't vanish just because you stop tracking someone going forward),
 * just hides them from the Debt page. */
export async function archivePerson(personId: number) {
  await db.update(people).set({ archived: true }).where(eq(people.id, personId));
}

export async function unarchivePerson(personId: number) {
  await db.update(people).set({ archived: false }).where(eq(people.id, personId));
}

export async function getArchivedPeople() {
  return db.query.people.findMany({
    where: eq(people.archived, true),
    orderBy: (p, { asc }) => [asc(p.name)],
  });
}
