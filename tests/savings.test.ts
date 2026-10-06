import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories, expenseEntries, savingsEntries } from "@/lib/db/schema";
import { deleteExpenseEntry, logExpense, updateExpenseEntry } from "@/lib/db/queries";
import {
  addBucket,
  addSavingsEntry,
  archiveBucket,
  getBucket,
  getBucketLedger,
  getBuckets,
  linkCategoryToBucket,
  unarchiveBucket,
  updateBucket,
} from "@/lib/db/savings";
import { BUCKET_COLORS, PRIDE_FLAGS, RGB_COLORS, SPECIAL_DEFAULT_MAIN, balanceOf, flowGradient, bucketColor, bucketPaint, goalStatus, isValidBucketColor, parseBucketColor, progressPercent } from "@/lib/savings-math";

beforeEach(() => resetDb());
const cat = async (name = "Kids savings") => (await db.insert(categories).values({ name }).returning())[0].id;

describe("savings maths", () => {
  it("balance = opening + deposits - withdrawals", () => {
    expect(balanceOf({ openingPence: 1000, depositedPence: 500, withdrawnPence: 200 })).toBe(1300);
  });
  it("progress is clamped to 0-100 and null without a goal", () => {
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(500, 200)).toBe(100);
    expect(progressPercent(-50, 200)).toBe(0);
    expect(progressPercent(50, null)).toBeNull();
    expect(progressPercent(50, 0)).toBeNull();
  });
  it("colour: its own when valid, else a stable palette pick by id", () => {
    expect(bucketColor({ id: 5, color: "#abcdef" })).toBe("#abcdef");
    expect(bucketColor({ id: 1, color: null })).toBe(BUCKET_COLORS[0]);
    expect(bucketColor({ id: 9, color: null })).toBe(BUCKET_COLORS[0]);
    expect(bucketColor({ id: 2, color: "not-a-colour" })).toBe(BUCKET_COLORS[1]);
  });
  it("goal status: none / reached / overdue / per-month", () => {
    const today = "2026-10-06";
    expect(goalStatus({ balancePence: 0, goalPence: 1000, goalDate: null }, today)).toEqual({ kind: "none" });
    expect(goalStatus({ balancePence: 1000, goalPence: 1000, goalDate: "2027-01-01" }, today)).toEqual({ kind: "reached" });
    expect(goalStatus({ balancePence: 0, goalPence: 1000, goalDate: "2026-10-01" }, today)).toMatchObject({ kind: "overdue", daysLate: 5, remainingPence: 1000 });
    // 2027-04-06 is 182 days away = 6 months -> 120000 / 6 = 20000 a month
    expect(goalStatus({ balancePence: 0, goalPence: 120000, goalDate: "2027-04-06" }, today)).toMatchObject({ kind: "on-the-way", remainingPence: 120000, perMonthPence: 20000 });
  });
  it("goal status: the last days never divide by zero (at least one month)", () => {
    expect(goalStatus({ balancePence: 0, goalPence: 3000, goalDate: "2026-10-06" }, "2026-10-06")).toMatchObject({ kind: "on-the-way", daysLeft: 0, perMonthPence: 3000 });
  });
});

