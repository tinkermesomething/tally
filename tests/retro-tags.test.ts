import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories, debtLedgerEntries, expenseEntries, people, savingsBuckets, savingsEntries } from "@/lib/db/schema";
import { getEntryTags, getTagOptions, linkCategoryAndTag, listMissingTags, setExpenseTags, tagCategoryExpenses } from "@/lib/db/retro-tags";

beforeEach(() => resetDb());

async function seed() {
  const [cat] = await db.insert(categories).values({ name: "Pot" }).returning();
  const [other] = await db.insert(categories).values({ name: "Other" }).returning();
  const [bucket] = await db.insert(savingsBuckets).values({ name: "Trip" }).returning();
  const [bucket2] = await db.insert(savingsBuckets).values({ name: "Car" }).returning();
  const [sam] = await db.insert(people).values({ name: "Sam" }).returning();
  const [kim] = await db.insert(people).values({ name: "Kim" }).returning();
  const mk = async (categoryId: number, amountPence: number, entryDate: string, extra: Partial<typeof expenseEntries.$inferInsert> = {}) =>
    (await db.insert(expenseEntries).values({ categoryId, year: 2026, month: 9, amountPence, entryDate, note: `n${amountPence}`, ...extra }).returning())[0];
  const e1 = await mk(cat.id, 1000, "2026-09-01");
  const e2 = await mk(cat.id, 2000, "2026-09-02");
  const e3 = await mk(cat.id, 3000, "2026-09-03");
  const eOther = await mk(other.id, 9000, "2026-09-04");
  const draft = await mk(cat.id, 500, "2026-09-05", { provisional: true });
  return { cat, other, bucket, bucket2, sam, kim, e1, e2, e3, eOther, draft };
}

describe("expenses in a category missing a tag", () => {
  it("lists confirmed expenses of that category only, newest first, skipping drafts", async () => {
    const { cat, bucket, e1, e2, e3 } = await seed();
    const { rows, total } = await listMissingTags(cat.id, { savingsBucketId: bucket.id });
    expect(rows.map((r) => r.expenseEntryId)).toEqual([e3.id, e2.id, e1.id]);
    expect(total).toBe(3);
    expect(rows.every((r) => r.adds.savings && !r.adds.debt)).toBe(true);
  });

  it("nothing to list without a tag, and already-tagged expenses drop out", async () => {
    const { cat, bucket, sam, e1, e2 } = await seed();
    expect((await listMissingTags(cat.id, {})).total).toBe(0);
    await db.insert(savingsEntries).values({ bucketId: bucket.id, entryDate: e1.entryDate, amountPence: e1.amountPence, direction: "deposit", expenseEntryId: e1.id });
    await db.update(expenseEntries).set({ debtPersonId: sam.id }).where(eq(expenseEntries.id, e2.id));
    const both = await listMissingTags(cat.id, { savingsBucketId: bucket.id, debtPersonId: sam.id });
    const byId = Object.fromEntries(both.rows.map((r) => [r.expenseEntryId, r.adds]));
    expect(byId[e1.id]).toEqual({ debt: true, savings: false });
    expect(byId[e2.id]).toEqual({ debt: false, savings: true });
  });

  it("tags the ticked ones once, and a repeat adds nothing", async () => {
    const { cat, bucket, e1, e2, e3 } = await seed();
    const res = await tagCategoryExpenses(cat.id, { savingsBucketId: bucket.id }, [e1.id, e2.id]);
    expect(res).toMatchObject({ tagged: 2, skipped: [] });
    const deposits = await db.select().from(savingsEntries);
    expect(deposits.map((d) => d.amountPence).sort()).toEqual([1000, 2000]);
    expect(deposits.every((d) => d.bucketId === bucket.id && d.direction === "deposit")).toBe(true);
    const again = await tagCategoryExpenses(cat.id, { savingsBucketId: bucket.id }, [e1.id, e2.id, e3.id]);
    expect(again.tagged).toBe(1); // only e3 was still missing
    expect(again.skipped).toHaveLength(2);
    expect(await db.select().from(savingsEntries)).toHaveLength(3);
  });

  it("refuses ids from another category", async () => {
    const { cat, bucket, eOther } = await seed();
    const res = await tagCategoryExpenses(cat.id, { savingsBucketId: bucket.id }, [eOther.id]);
    expect(res.tagged).toBe(0);
    expect(res.skipped).toHaveLength(1);
    expect(await db.select().from(savingsEntries)).toHaveLength(0);
  });

  it("debt tag writes a repayment row per expense", async () => {
    const { cat, sam, e1, e2 } = await seed();
    await tagCategoryExpenses(cat.id, { debtPersonId: sam.id }, [e1.id, e2.id]);
    const ledger = await db.select().from(debtLedgerEntries);
    expect(ledger.map((l) => [l.personId, l.direction, l.amountPence, l.expenseEntryId]).sort()).toEqual([[sam.id, "repayment", 1000, e1.id], [sam.id, "repayment", 2000, e2.id]].sort());
    expect((await db.select().from(expenseEntries).where(eq(expenseEntries.id, e1.id)))[0].debtPersonId).toBe(sam.id);
  });
});

