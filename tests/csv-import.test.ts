import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { bankAccounts, categories, expenseEntries, importedTransactions, incomeSources, payPeriodAnchors } from "@/lib/db/schema";
import { addCategoryRule, stageImportedTransactions, syncAllBankAccounts, syncBankAccount } from "@/lib/db/bank-sync";
import { createCsvAccount, getSavedMapping, importCsvTransactions, previewCsvImport, type CsvTransactionInput } from "@/lib/db/csv-import";
import type { CsvMapping } from "@/lib/csv-import";

beforeEach(() => resetDb());

const linked = async (name = "NatWest") =>
  (await db.insert(bankAccounts).values({ provider: "gocardless", institutionId: "i", requisitionId: "r" + name, externalAccountId: "e" + name, displayName: name, consentExpiresAt: new Date(Date.now() + 9e9) }).returning())[0];
const t = (bookingDate: string, amountPence: number, payeeRaw: string, idHint?: string): CsvTransactionInput => ({ bookingDate, amountPence, payeeRaw, idHint });
const rows = () => db.select().from(importedTransactions);
const mapping: CsvMapping = { delimiter: ",", skipRows: 0, hasHeader: true, dateCol: 0, dateFormat: "dmy", amountMode: "single", amountCol: 1, inCol: 0, outCol: 0, flipSign: false, payeeCols: [2], idCol: null };

describe("csv-only accounts", () => {
  it("are created without a bank, never expire, and are never synced", async () => {
    const a = await createCsvAccount("  Old card  ");
    expect(a).toMatchObject({ provider: "csv", displayName: "Old card" });
    expect(a.consentExpiresAt.getFullYear()).toBeGreaterThan(2900);
    await expect(syncBankAccount(a.id)).rejects.toThrow(/CSV-only/);
    expect(await syncAllBankAccounts()).toEqual([]);
    await expect(createCsvAccount("  ")).rejects.toThrow(/name/);
  });
  it("two accounts can share a name without clashing", async () => {
    const a = await createCsvAccount("Revolut");
    const b = await createCsvAccount("Revolut");
    expect(a.id).not.toBe(b.id);
    expect(a.externalAccountId).not.toBe(b.externalAccountId);
  });
});

