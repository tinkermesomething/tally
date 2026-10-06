import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, inTransaction } from "./index";
import { assertIsoDate } from "../validate";
import { balanceOf, isValidBucketColor } from "../savings-math";
import { categories, expenseEntries, savingsBuckets, savingsEntries } from "./schema";

export type BucketSummary = {
  id: number;
  name: string;
  color: string | null;
  goalPence: number | null;
  goalDate: string | null;
  openingPence: number;
  note: string | null;
  depositedPence: number;
  withdrawnPence: number;
  balancePence: number;
  entryCount: number;
  linkedCategories: { id: number; name: string }[];
};

export type SavingsLedgerRow = {
  id: number;
  entryDate: string;
  amountPence: number;
  direction: "deposit" | "withdrawal";
  note: string | null;
  /** From an expense in a linked category (not typed in by hand). */
  auto: boolean;
  runningBalancePence: number;
};

export type BucketInput = {
  name: string;
  color?: string | null;
  goalPence?: number | null;
  goalDate?: string | null;
  openingPence?: number;
  note?: string | null;
};

/** Cleans and validates what a bucket form sends. Everything but the name is
 * optional; empty strings mean "not set". */
function cleanBucketInput(input: BucketInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Name can't be empty.");
  if (name.length > 80) throw new Error("Name is too long.");
  const color = input.color ? input.color.trim() : null;
  if (color && !isValidBucketColor(color)) throw new Error("Colour isn't valid.");
  const goalPence = input.goalPence ?? null;
  if (goalPence !== null && (!Number.isInteger(goalPence) || goalPence <= 0)) throw new Error("The goal must be more than zero.");
  const goalDate = input.goalDate ? input.goalDate : null;
  if (goalDate) assertIsoDate(goalDate);
  const openingPence = input.openingPence ?? 0;
  if (!Number.isInteger(openingPence) || openingPence < 0) throw new Error("The opening balance can't be negative.");
  const note = input.note?.trim() ? input.note.trim().slice(0, 300) : null;
  return { name, color, goalPence, goalDate, openingPence, note };
}

export async function addBucket(input: BucketInput) {
  const [created] = await db.insert(savingsBuckets).values(cleanBucketInput(input)).returning();
  return created;
}

export async function updateBucket(id: number, input: BucketInput) {
  const [updated] = await db.update(savingsBuckets).set(cleanBucketInput(input)).where(eq(savingsBuckets.id, id)).returning();
  if (!updated) throw new Error("That bucket no longer exists.");
  return updated;
}

/** Soft-delete: the history stays, the bucket just leaves the page. Linked
 * categories keep their link, so new expenses still pay in. */
export async function archiveBucket(id: number) {
  await db.update(savingsBuckets).set({ archived: true }).where(eq(savingsBuckets.id, id));
}

export async function unarchiveBucket(id: number) {
  await db.update(savingsBuckets).set({ archived: false }).where(eq(savingsBuckets.id, id));
}

export async function getArchivedBuckets() {
  return db.query.savingsBuckets.findMany({
    where: eq(savingsBuckets.archived, true),
    orderBy: (b, { asc }) => [asc(b.name)],
  });
}

async function linkedCategoriesByBucket(bucketIds: number[]) {
  const map = new Map<number, { id: number; name: string }[]>();
  if (bucketIds.length === 0) return map;
  const rows = await db
    .select({ id: categories.id, name: categories.name, bucketId: categories.linkedBucketId })
    .from(categories)
    .where(and(inArray(categories.linkedBucketId, bucketIds), isNull(categories.archivedAt)))
    .orderBy(asc(categories.name));
  for (const r of rows) {
    const list = map.get(r.bucketId!) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.bucketId!, list);
  }
  return map;
}

/** Every active bucket with its balance. One aggregate query, not one per
 * bucket. */
export async function getBuckets(): Promise<BucketSummary[]> {
  const rows = await db
    .select({
      id: savingsBuckets.id,
      name: savingsBuckets.name,
      color: savingsBuckets.color,
      goalPence: savingsBuckets.goalPence,
      goalDate: savingsBuckets.goalDate,
      openingPence: savingsBuckets.openingPence,
      note: savingsBuckets.note,
      depositedPence: sql<number>`coalesce(sum(case when ${savingsEntries.direction} = 'deposit' then ${savingsEntries.amountPence} else 0 end), 0)`,
      withdrawnPence: sql<number>`coalesce(sum(case when ${savingsEntries.direction} = 'withdrawal' then ${savingsEntries.amountPence} else 0 end), 0)`,
      entryCount: sql<number>`count(${savingsEntries.id})`,
    })
    .from(savingsBuckets)
    .leftJoin(savingsEntries, eq(savingsEntries.bucketId, savingsBuckets.id))
    .where(eq(savingsBuckets.archived, false))
    .groupBy(savingsBuckets.id)
    .orderBy(asc(savingsBuckets.id));
  const linked = await linkedCategoriesByBucket(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, balancePence: balanceOf(r), linkedCategories: linked.get(r.id) ?? [] }));
}

export async function getBucket(id: number): Promise<BucketSummary | null> {
  const all = await getBuckets();
  const found = all.find((b) => b.id === id);
  if (found) return found;
  // An archived bucket is still viewable by its link.
  const row = await db.query.savingsBuckets.findFirst({ where: eq(savingsBuckets.id, id) });
  if (!row) return null;
  const [totals] = await db
    .select({
      depositedPence: sql<number>`coalesce(sum(case when ${savingsEntries.direction} = 'deposit' then ${savingsEntries.amountPence} else 0 end), 0)`,
      withdrawnPence: sql<number>`coalesce(sum(case when ${savingsEntries.direction} = 'withdrawal' then ${savingsEntries.amountPence} else 0 end), 0)`,
      entryCount: sql<number>`count(*)`,
    })
    .from(savingsEntries)
    .where(eq(savingsEntries.bucketId, id));
  const linked = await linkedCategoriesByBucket([id]);
  return { ...row, ...totals, balancePence: balanceOf({ openingPence: row.openingPence, ...totals }), linkedCategories: linked.get(id) ?? [] };
}

