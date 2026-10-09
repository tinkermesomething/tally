import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import {
  bankAccounts,
  categories,
  expenseEntries,
  importedTransactions,
  incomeEntries,
  incomeSources,
  debtLedgerEntries,
  people,
  savingsBuckets,
  savingsEntries,
} from "@/lib/db/schema";

const gc = vi.hoisted(() => ({ getAccountTransactions: vi.fn() }));
vi.mock("@/lib/gocardless", async (orig) => ({
  ...(await orig<typeof import("@/lib/gocardless")>()),
  getAccountTransactions: gc.getAccountTransactions,
}));

const debt = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/db/debt", async (orig) => {
  const real = await orig<typeof import("@/lib/db/debt")>();
  return {
    ...real,
    addDebtEntry: (...args: Parameters<typeof real.addDebtEntry>) => {
      if (debt.fail) throw new Error("boom");
      return real.addDebtEntry(...args);
    },
  };
});

import {
  addCategoryRule,
  syncAllBankAccounts,
  categorizeTransaction,
  categorizeTransactionAsIncome,
  ignoreTransaction,
  restoreTransaction,
  createRuleAndCategorize,
  getPendingPreview,
  previewRuleMatches,
  stageImportedTransactions,
  syncBankAccount,
  updateRuleAndCategorize,
} from "@/lib/db/bank-sync";

async function seedAccount(lastSyncedAt: Date | null = null) {
  const [a] = await db
    .insert(bankAccounts)
    .values({
      provider: "gocardless",
      institutionId: "i",
      requisitionId: "r",
      externalAccountId: "ext-1",
      displayName: "Test",
      consentExpiresAt: new Date(Date.now() + 1e9),
      lastSyncedAt,
    })
    .returning();
  return a;
}

async function stageOne(accountId: number, amountPence: number, id = "t1") {
  await stageImportedTransactions(accountId, [
    { importedId: id, amountPence, bookingDate: "2026-09-10", payeeRaw: "SHOP" },
  ]);
  return (await db.select().from(importedTransactions).where(eq(importedTransactions.importedId, id)))[0];
}

beforeEach(() => {
  resetDb();
  debt.fail = false;
  gc.getAccountTransactions.mockReset();
});

describe("status guards", () => {
  it("restoreTransaction must not reopen a categorized row", async () => {
    const acct = await seedAccount();
    const [cat] = await db.insert(categories).values({ name: "Food" }).returning();
    const row = await stageOne(acct.id, -500);
    await categorizeTransaction(row.id, { categoryId: cat.id });

    await expect(restoreTransaction(row.id)).rejects.toThrow();
    const after = (await db.select().from(importedTransactions))[0];
    expect(after.status).toBe("categorized");
  });

  it("restoreTransaction still reopens an ignored row", async () => {
    const acct = await seedAccount();
    const row = await stageOne(acct.id, -500);
    await ignoreTransaction(row.id);
    await restoreTransaction(row.id);
    expect((await db.select().from(importedTransactions))[0].status).toBe("pending_review");
  });

  it("ignoreTransaction must not ignore a categorized row", async () => {
    const acct = await seedAccount();
    const [cat] = await db.insert(categories).values({ name: "Food" }).returning();
    const row = await stageOne(acct.id, -500);
    await categorizeTransaction(row.id, { categoryId: cat.id });

    await expect(ignoreTransaction(row.id)).rejects.toThrow();
    expect((await db.select().from(importedTransactions))[0].status).toBe("categorized");
  });
});