describe("bucket colours", () => {
  it("parses every form, and rejects anything else", () => {
    expect(parseBucketColor("")).toEqual({ kind: "auto" });
    expect(parseBucketColor(null)).toEqual({ kind: "auto" });
    expect(parseBucketColor("#aabbcc")).toEqual({ kind: "solid", color: "#aabbcc" });
    expect(parseBucketColor("#aabbcc,#112233")).toEqual({ kind: "duo", colors: ["#aabbcc", "#112233"] });
    expect(parseBucketColor("special:rgb")).toEqual({ kind: "rgb" });
    expect(parseBucketColor("special:trans")).toEqual({ kind: "pride", flag: "trans" });
    for (const bad of ["red", "#abc", "#aabbcc,", "#aabbcc,#zzzzzz", "special:", "special:nope", "#aabbcc,#112233,#445566", "rgb"]) expect(parseBucketColor(bad)).toBeNull();
    expect(parseBucketColor("special:rgb")).toEqual({ kind: "rgb", main: undefined });
    expect(isValidBucketColor("special:rainbow")).toBe(true);
    expect(isValidBucketColor("special:nope")).toBe(false);
  });
  it("two colours paint a gradient and use the first as the accent", () => {
    const p = bucketPaint({ id: 3, color: "#ff0000,#0000ff" });
    expect(p.fill.backgroundImage).toBe("linear-gradient(90deg, #ff0000, #0000ff)");
    expect(p).toMatchObject({ accent: "#ff0000", animated: false });
  });
  it("RGB flows: animated, smoothly blended and seamless (first and last colour match)", () => {
    const p = bucketPaint({ id: 1, color: "special:rgb" });
    expect(p.animated).toBe(true);
    expect(RGB_COLORS[0]).toBe(RGB_COLORS[RGB_COLORS.length - 1]);
    expect(p.fill.backgroundImage).toContain("linear-gradient(90deg, #ff0040");
    expect(p.fill.backgroundImage).not.toMatch(/%/); // blended, not hard-edged bands
  });
  it("EVERY special flows: each colour combination is animated, smooth, loops back to its first colour, and uses all its colours", () => {
    for (const flag of Object.keys(PRIDE_FLAGS) as (keyof typeof PRIDE_FLAGS)[]) {
      const p = bucketPaint({ id: 1, color: `special:${flag}` });
      expect(p.animated).toBe(true);
      expect(p.fill.backgroundImage).not.toMatch(/%/);
      const colors = PRIDE_FLAGS[flag].colors;
      for (const c of colors) expect(p.fill.backgroundImage).toContain(c);
      expect(p.fill.backgroundImage!.endsWith(`${colors[0]})`)).toBe(true); // seamless loop
    }
    expect(PRIDE_FLAGS.rainbow.colors).toHaveLength(6);
  });
  it("a special can carry an optional static main colour, which becomes the accent (text/outline) - the gradient is unchanged", () => {
    expect(parseBucketColor("special:rgb|#112233")).toEqual({ kind: "rgb", main: "#112233" });
    expect(parseBucketColor("special:trans|#abcdef")).toEqual({ kind: "pride", flag: "trans", main: "#abcdef" });
    const withMain = bucketPaint({ id: 1, color: "special:bi|#112233" });
    const without = bucketPaint({ id: 1, color: "special:bi" });
    expect(withMain.accent).toBe("#112233");
    expect(without.accent).toBe(SPECIAL_DEFAULT_MAIN.bi);
    expect(withMain.fill).toEqual(without.fill);
    expect(withMain.animated).toBe(true);
    for (const bad of ["special:rgb|", "special:rgb|red", "special:rgb|#112233|#445566", "special:nope|#112233", "#112233|#445566"]) expect(parseBucketColor(bad)).toBeNull();
  });
  it("flowGradient blends and loops", () => {
    expect(flowGradient(["#111111", "#222222"])).toBe("linear-gradient(90deg, #111111, #222222, #111111)");
    expect(flowGradient(["#111111", "#222222", "#111111"])).toBe("linear-gradient(90deg, #111111, #222222, #111111)");
  });
  it("an unknown stored value falls back to the id-based palette colour (never breaks the page)", () => {
    expect(bucketPaint({ id: 2, color: "garbage" }).accent).toBe(BUCKET_COLORS[1]);
  });
});

