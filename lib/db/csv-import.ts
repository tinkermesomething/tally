import { createHash } from "node:crypto";
import { and, asc, between, eq } from "drizzle-orm";
import { db, inTransaction } from "./index";
import { assertIsoDate } from "../validate";
import { isCsvMapping, MAX_PAYEE_LENGTH, type CsvMapping } from "../csv-import";
import { CSV_PROVIDER, stageImportedTransactions, type RawImportedTransaction } from "./bank-sync";
import { bankAccounts, importedTransactions } from "./schema";

export const MAX_CSV_ROWS = 20000;
const DAY_MS = 86_400_000;

/** One transaction as sent from the browser. Re-validated here: the server
 * never trusts what the client says it parsed. */
export type CsvTransactionInput = {
  bookingDate: string;
  amountPence: number;
  payeeRaw: string;
  idHint?: string | null;
};

export type DuplicatePolicy = "flag" | "skip";

export type CsvImportPlan = {
  total: number;
  /** Not seen before: will be imported. */
  fresh: number;
  /** Already imported (an earlier copy of this file, or an overlapping one). */
  alreadyImported: number;
  /** New rows that look like an existing transaction (same amount, date within a day). */
  possibleDuplicates: number;
  oldest: string | null;
  newest: string | null;
};

type Planned = RawImportedTransaction & { flaggedAs: number | null };

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const dayMs = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

function validateInputs(inputs: CsvTransactionInput[]) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("There are no transactions to import.");
  if (inputs.length > MAX_CSV_ROWS) throw new Error(`That file has more than ${MAX_CSV_ROWS.toLocaleString()} rows. Split it and import in parts.`);
  inputs.forEach((t, i) => {
    assertIsoDate(t.bookingDate);
    if (!Number.isInteger(t.amountPence) || t.amountPence === 0) throw new Error(`Row ${i + 1}: the amount must be a non-zero number of pence.`);
    if (typeof t.payeeRaw !== "string" || !t.payeeRaw.trim() || t.payeeRaw.length > MAX_PAYEE_LENGTH) throw new Error(`Row ${i + 1}: the payee text is missing or too long.`);
  });
}

/** A stable id for a row, so importing the same file (or an overlapping one)
 * twice never creates the same transaction twice. The bank's own id wins when
 * the file has one; otherwise it's a hash of date + amount + payee. Several
 * genuinely identical rows in one file get distinct numbers (1st, 2nd...) so
 * two coffees on one day both import - and the Nth in a later overlapping
 * file still lines up with the Nth here. */