describe("atomicity", () => {
  it("income categorize rolls back fully when the debt step fails", async () => {
    const acct = await seedAccount();
    const [src] = await db.insert(incomeSources).values({ name: "Gifts" }).returning();
    const [person] = await db.insert(people).values({ name: "Bob" }).returning();
    const row = await stageOne(acct.id, 5000);

    debt.fail = true;
    await expect(
      categorizeTransactionAsIncome(row.id, { incomeSourceId: src.id, debtPersonId: person.id })
    ).rejects.toThrow("boom");

    expect(await db.select().from(incomeEntries)).toHaveLength(0); // no half-written income
    expect((await db.select().from(importedTransactions))[0].status).toBe("pending_review");

    // And a retry must count it exactly once.
    debt.fail = false;
    await categorizeTransactionAsIncome(row.id, { incomeSourceId: src.id, debtPersonId: person.id });
    const entries = await db.select().from(incomeEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0].amountPence).toBe(5000);
  });

  it("expense categorize leaves no expense behind when the debt ledger write fails", async () => {
    const acct = await seedAccount();
    const [person] = await db.insert(people).values({ name: "Bob" }).returning();
    const [cat] = await db.insert(categories).values({ name: "Bob", linkedDebtPersonId: person.id }).returning();
    const row = await stageOne(acct.id, -700);

    debt.fail = true;
    await expect(categorizeTransaction(row.id, { categoryId: cat.id })).rejects.toThrow("boom");
    expect(await db.select().from(expenseEntries)).toHaveLength(0);
  });
});

describe("sync", () => {
  it("re-fetches with an overlap window so late-reported transactions are not missed", async () => {
    const lastSynced = new Date("2026-09-20T12:00:00Z");
    const acct = await seedAccount(lastSynced);
    gc.getAccountTransactions.mockResolvedValue({ booked: [], pending: [] });
    await syncBankAccount(acct.id);
    const dateFrom: string = gc.getAccountTransactions.mock.calls[0][1];
    expect(dateFrom < "2026-09-20").toBe(true);
    expect(dateFrom >= "2026-09-10").toBe(true); // overlap is a few days, not weeks
  });

  it("one malformed booked item does not abort the rest of the account", async () => {
    const acct = await seedAccount();
    gc.getAccountTransactions.mockResolvedValue({
      booked: [
        { transactionId: "bad", transactionAmount: { amount: "-1.00", currency: "GBP" } }, // no bookingDate
        { transactionId: "good", bookingDate: "2026-09-10", transactionAmount: { amount: "-2.00", currency: "GBP" }, creditorName: "X" },
      ],
      pending: [],
    });
    const res = await syncBankAccount(acct.id);
    expect(res.staged).toBe(1);
    expect((await db.select().from(importedTransactions)).map((r) => r.importedId)).toEqual(["good"]);
    expect((await db.select().from(bankAccounts))[0].lastSyncedAt).not.toBeNull();
  });
});

describe("rules", () => {
  it("a stored rule auto-categorizes a matching row on import and leaves others for review", async () => {
    const acct = await seedAccount();
    const [cat] = await db.insert(categories).values({ name: "Food" }).returning();
    await addCategoryRule({
      conditions: [{ field: "payee", operator: "contains", value: "tesco" }],
      targetType: "expense",
      categoryId: cat.id,
    });
    await stageImportedTransactions(acct.id, [
      { importedId: "a", amountPence: -500, bookingDate: "2026-09-10", payeeRaw: "TESCO STORES 1" },
      { importedId: "b", amountPence: -700, bookingDate: "2026-09-10", payeeRaw: "SOMEWHERE ELSE" },
    ]);
    const rows = await db.select().from(importedTransactions);
    expect(rows.find((r) => r.importedId === "a")!.status).toBe("categorized");
    expect(rows.find((r) => r.importedId === "b")!.status).toBe("pending_review");
    expect(await db.select().from(expenseEntries)).toHaveLength(1);
  });

  it("refuses a rule whose target no longer exists", async () => {
    const cond = [{ field: "payee" as const, operator: "contains" as const, value: "x" }];
    await expect(addCategoryRule({ conditions: cond, targetType: "expense", categoryId: 999 })).rejects.toThrow("category");
    await expect(addCategoryRule({ conditions: cond, targetType: "income", incomeSourceId: 999 })).rejects.toThrow("income source");
    const [cat] = await db.insert(categories).values({ name: "Food" }).returning();
    await expect(addCategoryRule({ conditions: cond, targetType: "expense", categoryId: cat.id, debtPersonId: 999 })).rejects.toThrow("person");
    await expect(addCategoryRule({ conditions: [{ field: "account", operator: "is", value: "999" }], targetType: "ignore" })).rejects.toThrow("bank account");
  });
});

