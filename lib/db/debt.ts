import { asc, eq } from "drizzle-orm";
import { db } from "./index";
import { people, debtLedgerEntries } from "./schema";

export type PersonWithBalance = {
  id: number;
  name: string;
  balancePence: number; // positive = they owe you, negative = you owe them
  entryCount: number;
};

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
  const allPeople = await db.select().from(people).where(eq(people.archived, false));
  const allEntries = await db.select().from(debtLedgerEntries);

  return allPeople.map((person) => {
    const entries = allEntries.filter((e) => e.personId === person.id);
    const balancePence = entries.reduce(
      (sum, e) => sum + signedAmount(e.direction, e.amountPence),
      0
    );
    return {
      id: person.id,
      name: person.name,
      balancePence,
      entryCount: entries.length,
    };
  });
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

export async function addDebtEntry(input: {
  personId: number;
  entryDate: string;
  amountPence: number;
  direction: "loan" | "repayment";
  note?: string;
}) {
  await db.insert(debtLedgerEntries).values({
    personId: input.personId,
    entryDate: input.entryDate,
    amountPence: input.amountPence,
    direction: input.direction,
    note: input.note || null,
  });
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