describe("buckets", () => {
  it("only the name is required; everything else is optional", async () => {
    const b = await addBucket({ name: "Holiday" });
    expect(b).toMatchObject({ name: "Holiday", goalPence: null, goalDate: null, color: null, openingPence: 0 });
  });
  it("validates what it is given", async () => {
    await expect(addBucket({ name: "  " })).rejects.toThrow(/Name/);
    await expect(addBucket({ name: "x", color: "red" })).rejects.toThrow(/Colour/);
    await expect(addBucket({ name: "x", color: "special:nope" })).rejects.toThrow(/Colour/);
    await expect(addBucket({ name: "x", color: "#aabbcc,red" })).rejects.toThrow(/Colour/);
    await expect(addBucket({ name: "x", goalPence: 0 })).rejects.toThrow(/goal/);
    await expect(addBucket({ name: "x", goalDate: "2026-13-40" })).rejects.toThrow();
    await expect(addBucket({ name: "x", openingPence: -1 })).rejects.toThrow(/opening/);
  });
  it("balance counts opening, deposits and withdrawals; ledger runs from the opening balance", async () => {
    const b = await addBucket({ name: "Holiday", openingPence: 10000 });
    await addSavingsEntry({ bucketId: b.id, entryDate: "2026-10-01", amountPence: 5000, direction: "deposit" });
    await addSavingsEntry({ bucketId: b.id, entryDate: "2026-10-02", amountPence: 2000, direction: "withdrawal", note: "flights" });
    expect((await getBucket(b.id))!.balancePence).toBe(13000);
    const ledger = await getBucketLedger(b.id);
    expect(ledger.entries.map((e) => e.runningBalancePence)).toEqual([15000, 13000]);
    expect(ledger.balancePence).toBe(13000);
  });
  it("accepts two colours, RGB and a pride flag, and stores them as given", async () => {
    for (const color of ["#aabbcc,#112233", "special:rgb", "special:bi", "special:rgb|#aabbcc", "special:pan|#112233"]) {
      const b = await addBucket({ name: color, color });
      expect(b.color).toBe(color);
    }
  });
  it("edit keeps the history; archive hides it from the list but keeps it viewable; restore brings it back", async () => {
    const b = await addBucket({ name: "Holiday" });
    await addSavingsEntry({ bucketId: b.id, entryDate: "2026-10-01", amountPence: 100, direction: "deposit" });
    await updateBucket(b.id, { name: "Holiday 2027", goalPence: 200000, color: "#112233" });
    expect((await getBucket(b.id))).toMatchObject({ name: "Holiday 2027", goalPence: 200000, color: "#112233", balancePence: 100 });
    await archiveBucket(b.id);
    expect((await getBuckets()).length).toBe(0);
    expect((await getBucket(b.id))!.balancePence).toBe(100);
    await unarchiveBucket(b.id);
    expect((await getBuckets()).length).toBe(1);
  });
});