describe("rules that count towards savings", () => {
  const payee = [{ field: "payee" as const, operator: "contains" as const, value: "revolut" }];

  it("an imported match is also deposited into the rule's bucket", async () => {
    const acct = await seedAccount();
    const [cat] = await db.insert(categories).values({ name: "Savings transfer" }).returning();
    const [bucket] = await db.insert(savingsBuckets).values({ name: "Holiday" }).returning();
    await addCategoryRule({ conditions: payee, targetType: "expense", categoryId: cat.id, savingsBucketId: bucket.id });
    await stageImportedTransactions(acct.id, [{ importedId: "r1", amountPence: -2500, bookingDate: "2026-09-10", payeeRaw: "REVOLUT POT" }]);
    const deposits = await db.select().from(savingsEntries);
    expect(deposits).toHaveLength(1);
    expect(deposits[0]).toMatchObject({ bucketId: bucket.id, amountPence: 2500, direction: "deposit" });
  });

  it("a rule with no bucket leaves the category's own link alone", async () => {
    const acct = await seedAccount();
    const [bucket] = await db.insert(savingsBuckets).values({ name: "Car" }).returning();
    const [cat] = await db.insert(categories).values({ name: "Car fund", linkedBucketId: bucket.id }).returning();
    await addCategoryRule({ conditions: payee, targetType: "expense", categoryId: cat.id });
    await stageImportedTransactions(acct.id, [{ importedId: "r2", amountPence: -1000, bookingDate: "2026-09-10", payeeRaw: "REVOLUT" }]);
    expect((await db.select().from(savingsEntries))[0]).toMatchObject({ bucketId: bucket.id, amountPence: 1000 });
  });

  it("refuses a missing or archived bucket", async () => {
    const [cat] = await db.insert(categories).values({ name: "Food" }).returning();
    await expect(addCategoryRule({ conditions: payee, targetType: "expense", categoryId: cat.id, savingsBucketId: 999 })).rejects.toThrow("savings bucket");
    const [b] = await db.insert(savingsBuckets).values({ name: "Old", archived: true }).returning();
    await expect(addCategoryRule({ conditions: payee, targetType: "expense", categoryId: cat.id, savingsBucketId: b.id })).rejects.toThrow("savings bucket");
  });
});