function idsFor(inputs: CsvTransactionInput[]): string[] {
  const seen = new Map<string, number>();
  return inputs.map((t) => {
    const base = t.idHint?.trim() ? `id|${t.idHint.trim()}` : `${t.bookingDate}|${t.amountPence}|${normalize(t.payeeRaw)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return "csv:" + createHash("sha1").update(`${base}|${n}`).digest("hex").slice(0, 24);
  });
}

async function plan(bankAccountId: number, inputs: CsvTransactionInput[]) {
  validateInputs(inputs);
  const account = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, bankAccountId) });
  if (!account || account.archivedAt) throw new Error("That account isn't available.");

  const ids = idsFor(inputs);
  const dates = inputs.map((t) => t.bookingDate).sort();
  const lo = new Date(dayMs(dates[0]) - DAY_MS).toISOString().slice(0, 10);
  const hi = new Date(dayMs(dates[dates.length - 1]) + DAY_MS).toISOString().slice(0, 10);
  // Everything already in this account around the file's dates - read ONCE,
  // before anything from this file is inserted, so two real same-amount
  // purchases inside one file never flag each other.
  const existing = await db
    .select({ id: importedTransactions.id, importedId: importedTransactions.importedId, amountPence: importedTransactions.amountPence, bookingDate: importedTransactions.bookingDate, payeeRaw: importedTransactions.payeeRaw })
    .from(importedTransactions)
    .where(and(eq(importedTransactions.bankAccountId, bankAccountId), between(importedTransactions.bookingDate, lo, hi)))
    .orderBy(asc(importedTransactions.id));
  const existingIds = new Set(
    (await db.select({ importedId: importedTransactions.importedId }).from(importedTransactions).where(eq(importedTransactions.bankAccountId, bankAccountId))).map((r) => r.importedId)
  );

  const planned: Planned[] = [];
  let alreadyImported = 0;
  inputs.forEach((t, i) => {
    if (existingIds.has(ids[i])) return void alreadyImported++;
    const candidates = existing.filter((e) => e.amountPence === t.amountPence && Math.abs(dayMs(e.bookingDate) - dayMs(t.bookingDate)) <= DAY_MS);
    candidates.sort(
      (a, b) =>
        Number(normalize(b.payeeRaw) === normalize(t.payeeRaw)) - Number(normalize(a.payeeRaw) === normalize(t.payeeRaw)) ||
        Math.abs(dayMs(a.bookingDate) - dayMs(t.bookingDate)) - Math.abs(dayMs(b.bookingDate) - dayMs(t.bookingDate)) ||
        a.id - b.id
    );
    planned.push({
      importedId: ids[i],
      amountPence: t.amountPence,
      bookingDate: t.bookingDate,
      payeeRaw: t.payeeRaw.replace(/\s+/g, " ").trim(),
      flaggedAs: candidates[0]?.id ?? null,
    });
  });
  const summary: CsvImportPlan = {
    total: inputs.length,
    fresh: planned.length,
    alreadyImported,
    possibleDuplicates: planned.filter((p) => p.flaggedAs !== null).length,
    oldest: dates[0],
    newest: dates[dates.length - 1],
  };
  return { planned, summary };
}

/** The same summary for a brand-new CSV-only account: nothing exists yet, so
 * every row is new. Still validates the rows. */
export function previewForNewAccount(inputs: CsvTransactionInput[]): CsvImportPlan {
  validateInputs(inputs);
  const dates = inputs.map((t) => t.bookingDate).sort();
  return { total: inputs.length, fresh: inputs.length, alreadyImported: 0, possibleDuplicates: 0, oldest: dates[0], newest: dates[dates.length - 1] };
}

/** What importing this file would do - changes nothing. */
export async function previewCsvImport(bankAccountId: number, inputs: CsvTransactionInput[]): Promise<CsvImportPlan> {
  return (await plan(bankAccountId, inputs)).summary;
}

export type CsvImportResult = CsvImportPlan & {
  imported: number;
  skippedPossibleDuplicates: number;
  /** Where the imported rows ended up after rules and learned patterns. */
  categorized: number;
  ignored: number;
  waitingInReview: number;
};

/** Imports the file in one all-or-nothing step: new rows go through the same
 * pipeline as a bank sync (oldest first, rules, learned patterns, wage
 * anchors). Rows that look like an existing transaction are imported and
 * held in Review - or dropped, if the policy is "skip". When `mapping` is
 * given it is remembered on the account for the next file. */
export async function importCsvTransactions(
  bankAccountId: number,
  inputs: CsvTransactionInput[],
  options: { duplicatePolicy?: DuplicatePolicy; mapping?: CsvMapping } = {}
): Promise<CsvImportResult> {
  return inTransaction(async () => {
    const { planned, summary } = await plan(bankAccountId, inputs);
    const skip = options.duplicatePolicy === "skip";
    const toImport = planned.filter((p) => !(skip && p.flaggedAs !== null));
    const staged = await stageImportedTransactions(
      bankAccountId,
      toImport.map(({ flaggedAs, ...raw }) => ({ ...raw, possibleDuplicateImportedId: flaggedAs }))
    );
    if (options.mapping) {
      if (!isCsvMapping(options.mapping)) throw new Error("That column mapping isn't valid.");
      await db.update(bankAccounts).set({ csvMapping: JSON.stringify(options.mapping) }).where(eq(bankAccounts.id, bankAccountId));
    }
    return {
      ...summary,
      imported: staged.length,
      skippedPossibleDuplicates: skip ? planned.length - toImport.length : 0,
      categorized: staged.filter((r) => r.status === "categorized").length,
      ignored: staged.filter((r) => r.status === "ignored").length,
      waitingInReview: staged.filter((r) => r.status === "pending_review").length,
    };
  });
}

/** A new account that only ever receives CSV files (a bank that isn't
 * linked, an old card). Never synced, never expires. */
export async function createCsvAccount(displayName: string) {
  const name = displayName.trim();
  if (!name) throw new Error("Give the account a name.");
  if (name.length > 80) throw new Error("That name is too long.");
  const [created] = await db
    .insert(bankAccounts)
    .values({
      provider: CSV_PROVIDER,
      institutionId: CSV_PROVIDER,
      requisitionId: CSV_PROVIDER,
      externalAccountId: `csv-${createHash("sha1").update(`${name}|${Date.now()}|${Math.random()}`).digest("hex").slice(0, 16)}`,
      displayName: name,
      consentExpiresAt: new Date("2999-01-01T00:00:00Z"),
    })
    .returning();
  return created;
}

/** The column mapping saved by this account's last import, if any. */
export async function getSavedMapping(bankAccountId: number): Promise<CsvMapping | null> {
  const account = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, bankAccountId) });
  if (!account?.csvMapping) return null;
  try {
    const parsed = JSON.parse(account.csvMapping);
    return isCsvMapping(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
