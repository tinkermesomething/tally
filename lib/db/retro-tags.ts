import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, inTransaction } from "./index";
import { addDebtEntry } from "./debt";
import { addSavingsEntry, linkCategoryToBucket } from "./savings";
import { categories, debtLedgerEntries, expenseEntries, people, savingsBuckets, savingsEntries } from "./schema";

/** Adding (or changing) the debt-repayment and savings tags on expenses that
 * already exist: for a whole category (linking it to a lender or a bucket), a
 * rule, or one entry. An expense is only ever tagged once per kind - one that
 * already counts towards a person or a bucket is never double counted. */

export type TagTargets = { debtPersonId?: number; savingsBucketId?: number };
export type TagAdds = { debt: boolean; savings: boolean };

export type MissingTagRow = {
  expenseEntryId: number;
  entryDate: string;
  note: string | null;
  amountPence: number;
  categoryName: string;
  adds: TagAdds;
};

/** What to add to an expense (already known to be untagged) - the one place
 * that writes the ledger row / the deposit, so every route to tagging an
 * expense behaves the same as tagging it when it is first logged. */
export async function addTagsToExpense(
  entry: { id: number; entryDate: string; amountPence: number; note: string | null },
  adds: TagAdds,
  tags: TagTargets
) {
  if (adds.debt && tags.debtPersonId !== undefined) {
    await db.update(expenseEntries).set({ debtPersonId: tags.debtPersonId }).where(eq(expenseEntries.id, entry.id));
    await addDebtEntry({
      personId: tags.debtPersonId,
      entryDate: entry.entryDate,
      amountPence: entry.amountPence,
      direction: "repayment",
      note: entry.note ?? undefined,
      expenseEntryId: entry.id,
    });
  }
  if (adds.savings && tags.savingsBucketId !== undefined) {
    await addSavingsEntry({
      bucketId: tags.savingsBucketId,
      entryDate: entry.entryDate,
      amountPence: entry.amountPence,
      direction: "deposit",
      note: entry.note,
      expenseEntryId: entry.id,
    });
  }
}

const MAX_ROWS = 1000;

/** Every confirmed expense in a category that is missing the debt and/or
 * savings tag asked for, newest first. Pencilled-in drafts are skipped. */
export async function listMissingTags(categoryId: number, tags: TagTargets): Promise<{ rows: MissingTagRow[]; total: number }> {
  if (tags.debtPersonId === undefined && tags.savingsBucketId === undefined) return { rows: [], total: 0 };
  const entries = await db
    .select({
      id: expenseEntries.id,
      entryDate: expenseEntries.entryDate,
      note: expenseEntries.note,
      amountPence: expenseEntries.amountPence,
      debtPersonId: expenseEntries.debtPersonId,
      categoryName: categories.name,
    })
    .from(expenseEntries)
    .innerJoin(categories, eq(expenseEntries.categoryId, categories.id))
    .where(and(eq(expenseEntries.categoryId, categoryId), eq(expenseEntries.provisional, false), sql`${expenseEntries.amountPence} > 0`))
    .orderBy(desc(expenseEntries.entryDate), desc(expenseEntries.id));
  if (entries.length === 0) return { rows: [], total: 0 };

  const ids = entries.map((e) => e.id);
  const ledgered = new Set((await db.select({ id: debtLedgerEntries.expenseEntryId }).from(debtLedgerEntries).where(inArray(debtLedgerEntries.expenseEntryId, ids))).map((r) => r.id));
  const deposited = new Set((await db.select({ id: savingsEntries.expenseEntryId }).from(savingsEntries).where(inArray(savingsEntries.expenseEntryId, ids))).map((r) => r.id));

  const all: MissingTagRow[] = [];
  for (const e of entries) {
    const debt = tags.debtPersonId !== undefined && e.debtPersonId === null && !ledgered.has(e.id);
    const savings = tags.savingsBucketId !== undefined && !deposited.has(e.id);
    if (!debt && !savings) continue;
    all.push({ expenseEntryId: e.id, entryDate: e.entryDate, note: e.note, amountPence: e.amountPence, categoryName: e.categoryName, adds: { debt, savings } });
  }
  return { rows: all.slice(0, MAX_ROWS), total: all.length };
}

/** Tags the chosen expenses of a category. Each id is re-checked against what
 * is missing RIGHT NOW (so a stale list can't double count), and the whole
 * batch is saved as one unit. */
export async function tagCategoryExpenses(
  categoryId: number,
  tags: TagTargets,
  expenseEntryIds: number[]
): Promise<{ tagged: number; skipped: { id: number; reason: string }[] }> {
  const skipped: { id: number; reason: string }[] = [];
  if (expenseEntryIds.length === 0) return { tagged: 0, skipped };
  return inTransaction(async () => {
    const { rows } = await listMissingTags(categoryId, tags);
    const byId = new Map(rows.map((r) => [r.expenseEntryId, r]));
    let tagged = 0;
    for (const id of new Set(expenseEntryIds)) {
      const row = byId.get(id);
      if (!row) {
        skipped.push({ id, reason: "was already tagged, or is not in this category" });
        continue;
      }
      await addTagsToExpense({ id, entryDate: row.entryDate, amountPence: row.amountPence, note: row.note }, row.adds, tags);
      tagged++;
    }
    return { tagged, skipped };
  });
}

// ---- one entry ----

export type EntryTags = { debtPersonId: number | null; savingsBucketId: number | null };