describe("editing a rule applies it to waiting transactions", () => {
  const payee = (v: string) => [{ field: "payee" as const, operator: "contains" as const, value: v }];

  it("re-targets the ticked waiting rows, and leaves already-categorized ones", async () => {
    const acct = await seedAccount();
    const [food] = await db.insert(categories).values({ name: "Food" }).returning();
    const [fun] = await db.insert(categories).values({ name: "Fun" }).returning();
    const rule = await addCategoryRule({ conditions: payee("tesco"), targetType: "expense", categoryId: food.id });
    // Already handled by the old version of the rule.
    await stageImportedTransactions(acct.id, [{ importedId: "old", amountPence: -300, bookingDate: "2026-09-01", payeeRaw: "TESCO 1" }]);
    // The rule is edited to catch more (cinema too) and to point at Fun; two rows are waiting.
    await stageImportedTransactions(acct.id, [
      { importedId: "w1", amountPence: -800, bookingDate: "2026-09-02", payeeRaw: "VUE CINEMA" },
      { importedId: "w2", amountPence: -900, bookingDate: "2026-09-03", payeeRaw: "VUE CINEMA 2" },
    ]);
    const waiting = (await db.select().from(importedTransactions)).filter((r) => r.status === "pending_review");
    expect(waiting).toHaveLength(2);

    const res = await updateRuleAndCategorize(rule.id, {
      conditions: payee("cinema"),
      target: { targetType: "expense", categoryId: fun.id },
      applyToIds: [waiting[0].id],
    });
    expect(res).toMatchObject({ ruleId: rule.id, categorized: 1, skipped: [] });
    const rows = await db.select().from(importedTransactions);
    expect(rows.find((r) => r.id === waiting[0].id)!.status).toBe("categorized");
    expect(rows.find((r) => r.id === waiting[1].id)!.status).toBe("pending_review"); // not ticked
    const entries = await db.select().from(expenseEntries);
    expect(entries.find((e) => e.importedTransactionId === waiting[0].id)!.categoryId).toBe(fun.id);
    // The row the old rule already filed under Food is untouched.
    expect(entries.find((e) => e.amountPence === 300)!.categoryId).toBe(food.id);
  });

  it("only applies rows the edited rule really matches", async () => {
    const acct = await seedAccount();
    const [food] = await db.insert(categories).values({ name: "Food" }).returning();
    const rule = await addCategoryRule({ conditions: payee("tesco"), targetType: "expense", categoryId: food.id });
    await stageImportedTransactions(acct.id, [{ importedId: "x", amountPence: -100, bookingDate: "2026-09-02", payeeRaw: "SOMEWHERE" }]);
    const [row] = await db.select().from(importedTransactions);
    const res = await updateRuleAndCategorize(rule.id, {
      conditions: payee("tesco"),
      target: { targetType: "expense", categoryId: food.id },
      applyToIds: [row.id],
    });
    expect(res.categorized).toBe(0);
    expect(res.skipped).toHaveLength(1);
    expect((await db.select().from(importedTransactions))[0].status).toBe("pending_review");
  });

  it("counts only EARLIER rules as already claiming a row, not the rule being edited", async () => {
    const acct = await seedAccount();
    const [food] = await db.insert(categories).values({ name: "Food" }).returning();
    const [fun] = await db.insert(categories).values({ name: "Fun" }).returning();
    const first = await addCategoryRule({ conditions: payee("zzz"), targetType: "expense", categoryId: food.id });
    const second = await addCategoryRule({ conditions: payee("yyy"), targetType: "expense", categoryId: fun.id });
    await stageImportedTransactions(acct.id, [{ importedId: "p", amountPence: -100, bookingDate: "2026-09-02", payeeRaw: "ZZZ YYY SHOP" }]);
    // Matches both rules' text; the row was claimed by `first` on import.
    expect((await db.select().from(importedTransactions))[0].status).toBe("categorized");
    await db.update(importedTransactions).set({ status: "pending_review" });
    const asSecond = await previewRuleMatches(payee("yyy"), "expense", second.id);
    expect(asSecond.alreadyCoveredByEarlierRule).toBe(1); // `first` comes before it
    const asFirst = await previewRuleMatches(payee("zzz"), "expense", first.id);
    expect(asFirst.alreadyCoveredByEarlierRule).toBe(0); // nothing before the first rule
  });
});