describe("linking a category and tagging its past expenses together", () => {
  it("sets the bucket link and deposits the ticked expenses", async () => {
    const { cat, bucket, e1, e2 } = await seed();
    const res = await linkCategoryAndTag(cat.id, { savingsBucketId: bucket.id }, [e1.id]);
    expect(res.tagged).toBe(1);
    expect((await db.select().from(categories).where(eq(categories.id, cat.id)))[0].linkedBucketId).toBe(bucket.id);
    expect((await db.select().from(savingsEntries)).map((d) => d.expenseEntryId)).toEqual([e1.id]);
    expect(e2.id).toBeDefined();
  });

  it("sets the person link, with or without expenses ticked", async () => {
    const { cat, sam, e1 } = await seed();
    expect((await linkCategoryAndTag(cat.id, { debtPersonId: sam.id }, [])).tagged).toBe(0);
    expect((await db.select().from(categories).where(eq(categories.id, cat.id)))[0].linkedDebtPersonId).toBe(sam.id);
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(0);
    await linkCategoryAndTag(cat.id, { debtPersonId: sam.id }, [e1.id]);
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(1);
  });

  it("rolls the link back if the person is not available", async () => {
    const { cat } = await seed();
    await expect(linkCategoryAndTag(cat.id, { debtPersonId: 9999 }, [])).rejects.toThrow("not available");
    expect((await db.select().from(categories).where(eq(categories.id, cat.id)))[0].linkedDebtPersonId).toBeNull();
  });
});

describe("tags on one entry", () => {
  it("sets a person and a bucket, shows them, and the balances follow", async () => {
    const { sam, bucket, e1 } = await seed();
    await setExpenseTags(e1.id, { debtPersonId: sam.id, savingsBucketId: bucket.id });
    expect((await getEntryTags([e1.id])).get(e1.id)).toEqual({ debtPersonId: sam.id, savingsBucketId: bucket.id });
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(1);
    expect((await db.select().from(savingsEntries))[0]).toMatchObject({ bucketId: bucket.id, amountPence: 1000, expenseEntryId: e1.id });
  });

  it("changing a tag moves it (no double counting); setting the same one changes nothing", async () => {
    const { sam, kim, bucket, bucket2, e1 } = await seed();
    await setExpenseTags(e1.id, { debtPersonId: sam.id, savingsBucketId: bucket.id });
    await setExpenseTags(e1.id, { debtPersonId: sam.id, savingsBucketId: bucket.id });
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(1);
    expect(await db.select().from(savingsEntries)).toHaveLength(1);
    await setExpenseTags(e1.id, { debtPersonId: kim.id, savingsBucketId: bucket2.id });
    const ledger = await db.select().from(debtLedgerEntries);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].personId).toBe(kim.id);
    const deposits = await db.select().from(savingsEntries);
    expect(deposits).toHaveLength(1);
    expect(deposits[0].bucketId).toBe(bucket2.id);
  });

  it("null clears a tag and removes what it made; undefined leaves it alone", async () => {
    const { sam, bucket, e1 } = await seed();
    await setExpenseTags(e1.id, { debtPersonId: sam.id, savingsBucketId: bucket.id });
    await setExpenseTags(e1.id, { savingsBucketId: null });
    expect(await db.select().from(savingsEntries)).toHaveLength(0);
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(1);
    await setExpenseTags(e1.id, { debtPersonId: null });
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(0);
    expect((await getEntryTags([e1.id])).get(e1.id)).toEqual({ debtPersonId: null, savingsBucketId: null });
  });

  it("refuses an archived or missing person / bucket and a missing entry, changing nothing", async () => {
    const { e1 } = await seed();
    const [gone] = await db.insert(savingsBuckets).values({ name: "Old", archived: true }).returning();
    await expect(setExpenseTags(e1.id, { savingsBucketId: gone.id })).rejects.toThrow("bucket");
    await expect(setExpenseTags(e1.id, { debtPersonId: 9999 })).rejects.toThrow("not available");
    await expect(setExpenseTags(99999, { debtPersonId: null })).rejects.toThrow("no longer exists");
    expect(await db.select().from(savingsEntries)).toHaveLength(0);
  });

  it("a failed change rolls the whole thing back", async () => {
    const { sam, e1 } = await seed();
    await expect(setExpenseTags(e1.id, { debtPersonId: sam.id, savingsBucketId: 9999 })).rejects.toThrow("bucket");
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(0);
    expect((await getEntryTags([e1.id])).get(e1.id)!.debtPersonId).toBeNull();
  });

  it("lists the people and buckets that can be picked, not archived ones", async () => {
    await seed();
    await db.insert(people).values({ name: "Gone", archived: true });
    const o = await getTagOptions();
    expect(o.people.map((p) => p.name)).toEqual(["Kim", "Sam"]);
    expect(o.buckets.map((b) => b.name)).toEqual(["Car", "Trip"]);
  });
});