describe("importing", () => {
  it("imports into the chosen account, ids are stable, and a re-import adds nothing", async () => {
    const acct = await linked();
    const file = [t("2026-10-05", -1250, "TESCO"), t("2026-10-06", 250000, "WAGES")];
    const first = await importCsvTransactions(acct.id, file);
    expect(first).toMatchObject({ total: 2, fresh: 2, imported: 2, alreadyImported: 0 });
    const again = await importCsvTransactions(acct.id, file);
    expect(again).toMatchObject({ imported: 0, alreadyImported: 2, fresh: 0 });
    expect(await rows()).toHaveLength(2);
    expect((await rows()).every((r) => r.bankAccountId === acct.id && r.importedId.startsWith("csv:"))).toBe(true);
  });
  it("two genuinely identical rows in one file both import; an overlapping later file lines up with them", async () => {
    const acct = await linked();
    await importCsvTransactions(acct.id, [t("2026-10-05", -300, "COSTA"), t("2026-10-05", -300, "COSTA")]);
    expect(await rows()).toHaveLength(2);
    const overlap = await importCsvTransactions(acct.id, [t("2026-10-05", -300, "COSTA"), t("2026-10-05", -300, "COSTA"), t("2026-10-06", -300, "COSTA")]);
    expect(overlap).toMatchObject({ alreadyImported: 2, fresh: 1 });
  });
  it("the bank's own id is used when the file has one (payee edits don't create a copy)", async () => {
    const acct = await linked();
    await importCsvTransactions(acct.id, [t("2026-10-05", -500, "SHOP A", "TX-1")]);
    const again = await importCsvTransactions(acct.id, [t("2026-10-05", -500, "SHOP A (renamed)", "TX-1")]);
    expect(again.alreadyImported).toBe(1);
  });
  it("is oldest-first with the normal pipeline: rules apply, and a wage anchors before later expenses", async () => {
    const acct = await linked();
    const [wages] = await db.insert(incomeSources).values({ name: "Wages", isPayAnchor: true }).returning();
    const [food] = await db.insert(categories).values({ name: "Food" }).returning();
    await addCategoryRule({ conditions: [{ field: "payee", operator: "contains", value: "acme" }], targetType: "income", incomeSourceId: wages.id });
    await addCategoryRule({ conditions: [{ field: "payee", operator: "contains", value: "tesco" }], targetType: "expense", categoryId: food.id });
    const res = await importCsvTransactions(acct.id, [t("2026-10-02", -900, "TESCO LATE"), t("2026-09-30", 480000, "ACME WAGES"), t("2026-09-29", -500, "TESCO EARLY")]);
    expect(res).toMatchObject({ imported: 3, categorized: 3, waitingInReview: 0 });
    expect((await db.select().from(payPeriodAnchors))[0]).toMatchObject({ receivedDate: "2026-09-30", month: 10 });
    const exp = await db.select().from(expenseEntries);
    expect(exp.find((e) => e.entryDate === "2026-09-29")!.month).toBe(9);
    expect(exp.find((e) => e.entryDate === "2026-10-02")!.month).toBe(10);
  });
  it("is all-or-nothing: a bad row anywhere imports nothing", async () => {
    const acct = await linked();
    await expect(importCsvTransactions(acct.id, [t("2026-10-05", -1, "OK"), t("2026-13-45", -1, "BAD")])).rejects.toThrow();
    await expect(importCsvTransactions(acct.id, [t("2026-10-05", -1, "OK"), t("2026-10-05", 0, "ZERO")])).rejects.toThrow(/non-zero/);
    await expect(importCsvTransactions(acct.id, [t("2026-10-05", 1.5, "FRAC")])).rejects.toThrow();
    await expect(importCsvTransactions(acct.id, [t("2026-10-05", -1, " ")])).rejects.toThrow(/payee/);
    expect(await rows()).toHaveLength(0);
  });
  it("refuses an empty file, a missing or archived account", async () => {
    const acct = await linked();
    await expect(importCsvTransactions(acct.id, [])).rejects.toThrow(/no transactions/);
    await expect(importCsvTransactions(999, [t("2026-10-05", -1, "X")])).rejects.toThrow(/isn't available/);
    await db.update(bankAccounts).set({ archivedAt: new Date() }).where(eq(bankAccounts.id, acct.id));
    await expect(importCsvTransactions(acct.id, [t("2026-10-05", -1, "X")])).rejects.toThrow(/isn't available/);
  });
});

describe("possible duplicates of a bank-synced transaction", () => {
  it("flags a CSV row with the same amount within a day, keeps it, and holds it in Review (rules do not touch it)", async () => {
    const acct = await linked();
    const [food] = await db.insert(categories).values({ name: "Food" }).returning();
    await addCategoryRule({ conditions: [{ field: "payee", operator: "contains", value: "tesco" }], targetType: "expense", categoryId: food.id });
    await stageImportedTransactions(acct.id, [{ importedId: "gc-1", amountPence: -1250, bookingDate: "2026-10-05", payeeRaw: "TESCO STORES 123" }]);
    await db.update(importedTransactions).set({ status: "pending_review" }); // as if still waiting
    const before = (await rows())[0];
    const res = await importCsvTransactions(acct.id, [t("2026-10-06", -1250, "TESCO"), t("2026-10-20", -1250, "TESCO")]);
    expect(res).toMatchObject({ fresh: 2, possibleDuplicates: 1, imported: 2 });
    const flagged = (await rows()).find((r) => r.importedId.startsWith("csv:") && r.bookingDate === "2026-10-06")!;
    expect(flagged.possibleDuplicateImportedId).toBe(before.id);
    expect(flagged.status).toBe("pending_review"); // the rule did NOT file it
    const far = (await rows()).find((r) => r.bookingDate === "2026-10-20")!;
    expect(far.possibleDuplicateImportedId).toBeNull();
    expect(far.status).toBe("categorized"); // 14 days away: a normal row, rule applied
  });
  it("different amount, or more than a day apart, is not flagged", async () => {
    const acct = await linked();
    await stageImportedTransactions(acct.id, [{ importedId: "gc-1", amountPence: -1250, bookingDate: "2026-10-05", payeeRaw: "SHOP" }]);
    const p = await previewCsvImport(acct.id, [t("2026-10-05", -1251, "SHOP"), t("2026-10-07", -1250, "SHOP")]);
    expect(p.possibleDuplicates).toBe(0);
  });
  it("an account's rows are never matched against another account's", async () => {
    const a = await linked("A"), b = await linked("B");
    await stageImportedTransactions(a.id, [{ importedId: "gc-1", amountPence: -500, bookingDate: "2026-10-05", payeeRaw: "SHOP" }]);
    expect((await previewCsvImport(b.id, [t("2026-10-05", -500, "SHOP")])).possibleDuplicates).toBe(0);
  });
  it("two same-amount purchases inside ONE file never flag each other", async () => {
    const acct = await linked();
    const p = await previewCsvImport(acct.id, [t("2026-10-05", -300, "COSTA"), t("2026-10-05", -300, "PRET")]);
    expect(p.possibleDuplicates).toBe(0);
  });
  it("policy 'skip' drops flagged rows instead of importing them", async () => {
    const acct = await linked();
    await stageImportedTransactions(acct.id, [{ importedId: "gc-1", amountPence: -700, bookingDate: "2026-10-05", payeeRaw: "SHOP" }]);
    const res = await importCsvTransactions(acct.id, [t("2026-10-05", -700, "SHOP COPY"), t("2026-10-09", -800, "OTHER")], { duplicatePolicy: "skip" });
    expect(res).toMatchObject({ imported: 1, skippedPossibleDuplicates: 1 });
    expect((await rows()).filter((r) => r.importedId.startsWith("csv:"))).toHaveLength(1);
  });
  it("preview matches what import then does, and writes nothing", async () => {
    const acct = await linked();
    await stageImportedTransactions(acct.id, [{ importedId: "gc-1", amountPence: -700, bookingDate: "2026-10-05", payeeRaw: "SHOP" }]);
    const file = [t("2026-10-05", -700, "SHOP COPY"), t("2026-10-09", -800, "OTHER"), t("2026-10-10", -900, "NEW")];
    const preview = await previewCsvImport(acct.id, file);
    expect(await rows()).toHaveLength(1);
    const real = await importCsvTransactions(acct.id, file);
    expect({ fresh: real.fresh, possibleDuplicates: real.possibleDuplicates, alreadyImported: real.alreadyImported }).toEqual({ fresh: preview.fresh, possibleDuplicates: preview.possibleDuplicates, alreadyImported: preview.alreadyImported });
    expect(preview).toMatchObject({ total: 3, oldest: "2026-10-05", newest: "2026-10-10" });
  });
});

describe("remembered mapping", () => {
  it("is saved on the account after an import and read back; garbage is ignored", async () => {
    const acct = await createCsvAccount("Card");
    expect(await getSavedMapping(acct.id)).toBeNull();
    await importCsvTransactions(acct.id, [t("2026-10-05", -1, "X")], { mapping });
    expect(await getSavedMapping(acct.id)).toEqual(mapping);
    await db.update(bankAccounts).set({ csvMapping: "not json" }).where(eq(bankAccounts.id, acct.id));
    expect(await getSavedMapping(acct.id)).toBeNull();
  });
  it("an invalid mapping aborts the whole import (nothing written)", async () => {
    const acct = await createCsvAccount("Card");
    await expect(importCsvTransactions(acct.id, [t("2026-10-05", -1, "X")], { mapping: { ...mapping, delimiter: "x" as never } })).rejects.toThrow(/mapping/);
    expect(await rows()).toHaveLength(0);
  });
});