describe("adding a forgotten debt / savings tag to past expenses", () => {
  const cond = [{ field: "payee" as const, operator: "contains" as const, value: "revolut" }];

  async function pastExpenses() {
    const acct = await seedAccount();
    const [pot] = await db.insert(categories).values({ name: "Savings transfer" }).returning();
    const [other] = await db.insert(categories).values({ name: "Misc" }).returning();
    const [bucket] = await db.insert(savingsBuckets).values({ name: "Holiday" }).returning();
    const [sam] = await db.insert(people).values({ name: "Sam" }).returning();
    // the rule was made WITHOUT any tag, so these were filed with none
    const rule = await addCategoryRule({ conditions: cond, targetType: "expense", categoryId: pot.id });
    await stageImportedTransactions(acct.id, [
      { importedId: "p1", amountPence: -2500, bookingDate: "2026-09-10", payeeRaw: "REVOLUT POT" },
      { importedId: "p2", amountPence: -1500, bookingDate: "2026-09-11", payeeRaw: "REVOLUT POT 2" },
      { importedId: "p3", amountPence: -700, bookingDate: "2026-09-12", payeeRaw: "SOMEWHERE ELSE" },
    ]);
    // one matching expense was filed by hand under a different category
    await stageImportedTransactions(acct.id, [{ importedId: "p4", amountPence: -900, bookingDate: "2026-09-13", payeeRaw: "REVOLUT ODD" }]);
    const odd = (await db.select().from(importedTransactions)).find((r) => r.importedId === "p4")!;
    if (odd.status === "categorized") await db.update(expenseEntries).set({ categoryId: other.id }).where(eq(expenseEntries.importedTransactionId, odd.id));
    else await categorizeTransaction(odd.id, { categoryId: other.id });
    return { rule, pot, other, bucket, sam };
  }

  it("the preview lists the past matching expenses that lack the tag, and counts ones in another category", async () => {
    const { pot, bucket } = await pastExpenses();
    const pv = await previewRuleMatches(cond, "expense", undefined, { categoryId: pot.id, savingsBucketId: bucket.id });
    expect(pv.retro!.rows.map((r) => r.payeeRaw).sort()).toEqual(["REVOLUT POT", "REVOLUT POT 2"]);
    expect(pv.retro!.rows.every((r) => r.adds.savings && !r.adds.debt)).toBe(true);
    expect(pv.retro!.otherCategory).toBe(1);
    expect(pv.retro!.total).toBe(2);
  });

  it("a lender or bucket still to be created (id -1 in the preview) lists the same past expenses", async () => {
    const { pot } = await pastExpenses();
    const pv = await previewRuleMatches(cond, "expense", undefined, { categoryId: pot.id, savingsBucketId: -1, debtPersonId: -1 });
    expect(pv.retro!.rows).toHaveLength(2);
    expect(pv.retro!.rows.every((r) => r.adds.savings && r.adds.debt)).toBe(true);
  });

  it("no tag on the rule means nothing to retro-fit", async () => {
    const { pot } = await pastExpenses();
    expect((await previewRuleMatches(cond, "expense", undefined, { categoryId: pot.id })).retro).toMatchObject({ rows: [], total: 0 });
    expect((await previewRuleMatches(cond, "expense")).retro).toBeNull();
    expect((await previewRuleMatches(cond, "income", undefined, { categoryId: pot.id, savingsBucketId: 1 })).retro).toBeNull();
  });

  it("saving the edited rule with the ticked rows adds the savings deposits, once", async () => {
    const { rule, pot, bucket } = await pastExpenses();
    const pv = await previewRuleMatches(cond, "expense", rule.id, { categoryId: pot.id, savingsBucketId: bucket.id });
    const res = await updateRuleAndCategorize(rule.id, {
      conditions: cond,
      target: { targetType: "expense", categoryId: pot.id, savingsBucketId: bucket.id },
      applyToIds: [],
      tagExpenseIds: pv.retro!.rows.map((r) => r.expenseEntryId),
    });
    expect(res).toMatchObject({ tagged: 2, categorized: 0, skipped: [] });
    const deposits = await db.select().from(savingsEntries);
    expect(deposits).toHaveLength(2);
    expect(deposits.reduce((sum, d) => sum + d.amountPence, 0)).toBe(4000);
    expect(deposits.every((d) => d.bucketId === bucket.id && d.direction === "deposit" && d.expenseEntryId !== null)).toBe(true);
    // asking again finds nothing left to do (no double counting)
    expect((await previewRuleMatches(cond, "expense", rule.id, { categoryId: pot.id, savingsBucketId: bucket.id })).retro!.total).toBe(0);
    const again = await updateRuleAndCategorize(rule.id, { conditions: cond, target: { targetType: "expense", categoryId: pot.id, savingsBucketId: bucket.id }, applyToIds: [], tagExpenseIds: pv.retro!.rows.map((r) => r.expenseEntryId) });
    expect(again.tagged).toBe(0);
    expect(again.skipped).toHaveLength(2);
    expect(await db.select().from(savingsEntries)).toHaveLength(2);
  });

  it("the debt tag adds a repayment to the ledger and tags the expense", async () => {
    const { rule, pot, sam } = await pastExpenses();
    const pv = await previewRuleMatches(cond, "expense", rule.id, { categoryId: pot.id, debtPersonId: sam.id });
    expect(pv.retro!.rows.every((r) => r.adds.debt && !r.adds.savings)).toBe(true);
    const res = await updateRuleAndCategorize(rule.id, {
      conditions: cond,
      target: { targetType: "expense", categoryId: pot.id, debtPersonId: sam.id },
      applyToIds: [],
      tagExpenseIds: pv.retro!.rows.map((r) => r.expenseEntryId),
    });
    expect(res.tagged).toBe(2);
    const ledger = await db.select().from(debtLedgerEntries);
    expect(ledger).toHaveLength(2);
    expect(ledger.every((l) => l.personId === sam.id && l.direction === "repayment" && l.expenseEntryId !== null)).toBe(true);
    expect(ledger.reduce((sum, l) => sum + l.amountPence, 0)).toBe(4000);
    expect((await db.select().from(expenseEntries)).filter((e) => e.debtPersonId === sam.id)).toHaveLength(2);
  });

  it("both tags together, and only what is missing is added", async () => {
    const { rule, pot, bucket, sam } = await pastExpenses();
    // one of the two already has its deposit
    const entries = await db.select().from(expenseEntries).where(eq(expenseEntries.categoryId, pot.id));
    const first = entries.find((e) => e.amountPence === 2500)!;
    await db.insert(savingsEntries).values({ bucketId: bucket.id, entryDate: first.entryDate, amountPence: first.amountPence, direction: "deposit", expenseEntryId: first.id });
    const tags = { categoryId: pot.id, debtPersonId: sam.id, savingsBucketId: bucket.id };
    const pv = await previewRuleMatches(cond, "expense", rule.id, tags);
    const byAmount = Object.fromEntries(pv.retro!.rows.map((r) => [r.amountPence, r.adds]));
    expect(byAmount[-2500]).toEqual({ debt: true, savings: false });
    expect(byAmount[-1500]).toEqual({ debt: true, savings: true });
    await updateRuleAndCategorize(rule.id, { conditions: cond, target: { targetType: "expense", ...tags }, applyToIds: [], tagExpenseIds: pv.retro!.rows.map((r) => r.expenseEntryId) });
    expect(await db.select().from(savingsEntries)).toHaveLength(2); // 1 existing + 1 new
    expect(await db.select().from(debtLedgerEntries)).toHaveLength(2);
  });

  it("ignores ids that were not offered (tampered, wrong category, no longer matching)", async () => {
    const { rule, pot, other, bucket } = await pastExpenses();
    const all = await db.select().from(expenseEntries);
    const odd = all.find((e) => e.categoryId === other.id)!;
    const res = await updateRuleAndCategorize(rule.id, { conditions: cond, target: { targetType: "expense", categoryId: pot.id, savingsBucketId: bucket.id }, applyToIds: [], tagExpenseIds: [odd.id, 99999] });
    expect(res.tagged).toBe(0);
    expect(res.skipped).toHaveLength(2);
    expect(await db.select().from(savingsEntries)).toHaveLength(0);
  });

  it("creating a new rule can tag past expenses too, with waiting rows in the same save", async () => {
    const acct = await seedAccount();
    const [pot] = await db.insert(categories).values({ name: "Savings transfer" }).returning();
    const [bucket] = await db.insert(savingsBuckets).values({ name: "Holiday" }).returning();
    const [old] = await db.insert(expenseEntries).values({ categoryId: pot.id, year: 2026, month: 9, amountPence: 800, entryDate: "2026-09-05", note: "x" }).returning();
    const [imp] = await db.insert(importedTransactions).values({ bankAccountId: acct.id, importedId: "old", amountPence: -800, bookingDate: "2026-09-05", payeeRaw: "REVOLUT OLD", status: "categorized" }).returning();
    await db.update(expenseEntries).set({ importedTransactionId: imp.id }).where(eq(expenseEntries.id, old.id));
    await stageImportedTransactions(acct.id, [{ importedId: "w", amountPence: -300, bookingDate: "2026-09-20", payeeRaw: "SHOP" }]);
    const waiting = (await db.select().from(importedTransactions)).find((r) => r.importedId === "w")!;
    const res = await createRuleAndCategorize({
      conditions: [{ field: "payee", operator: "contains", value: "revolut" }, ],
      target: { targetType: "expense", categoryId: pot.id, savingsBucketId: bucket.id },
      applyToIds: [],
      tagExpenseIds: [old.id],
    });
    expect(res.tagged).toBe(1);
    expect((await db.select().from(savingsEntries))[0]).toMatchObject({ bucketId: bucket.id, amountPence: 800, expenseEntryId: old.id });
    expect(waiting.status).toBe("pending_review");
  });
});

