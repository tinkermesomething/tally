import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { bankAccounts } from "@/lib/db/schema";
import { getPendingPreview, getRecentTransactions, setBankAccountAlias, stageImportedTransactions } from "@/lib/db/bank-sync";
import { accountDisplayName, accountLabels } from "@/lib/accounts";

beforeEach(() => resetDb());
const mk = async (displayName: string) =>
  (await db.insert(bankAccounts).values({ provider: "gocardless", institutionId: "i", requisitionId: "r" + displayName + Math.random(), externalAccountId: "e" + Math.random(), displayName, consentExpiresAt: new Date(Date.now() + 9e9) }).returning())[0];

describe("account alias", () => {
  it("shows the alias when set, else the bank's own name", () => {
    expect(accountDisplayName({ displayName: "NatWest - GB12 3456", alias: "Main" })).toBe("Main");
    expect(accountDisplayName({ displayName: "NatWest - GB12 3456", alias: "  " })).toBe("NatWest - GB12 3456");
    expect(accountDisplayName({ displayName: "NatWest - GB12 3456", alias: null })).toBe("NatWest - GB12 3456");
    expect(accountDisplayName({ displayName: "NatWest" })).toBe("NatWest");
  });
  it("set, trimmed, cleared with an empty string; the bank's name is never lost", async () => {
    const a = await mk("Revolut - GBP");
    await setBankAccountAlias(a.id, "  Holiday   pot ");
    expect((await db.query.bankAccounts.findFirst())!).toMatchObject({ alias: "Holiday pot", displayName: "Revolut - GBP" });
    await setBankAccountAlias(a.id, "");
    expect((await db.query.bankAccounts.findFirst())!.alias).toBeNull();
  });
  it("refuses a very long alias and a missing account", async () => {
    const a = await mk("X");
    await expect(setBankAccountAlias(a.id, "x".repeat(61))).rejects.toThrow(/at most/);
    await expect(setBankAccountAlias(999, "ok")).rejects.toThrow(/no longer exists/);
  });
  it("two accounts with the same alias are told apart in lists", async () => {
    const a = await mk("Revolut A"), b = await mk("Revolut B");
    const labels = accountLabels([{ ...a, alias: "Pot" }, { ...b, alias: "Pot" }]);
    expect(labels.map((l) => l.name)).toEqual([`Pot (#${a.id})`, `Pot (#${b.id})`]);
    expect(accountLabels([{ ...a, alias: "Main" }, b]).map((l) => l.name)).toEqual(["Main", "Revolut B"]);
  });
  it("the pending-at-the-bank preview uses the alias too", async () => {
    const a = await mk("Revolut");
    await db.update(bankAccounts).set({ pendingPreviewJson: JSON.stringify([{ amountPence: -500, date: null, payeeRaw: "SHOP" }]) });
    await setBankAccountAlias(a.id, "Spending");
    expect((await getPendingPreview())[0].bankAccountName).toBe("Spending");
  });
});

describe("recent transactions", () => {
  it("returns the newest N per account, newest first, only that account's", async () => {
    const a = await mk("A"), b = await mk("B");
    await stageImportedTransactions(a.id, Array.from({ length: 7 }, (_, i) => ({ importedId: `a${i}`, amountPence: -100 - i, bookingDate: `2026-10-0${i + 1}`, payeeRaw: `SHOP ${i}` })));
    await stageImportedTransactions(b.id, [{ importedId: "b1", amountPence: -5, bookingDate: "2026-10-09", payeeRaw: "OTHER" }]);
    const recent = await getRecentTransactions([a.id, b.id], 5);
    expect(recent.get(a.id)!.map((t) => t.payee)).toEqual(["SHOP 6", "SHOP 5", "SHOP 4", "SHOP 3", "SHOP 2"]);
    expect(recent.get(b.id)!.map((t) => t.payee)).toEqual(["OTHER"]);
  });
  it("an account with nothing yet gets an empty list; the clean payee wins over the raw one", async () => {
    const a = await mk("A"), empty = await mk("Empty");
    await stageImportedTransactions(a.id, [{ importedId: "x", amountPence: -1, bookingDate: "2026-10-01", payeeRaw: "RAW 123", payeeClean: "Nice Name" }]);
    const recent = await getRecentTransactions([a.id, empty.id]);
    expect(recent.get(empty.id)).toEqual([]);
    expect(recent.get(a.id)![0].payee).toBe("Nice Name");
  });
  it("same-day rows come back newest-imported first (stable order)", async () => {
    const a = await mk("A");
    await stageImportedTransactions(a.id, [{ importedId: "1", amountPence: -1, bookingDate: "2026-10-01", payeeRaw: "FIRST" }, { importedId: "2", amountPence: -2, bookingDate: "2026-10-01", payeeRaw: "SECOND" }]);
    expect((await getRecentTransactions([a.id])).get(a.id)!.map((t) => t.payee)).toEqual(["SECOND", "FIRST"]);
  });
});
