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
  people,
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
  stageImportedTransactions,
  syncBankAccount,
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