describe("category link", () => {
  it("an expense in a linked category pays into the bucket automatically", async () => {
    const b = await addBucket({ name: "Kids" });
    const c = await cat();
    await linkCategoryToBucket(c, b.id);
    const e = await logExpense({ categoryId: c, amountPence: 2500, entryDate: "2026-10-05", note: "monthly" });
    const rows = await db.select().from(savingsEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bucketId: b.id, amountPence: 2500, direction: "deposit", expenseEntryId: e.id, entryDate: "2026-10-05" });
    expect((await getBucket(b.id))!.balancePence).toBe(2500);
  });
  it("a category with no link, or an explicit bucketId:null, adds nothing", async () => {
    const b = await addBucket({ name: "Kids" });
    const c = await cat();
    await logExpense({ categoryId: c, amountPence: 100, entryDate: "2026-10-05" });
    await linkCategoryToBucket(c, b.id);
    await logExpense({ categoryId: c, amountPence: 100, entryDate: "2026-10-05", bucketId: null });
    expect(await db.select().from(savingsEntries)).toHaveLength(0);
  });
  it("several categories can feed one bucket; an explicit bucketId overrides the link", async () => {
    const a = await addBucket({ name: "A" }), b = await addBucket({ name: "B" });
    const c1 = await cat("One"), c2 = await cat("Two");
    await linkCategoryToBucket(c1, a.id);
    await linkCategoryToBucket(c2, a.id);
    await logExpense({ categoryId: c1, amountPence: 100, entryDate: "2026-10-05" });
    await logExpense({ categoryId: c2, amountPence: 200, entryDate: "2026-10-05" });
    await logExpense({ categoryId: c2, amountPence: 400, entryDate: "2026-10-05", bucketId: b.id });
    expect((await getBucket(a.id))!.balancePence).toBe(300);
    expect((await getBucket(b.id))!.balancePence).toBe(400);
    expect((await getBucket(a.id))!.linkedCategories.map((c) => c.name)).toEqual(["One", "Two"]);
  });
  it("deleting the expense removes its deposit; editing it keeps the deposit in step", async () => {
    const b = await addBucket({ name: "Kids" });
    const c = await cat();
    await linkCategoryToBucket(c, b.id);
    const e1 = await logExpense({ categoryId: c, amountPence: 1000, entryDate: "2026-10-05" });
    const e2 = await logExpense({ categoryId: c, amountPence: 500, entryDate: "2026-10-06" });
    await updateExpenseEntry(e1.id, { amountPence: 1200, entryDate: "2026-10-07" });
    const edited = (await db.select().from(savingsEntries).where(eq(savingsEntries.expenseEntryId, e1.id)))[0];
    expect(edited).toMatchObject({ amountPence: 1200, entryDate: "2026-10-07" });
    await deleteExpenseEntry(e2.id);
    expect((await getBucket(b.id))!.balancePence).toBe(1200);
  });
  it("a hand-typed deposit is never touched by expense edits or deletes", async () => {
    const b = await addBucket({ name: "Kids" });
    await addSavingsEntry({ bucketId: b.id, entryDate: "2026-10-01", amountPence: 999, direction: "deposit" });
    const c = await cat();
    await linkCategoryToBucket(c, b.id);
    const e = await logExpense({ categoryId: c, amountPence: 100, entryDate: "2026-10-05" });
    await deleteExpenseEntry(e.id);
    expect((await getBucket(b.id))!.balancePence).toBe(999);
  });
  it("unlinking stops new deposits but keeps the ones already made", async () => {
    const b = await addBucket({ name: "Kids" });
    const c = await cat();
    await linkCategoryToBucket(c, b.id);
    await logExpense({ categoryId: c, amountPence: 100, entryDate: "2026-10-05" });
    await linkCategoryToBucket(c, null);
    await logExpense({ categoryId: c, amountPence: 100, entryDate: "2026-10-06" });
    expect((await getBucket(b.id))!.balancePence).toBe(100);
  });
  it("back-fill adds past expenses from the chosen date, once each, even if linked twice", async () => {
    const b = await addBucket({ name: "Kids" });
    const c = await cat();
    await logExpense({ categoryId: c, amountPence: 100, entryDate: "2026-01-10" });
    await logExpense({ categoryId: c, amountPence: 200, entryDate: "2026-06-10" });
    await logExpense({ categoryId: c, amountPence: 400, entryDate: "2026-09-10" });
    expect(await linkCategoryToBucket(c, b.id, { backfillFrom: "2026-06-01" })).toBe(2);
    expect((await getBucket(b.id))!.balancePence).toBe(600);
    expect(await linkCategoryToBucket(c, b.id, { backfillFrom: "2026-01-01" })).toBe(1); // only Jan is new
    expect((await getBucket(b.id))!.balancePence).toBe(700);
  });
  it("linking without a back-fill date adds nothing for the past", async () => {
    const b = await addBucket({ name: "Kids" });
    const c = await cat();
    await logExpense({ categoryId: c, amountPence: 100, entryDate: "2026-01-10" });
    expect(await linkCategoryToBucket(c, b.id)).toBe(0);
    expect((await getBucket(b.id))!.balancePence).toBe(0);
  });
  it("refuses an archived or missing bucket, and a missing category", async () => {
    const b = await addBucket({ name: "Kids" });
    const c = await cat();
    await archiveBucket(b.id);
    await expect(linkCategoryToBucket(c, b.id)).rejects.toThrow(/available/);
    await expect(linkCategoryToBucket(c, 999)).rejects.toThrow(/available/);
    await expect(linkCategoryToBucket(999, null)).rejects.toThrow(/category/);
  });
  it("a failed back-fill leaves nothing half-done (link and deposits roll back together)", async () => {
    const b = await addBucket({ name: "Kids" });
    const c = await cat();
    await expect(linkCategoryToBucket(c, b.id, { backfillFrom: "nonsense" })).rejects.toThrow();
    expect((await db.select().from(categories).where(eq(categories.id, c)))[0].linkedBucketId).toBeNull();
  });
  it("entry validation: amounts must be positive whole pence", async () => {
    const b = await addBucket({ name: "Kids" });
    await expect(addSavingsEntry({ bucketId: b.id, entryDate: "2026-10-01", amountPence: 0, direction: "deposit" })).rejects.toThrow();
    await expect(addSavingsEntry({ bucketId: b.id, entryDate: "2026-10-01", amountPence: 1.5, direction: "deposit" })).rejects.toThrow();
    await expect(addSavingsEntry({ bucketId: b.id, entryDate: "bad", amountPence: 5, direction: "deposit" })).rejects.toThrow();
    expect(await db.select().from(expenseEntries)).toHaveLength(0);
  });
});
