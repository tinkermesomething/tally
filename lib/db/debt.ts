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
  const allPeople = await db.select().from(people);
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

export async function deletePerson(personId: number) {
  await db.delete(debtLedgerEntries).where(eq(debtLedgerEntries.personId, personId));
  await db.delete(people).where(eq(people.id, personId));
}