export async function getBucketLedger(bucketId: number): Promise<{ openingPence: number; entries: SavingsLedgerRow[]; balancePence: number }> {
  const bucket = await db.query.savingsBuckets.findFirst({ where: eq(savingsBuckets.id, bucketId) });
  const entries = await db
    .select()
    .from(savingsEntries)
    .where(eq(savingsEntries.bucketId, bucketId))
    .orderBy(asc(savingsEntries.entryDate), asc(savingsEntries.id));
  let running = bucket?.openingPence ?? 0;
  const rows: SavingsLedgerRow[] = entries.map((e) => {
    running += e.direction === "deposit" ? e.amountPence : -e.amountPence;
    return {
      id: e.id,
      entryDate: e.entryDate,
      amountPence: e.amountPence,
      direction: e.direction,
      note: e.note,
      auto: e.expenseEntryId !== null,
      runningBalancePence: running,
    };
  });
  return { openingPence: bucket?.openingPence ?? 0, entries: rows, balancePence: running };
}

export async function addSavingsEntry(input: {
  bucketId: number;
  entryDate: string;
  amountPence: number;
  direction: "deposit" | "withdrawal";
  note?: string | null;
  expenseEntryId?: number;
}) {
  assertIsoDate(input.entryDate);
  if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) throw new Error("Amount must be greater than zero.");
  await db.insert(savingsEntries).values({
    bucketId: input.bucketId,
    entryDate: input.entryDate,
    amountPence: input.amountPence,
    direction: input.direction,
    note: input.note?.trim() || null,
    expenseEntryId: input.expenseEntryId,
  });
}

export async function updateSavingsEntry(
  id: number,
  input: { amountPence?: number; direction?: "deposit" | "withdrawal"; entryDate?: string; note?: string | null }
) {
  const set: Partial<typeof savingsEntries.$inferInsert> = {};
  if (input.amountPence !== undefined) {
    if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) throw new Error("Amount must be greater than zero.");
    set.amountPence = input.amountPence;
  }
  if (input.direction !== undefined) set.direction = input.direction;
  if (input.entryDate !== undefined) {
    assertIsoDate(input.entryDate);
    set.entryDate = input.entryDate;
  }
  if (input.note !== undefined) set.note = input.note?.trim() || null;
  await db.update(savingsEntries).set(set).where(eq(savingsEntries.id, id));
}

export async function deleteSavingsEntry(id: number) {
  await db.delete(savingsEntries).where(eq(savingsEntries.id, id));
}

/** Deleting an expense removes the deposit it created. */
export async function deleteSavingsEntriesForExpense(expenseEntryId: number) {
  await db.delete(savingsEntries).where(eq(savingsEntries.expenseEntryId, expenseEntryId));
}

/** Editing an expense's amount or date keeps its deposit in step. */
export async function syncSavingsEntriesForExpense(
  expenseEntryId: number,
  changes: { amountPence?: number; entryDate?: string }
) {
  const set: Partial<typeof savingsEntries.$inferInsert> = {};
  if (changes.amountPence !== undefined) set.amountPence = changes.amountPence;
  if (changes.entryDate !== undefined) set.entryDate = changes.entryDate;
  if (Object.keys(set).length === 0) return;
  await db.update(savingsEntries).set(set).where(eq(savingsEntries.expenseEntryId, expenseEntryId));
}

/** Links (or, with null, unlinks) a category to a bucket: from then on every
 * expense in it pays into the bucket. `backfillFrom` also adds deposits for
 * the category's existing expenses dated on/after that day - each expense
 * only once per bucket, so linking twice never double-counts. Unlinking
 * leaves the deposits already made. Returns how many deposits were added. */
export function linkCategoryToBucket(categoryId: number, bucketId: number | null, options: { backfillFrom?: string } = {}) {
  return inTransaction(async () => {
    const category = await db.query.categories.findFirst({ where: eq(categories.id, categoryId) });
    if (!category) throw new Error("That category no longer exists.");
    if (bucketId === null) {
      await db.update(categories).set({ linkedBucketId: null }).where(eq(categories.id, categoryId));
      return 0;
    }
    const bucket = await db.query.savingsBuckets.findFirst({ where: eq(savingsBuckets.id, bucketId) });
    if (!bucket || bucket.archived) throw new Error("That bucket isn't available.");
    await db.update(categories).set({ linkedBucketId: bucketId }).where(eq(categories.id, categoryId));
    if (!options.backfillFrom) return 0;
    assertIsoDate(options.backfillFrom);
    const expenses = await db
      .select()
      .from(expenseEntries)
      .where(and(eq(expenseEntries.categoryId, categoryId), gte(expenseEntries.entryDate, options.backfillFrom)));
    const already = new Set(
      (await db.select({ id: savingsEntries.expenseEntryId }).from(savingsEntries).where(eq(savingsEntries.bucketId, bucketId))).map((r) => r.id)
    );
    let added = 0;
    for (const e of expenses) {
      if (already.has(e.id) || e.amountPence <= 0) continue;
      await addSavingsEntry({
        bucketId,
        entryDate: e.entryDate,
        amountPence: e.amountPence,
        direction: "deposit",
        note: e.note,
        expenseEntryId: e.id,
      });
      added++;
    }
    return added;
  });
}