describe("a rule suggests a category for pending-at-the-bank rows", () => {
  it("getPendingPreview offers an existing rule's match, not just raw text", async () => {
    const acct = await seedAccount();
    const [cat] = await db.insert(categories).values({ name: "Food" }).returning();
    await addCategoryRule({ conditions: [{ field: "payee", operator: "contains", value: "tesco" }], targetType: "expense", categoryId: cat.id });
    await db
      .update(bankAccounts)
      .set({
        pendingPreviewJson: JSON.stringify([
          { amountPence: -500, date: "2026-09-20", payeeRaw: "TESCO STORES 123" },
          { amountPence: -700, date: "2026-09-20", payeeRaw: "SOMEWHERE ELSE" },
          { amountPence: 200, date: "2026-09-20", payeeRaw: "TESCO REFUND" }, // money IN never matches an expense rule
        ]),
      })
      .where(eq(bankAccounts.id, acct.id));
    const preview = await getPendingPreview();
    expect(preview.find((p) => p.payeeRaw === "TESCO STORES 123")!.ruleMatch).toMatchObject({ categoryId: cat.id, categoryName: "Food" });
    expect(preview.find((p) => p.payeeRaw === "SOMEWHERE ELSE")!.ruleMatch).toBeNull();
    expect(preview.find((p) => p.payeeRaw === "TESCO REFUND")!.ruleMatch).toBeNull();
  });

  it("carries the rule's debt / savings tag along with the category", async () => {
    const acct = await seedAccount();
    const [cat] = await db.insert(categories).values({ name: "Food" }).returning();
    const [sam] = await db.insert(people).values({ name: "Sam" }).returning();
    const [bucket] = await db.insert(savingsBuckets).values({ name: "Holiday" }).returning();
    await addCategoryRule({ conditions: [{ field: "payee", operator: "contains", value: "tesco" }], targetType: "expense", categoryId: cat.id, debtPersonId: sam.id, savingsBucketId: bucket.id });
    await db
      .update(bankAccounts)
      .set({ pendingPreviewJson: JSON.stringify([{ amountPence: -500, date: "2026-09-20", payeeRaw: "TESCO STORES 123" }]) })
      .where(eq(bankAccounts.id, acct.id));
    const preview = await getPendingPreview();
    expect(preview[0].ruleMatch).toMatchObject({ categoryId: cat.id, debtPersonId: sam.id, savingsBucketId: bucket.id });
  });

  it("an ignore-type or income-type rule is never offered for a pending expense", async () => {
    const acct = await seedAccount();
    const [src] = await db.insert(incomeSources).values({ name: "Wages" }).returning();
    await addCategoryRule({ conditions: [{ field: "payee", operator: "contains", value: "tesco" }], targetType: "ignore" });
    await db
      .update(bankAccounts)
      .set({ pendingPreviewJson: JSON.stringify([{ amountPence: -500, date: "2026-09-20", payeeRaw: "TESCO STORES 123" }]) })
      .where(eq(bankAccounts.id, acct.id));
    expect((await getPendingPreview())[0].ruleMatch).toBeNull();
    void src;
  });
});

describe("sync lock", () => {
  it("two overlapping passes share one run (one GoCardless call per account)", async () => {
    await seedAccount();
    gc.getAccountTransactions.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { booked: [], pending: [] };
    });
    const [a, b] = await Promise.all([syncAllBankAccounts(), syncAllBankAccounts()]);
    expect(gc.getAccountTransactions).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    // and the lock is released afterwards
    await syncAllBankAccounts();
    expect(gc.getAccountTransactions).toHaveBeenCalledTimes(2);
  });
});