/** Sets what ONE expense counts towards: a lender (as a repayment), a savings
 * bucket (as a deposit), either, both or neither. `undefined` leaves that kind
 * alone, a number sets it (changing it if it was set to something else), and
 * `null` clears it - clearing removes the ledger row / deposit this expense
 * made, so the debt or bucket balance follows. */
export function setExpenseTags(expenseEntryId: number, changes: { debtPersonId?: number | null; savingsBucketId?: number | null }) {
  return inTransaction(async () => {
    const entry = await db.query.expenseEntries.findFirst({ where: eq(expenseEntries.id, expenseEntryId) });
    if (!entry) throw new Error("That entry no longer exists.");

    if (changes.debtPersonId !== undefined) {
      if (changes.debtPersonId !== null) {
        const person = await db.query.people.findFirst({ where: eq(people.id, changes.debtPersonId) });
        if (!person || person.archived) throw new Error("That lender isn't available.");
      }
      const ledger = await db.select().from(debtLedgerEntries).where(eq(debtLedgerEntries.expenseEntryId, expenseEntryId));
      const unchanged = changes.debtPersonId !== null && entry.debtPersonId === changes.debtPersonId && ledger.length > 0;
      if (!unchanged) {
        await db.delete(debtLedgerEntries).where(eq(debtLedgerEntries.expenseEntryId, expenseEntryId));
        await db.update(expenseEntries).set({ debtPersonId: changes.debtPersonId }).where(eq(expenseEntries.id, expenseEntryId));
        if (changes.debtPersonId !== null) {
          await addDebtEntry({ personId: changes.debtPersonId, entryDate: entry.entryDate, amountPence: entry.amountPence, direction: "repayment", note: entry.note ?? undefined, expenseEntryId });
        }
      }
    }

    if (changes.savingsBucketId !== undefined) {
      if (changes.savingsBucketId !== null) {
        const bucket = await db.query.savingsBuckets.findFirst({ where: eq(savingsBuckets.id, changes.savingsBucketId) });
        if (!bucket || bucket.archived) throw new Error("That savings bucket isn't available.");
      }
      const deposits = await db.select().from(savingsEntries).where(eq(savingsEntries.expenseEntryId, expenseEntryId));
      const unchanged = changes.savingsBucketId !== null && deposits.length === 1 && deposits[0].bucketId === changes.savingsBucketId;
      if (!unchanged) {
        await db.delete(savingsEntries).where(eq(savingsEntries.expenseEntryId, expenseEntryId));
        if (changes.savingsBucketId !== null) {
          await addSavingsEntry({ bucketId: changes.savingsBucketId, entryDate: entry.entryDate, amountPence: entry.amountPence, direction: "deposit", note: entry.note, expenseEntryId });
        }
      }
    }
  });
}

/** What each expense currently counts towards, for showing next to it. */
export async function getEntryTags(ids: number[]): Promise<Map<number, EntryTags>> {
  const map = new Map<number, EntryTags>(ids.map((id) => [id, { debtPersonId: null, savingsBucketId: null }]));
  if (ids.length === 0) return map;
  for (const r of await db.select({ id: expenseEntries.id, debtPersonId: expenseEntries.debtPersonId }).from(expenseEntries).where(inArray(expenseEntries.id, ids))) {
    map.get(r.id)!.debtPersonId = r.debtPersonId;
  }
  for (const r of await db.select({ id: savingsEntries.expenseEntryId, bucketId: savingsEntries.bucketId }).from(savingsEntries).where(inArray(savingsEntries.expenseEntryId, ids)).orderBy(asc(savingsEntries.id))) {
    if (r.id !== null) map.get(r.id)!.savingsBucketId = r.bucketId;
  }
  return map;
}

/** The lenders and buckets that can be chosen. */
export async function getTagOptions(): Promise<{ people: { id: number; name: string }[]; buckets: { id: number; name: string }[] }> {
  const [ppl, bks] = await Promise.all([
    db.select({ id: people.id, name: people.name }).from(people).where(eq(people.archived, false)).orderBy(asc(people.name)),
    db.select({ id: savingsBuckets.id, name: savingsBuckets.name }).from(savingsBuckets).where(eq(savingsBuckets.archived, false)).orderBy(asc(savingsBuckets.name)),
  ]);
  return { people: ppl, buckets: bks };
}

/** Links a category to a lender or a bucket (so every future expense in it
 * counts) AND tags the chosen existing expenses, as one unit. With no ids it
 * is just the link. */
export function linkCategoryAndTag(
  categoryId: number,
  link: { debtPersonId?: number; savingsBucketId?: number },
  expenseEntryIds: number[]
): Promise<{ tagged: number; skipped: { id: number; reason: string }[] }> {
  return inTransaction(async () => {
    const category = await db.query.categories.findFirst({ where: eq(categories.id, categoryId) });
    if (!category) throw new Error("That category no longer exists.");
    if (link.debtPersonId !== undefined) {
      const person = await db.query.people.findFirst({ where: eq(people.id, link.debtPersonId) });
      if (!person || person.archived) throw new Error("That lender isn't available.");
      await db.update(categories).set({ linkedDebtPersonId: link.debtPersonId }).where(eq(categories.id, categoryId));
    }
    if (link.savingsBucketId !== undefined) await linkCategoryToBucket(categoryId, link.savingsBucketId);
    return tagCategoryExpenses(categoryId, link, expenseEntryIds);
  });
}
