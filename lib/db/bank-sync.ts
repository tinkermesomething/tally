import { and, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "./index";
import { logExpense, incrementIncomeEntry } from "./queries";
import { resolvePeriodForDate } from "./pay-period";
import {
  bankAccounts,
  categories,
  categoryRules,
  expenseEntries,
  importedTransactions,
} from "./schema";
import { getAccountTransactions, toRawImportedTransaction } from "../gocardless";

// ---- Bank accounts ----

export async function addBankAccount(input: {
  provider: string;
  institutionId: string;
  requisitionId: string;
  externalAccountId: string;
  displayName: string;
  consentExpiresAt: Date;
}) {
  const [created] = await db.insert(bankAccounts).values(input).returning();
  return created;
}

export async function getBankAccounts() {
  return db.query.bankAccounts.findMany({
    where: isNull(bankAccounts.archivedAt),
    orderBy: (a, { asc }) => [asc(a.displayName)],
  });
}

/** Re-authorizing a bank (GoCardless consent expires every ~90 days, a
 * normal recurring step, not an error state) must update the EXISTING row
 * rather than insert a duplicate - externalAccountId is stable across
 * requisitions for the same real bank account, confirmed empirically
 * (actual-budget's own NatWest/Revolut connections kept the same account
 * ids across multiple past re-auths). Un-archives on renewal too, since
 * going through the consent flow again is an explicit signal the user
 * wants this account active. */
export async function linkOrRenewBankAccount(input: {
  provider: string;
  institutionId: string;
  requisitionId: string;
  externalAccountId: string;
  displayName: string;
  consentExpiresAt: Date;
}) {
  const existing = await db.query.bankAccounts.findFirst({
    where: eq(bankAccounts.externalAccountId, input.externalAccountId),
  });
  if (existing) {
    const [updated] = await db
      .update(bankAccounts)
      .set({
        requisitionId: input.requisitionId,
        consentExpiresAt: input.consentExpiresAt,
        displayName: input.displayName,
        archivedAt: null,
      })
      .where(eq(bankAccounts.id, existing.id))
      .returning();
    return updated;
  }
  return addBankAccount(input);
}

/** Soft-delete, same convention as categories/incomeSources - unlinking an
 * account never deletes its imported history, the staged rows just stop
 * being reachable from an active account. */
export async function archiveBankAccount(id: number) {
  await db.update(bankAccounts).set({ archivedAt: new Date() }).where(eq(bankAccounts.id, id));
}

export async function markBankAccountSynced(id: number) {
  await db.update(bankAccounts).set({ lastSyncedAt: new Date() }).where(eq(bankAccounts.id, id));
}

/** The actual fetch-from-GoCardless-and-stage step - everything else in
 * this file (rules, learned patterns, duplicate suggestion, the review
 * pool) only does anything once rows actually land via this. Narrows to
 * transactions booked on/after the account's last sync (full history on
 * the very first sync, bounded by the agreement's own max_historical_days
 * regardless) so a re-sync doesn't re-fetch the account's whole lifetime
 * every time. */
export async function syncBankAccount(bankAccountId: number): Promise<{ staged: number }> {
  const account = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, bankAccountId) });
  if (!account) throw new Error(`Bank account ${bankAccountId} not found.`);

  const dateFrom = account.lastSyncedAt ? account.lastSyncedAt.toISOString().slice(0, 10) : undefined;
  const { booked } = await getAccountTransactions(account.externalAccountId, dateFrom);
  const staged = await stageImportedTransactions(bankAccountId, booked.map(toRawImportedTransaction));
  await markBankAccountSynced(bankAccountId);
  return { staged: staged.length };
}

export async function syncAllBankAccounts(): Promise<{ bankAccountId: number; displayName: string; staged: number }[]> {
  const accounts = await getBankAccounts();
  const results = [];
  for (const account of accounts) {
    const { staged } = await syncBankAccount(account.id);
    results.push({ bankAccountId: account.id, displayName: account.displayName, staged });
  }
  return results;
}

// ---- Rules engine (explicit rules) ----

export type CategoryRule = typeof categoryRules.$inferSelect;

export async function getCategoryRules(): Promise<CategoryRule[]> {
  return db.query.categoryRules.findMany({
    where: eq(categoryRules.active, true),
    orderBy: (r, { asc }) => [asc(r.sortOrder)],
  });
}

export async function addCategoryRule(
  input:
    | {
        field: "payee" | "amount";
        operator: "contains" | "is" | "gt" | "lt";
        value: string;
        targetType: "expense";
        categoryId: number;
        debtPersonId?: number;
      }
    | {
        field: "payee" | "amount";
        operator: "contains" | "is" | "gt" | "lt";
        value: string;
        targetType: "income";
        incomeSourceId: number;
      }
) {
  const [maxRow] = await db
    .select({ max: sql<number>`max(${categoryRules.sortOrder})` })
    .from(categoryRules);
  const [created] = await db
    .insert(categoryRules)
    .values({ ...input, sortOrder: (maxRow?.max ?? -1) + 1 })
    .returning();
  return created;
}

export async function deactivateCategoryRule(id: number) {
  await db.update(categoryRules).set({ active: false }).where(eq(categoryRules.id, id));
}

export type RuleMatch =
  | { targetType: "expense"; categoryId: number; debtPersonId: number | null }
  | { targetType: "income"; incomeSourceId: number };

/** Pure function, no DB access - evaluates rules in order, first match
 * wins. Matches actual-budget's own model: condition (field/operator/
 * value) -> action (category or income source, optionally also a debt
 * tag for expenses). A transaction with no payeeClean set yet falls back
 * to payeeRaw for payee-field rules, since cleanup may not have run (or
 * found nothing to clean).
 *
 * Rules are filtered to their COMPATIBLE direction before any field/
 * operator condition is even evaluated: an expense-targeted rule is never
 * considered for a positive (money-in) transaction, and vice versa. This
 * is deliberate, not just an optimization - staging imports both
 * directions, but categorizeTransaction (expense) and
 * categorizeTransactionAsIncome throw if given the wrong sign. Without
 * this filter, an expense rule whose payee/amount condition happened to
 * also match an incoming transaction (e.g. a "payee contains wages" rule
 * meant for something unrelated matching an actual incoming wage payment)
 * would throw mid-batch and silently abort the rest of that sync - this
 * filter makes that failure mode structurally impossible rather than
 * relying on every rule being written carefully enough to avoid it. */
export function matchCategoryRule(
  transaction: { payeeRaw: string; payeeClean: string | null; amountPence: number },
  rules: CategoryRule[]
): RuleMatch | null {
  // A real bank transaction is never exactly 0 pence, but handle it for
  // real: neither categorizeTransaction nor categorizeTransactionAsIncome
  // accept a 0 amount, so a 0-amount transaction must never match ANY
  // rule - not "fall into income's bucket by default" - or this filter's
  // own claim of making the mid-batch crash impossible would have a hole.
  if (transaction.amountPence === 0) return null;
  const direction: "expense" | "income" = transaction.amountPence < 0 ? "expense" : "income";
  const payee = (transaction.payeeClean ?? transaction.payeeRaw).toLowerCase();
  for (const rule of rules) {
    if (rule.targetType !== direction) continue;

    let matched: boolean;
    if (rule.field === "payee") {
      const value = rule.value.toLowerCase();
      matched = rule.operator === "contains" ? payee.includes(value) : payee === value;
    } else {
      const value = parseInt(rule.value, 10);
      if (rule.operator === "gt") matched = transaction.amountPence > value;
      else if (rule.operator === "lt") matched = transaction.amountPence < value;
      else matched = transaction.amountPence === value;
    }
    if (!matched) continue;

    if (rule.targetType === "expense") {
      // categoryId is NOT NULL at the application level for an "expense"
      // rule (enforced by addCategoryRule's discriminated input type), but
      // the column itself is nullable in the schema (shared with income
      // rules) - the ! is safe given that invariant, not a type escape hatch
      // papering over a real gap.
      return { targetType: "expense", categoryId: rule.categoryId!, debtPersonId: rule.debtPersonId ?? null };
    }
    return { targetType: "income", incomeSourceId: rule.incomeSourceId! };
  }
  return null;
}

// ---- Learned patterns ----

/** After a payee's been manually categorized a few times, stop asking: if
 * one category won >= 3 of its last 5 categorizations, suggest it going
 * forward - same threshold actual-budget uses. Only considers payeeClean
 * (not payeeRaw), since that's the stable, user-normalized identity a
 * payee should be recognized by. Returns null below the confidence
 * threshold, not a weak guess. */
export async function suggestCategoryFromHistory(payeeClean: string): Promise<number | null> {
  const recent = await db.query.importedTransactions.findMany({
    where: and(eq(importedTransactions.payeeClean, payeeClean), eq(importedTransactions.status, "categorized")),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 5,
  });
  if (recent.length === 0) return null;
  const counts = new Map<number, number>();
  for (const t of recent) {
    const catEntry = await db.query.expenseEntries.findFirst({
      where: eq(expenseEntries.importedTransactionId, t.id),
    });
    if (!catEntry) continue;
    counts.set(catEntry.categoryId, (counts.get(catEntry.categoryId) ?? 0) + 1);
  }
  for (const [categoryId, count] of counts) {
    if (count >= 3) return categoryId;
  }
  return null;
}

/** Income's equivalent of suggestCategoryFromHistory - same >= 3-of-last-5
 * threshold. Reads categorizedIncomeSourceId directly rather than joining
 * through a per-transaction table the way the expense side joins
 * expenseEntries, since income_entries has no such join target (see the
 * schema comment on categorizedIncomeSourceId). Filtering to rows that
 * were actually income-categorized (not just "categorized" generally) in
 * the query itself, rather than after the fact, keeps the 5-row window
 * meaningful for a payee that's occasionally appeared on both sides. */
export async function suggestIncomeSourceFromHistory(payeeClean: string): Promise<number | null> {
  const recent = await db.query.importedTransactions.findMany({
    where: and(
      eq(importedTransactions.payeeClean, payeeClean),
      eq(importedTransactions.status, "categorized"),
      isNotNull(importedTransactions.categorizedIncomeSourceId)
    ),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 5,
  });
  const counts = new Map<number, number>();
  for (const t of recent) {
    const id = t.categorizedIncomeSourceId!;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [incomeSourceId, count] of counts) {
    if (count >= 3) return incomeSourceId;
  }
  return null;
}

// ---- Possible-duplicate suggestion (manual entries only - never automatic) ----

/** Same date +/-1 day, same amount, against manually-logged expenseEntries
 * - there's no provider id to exact-match against those, so this is
 * necessarily fuzzy. A SUGGESTION only: the review UI surfaces it, the
 * user decides whether to ignore the staged row or categorize it as a
 * genuinely separate transaction. Only meaningful for money-out (negative
 * imported amounts) against expenses, which are always positive. */
export async function findPossibleManualDuplicate(
  amountPence: number,
  bookingDate: string
): Promise<number | null> {
  if (amountPence >= 0) return null;
  const expenseAmount = Math.abs(amountPence);
  // Date.UTC + toISOString round-trips exactly regardless of the server's
  // local timezone - constructing via `new Date(y, m-1, d)` (local
  // midnight) and then calling toISOString() on it does NOT: toISOString
  // always renders in UTC, so a positive local offset (e.g. UK's BST in
  // October, UTC+1) silently shifts the calendar date back by a day. Found
  // via a real failing test, not assumed.
  const [y, m, d] = bookingDate.split("-").map(Number);
  const baseMs = Date.UTC(y, m - 1, d);
  const dayMs = 24 * 60 * 60 * 1000;
  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const dayBefore = toIso(baseMs - dayMs);
  const dayAfter = toIso(baseMs + dayMs);

  const candidate = await db.query.expenseEntries.findFirst({
    where: and(
      eq(expenseEntries.amountPence, expenseAmount),
      gte(expenseEntries.entryDate, dayBefore),
      lte(expenseEntries.entryDate, dayAfter),
      isNull(expenseEntries.importedTransactionId)
    ),
  });
  return candidate?.id ?? null;
}

// ---- Staging / review pool ----

export type RawImportedTransaction = {
  importedId: string;
  amountPence: number;
  bookingDate: string;
  payeeRaw: string;
  payeeClean?: string | null;
};

/** Bulk-stages a sync batch, deduped against anything already imported for
 * this account (exact match on the provider's own transaction id - see
 * imported_transactions_dedup). Only genuinely NEW rows run through
 * auto-categorization; something already staged keeps whatever state it's
 * already in. Returns the newly staged rows (post-auto-categorization) so
 * the caller (the sync endpoint) can report how many landed in each
 * status. */
export async function stageImportedTransactions(
  bankAccountId: number,
  transactions: RawImportedTransaction[]
) {
  if (transactions.length === 0) return [];

  const inserted = await db
    .insert(importedTransactions)
    .values(
      transactions.map((t) => ({
        bankAccountId,
        importedId: t.importedId,
        amountPence: t.amountPence,
        bookingDate: t.bookingDate,
        payeeRaw: t.payeeRaw,
        payeeClean: t.payeeClean ?? null,
      }))
    )
    .onConflictDoNothing({ target: [importedTransactions.bankAccountId, importedTransactions.importedId] })
    .returning();

  const results = [];
  for (const row of inserted) {
    results.push(await autoProcessStagedTransaction(row.id));
  }
  return results;
}

/** Runs the auto-categorization pipeline for one newly-staged row: a
 * possible duplicate of a manual entry always wins and blocks auto-
 * categorization (never silently create a second expense for money
 * that's possibly already logged) - then explicit rules, then learned
 * patterns, in that order. Falls through to plain pending_review if
 * nothing matches (or a duplicate hint was set). */
async function autoProcessStagedTransaction(id: number) {
  const row = await db.query.importedTransactions.findFirst({ where: eq(importedTransactions.id, id) });
  if (!row) throw new Error(`Staged transaction ${id} not found right after insert.`);

  const duplicateOf = await findPossibleManualDuplicate(row.amountPence, row.bookingDate);
  if (duplicateOf !== null) {
    await db
      .update(importedTransactions)
      .set({ possibleDuplicateExpenseEntryId: duplicateOf })
      .where(eq(importedTransactions.id, id));
    return { ...row, possibleDuplicateExpenseEntryId: duplicateOf };
  }

  const rules = await getCategoryRules();
  const ruleMatch = matchCategoryRule(row, rules);
  if (ruleMatch) {
    if (ruleMatch.targetType === "expense") {
      await categorizeTransaction(id, ruleMatch);
    } else {
      await categorizeTransactionAsIncome(id, ruleMatch);
    }
    return (await db.query.importedTransactions.findFirst({ where: eq(importedTransactions.id, id) }))!;
  }

  // Same direction guard as matchCategoryRule, same reason - a 0-amount
  // transaction (unrealistic for a real bank feed, but not impossible)
  // must never reach either categorize function, both of which reject it.
  if (row.payeeClean && row.amountPence !== 0) {
    if (row.amountPence < 0) {
      const learnedCategoryId = await suggestCategoryFromHistory(row.payeeClean);
      if (learnedCategoryId !== null) {
        await categorizeTransaction(id, { categoryId: learnedCategoryId, debtPersonId: null });
        return (await db.query.importedTransactions.findFirst({ where: eq(importedTransactions.id, id) }))!;
      }
    } else {
      const learnedIncomeSourceId = await suggestIncomeSourceFromHistory(row.payeeClean);
      if (learnedIncomeSourceId !== null) {
        await categorizeTransactionAsIncome(id, { incomeSourceId: learnedIncomeSourceId });
        return (await db.query.importedTransactions.findFirst({ where: eq(importedTransactions.id, id) }))!;
      }
    }
  }

  return row;
}

export async function getPendingTransactions(filters?: {
  bankAccountId?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const conditions = [eq(importedTransactions.status, "pending_review")];
  if (filters?.bankAccountId !== undefined) {
    conditions.push(eq(importedTransactions.bankAccountId, filters.bankAccountId));
  }
  if (filters?.dateFrom !== undefined) {
    conditions.push(gte(importedTransactions.bookingDate, filters.dateFrom));
  }
  if (filters?.dateTo !== undefined) {
    conditions.push(lte(importedTransactions.bookingDate, filters.dateTo));
  }
  return db.query.importedTransactions.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => [desc(t.bookingDate)],
  });
}

/** For the review UI's "this might already be logged as..." hint - the
 * stored possibleDuplicateExpenseEntryId is just an id, this resolves it to
 * something displayable. Returns null if the expense was since edited away
 * from matching, or deleted - the hint is advisory, so silently dropping a
 * stale one is correct, not an error. */
export async function getPossibleDuplicateDetails(
  expenseEntryId: number
): Promise<{ id: number; categoryName: string; amountPence: number; entryDate: string; note: string | null } | null> {
  const row = await db
    .select({
      id: expenseEntries.id,
      categoryName: categories.name,
      amountPence: expenseEntries.amountPence,
      entryDate: expenseEntries.entryDate,
      note: expenseEntries.note,
    })
    .from(expenseEntries)
    .innerJoin(categories, eq(expenseEntries.categoryId, categories.id))
    .where(eq(expenseEntries.id, expenseEntryId))
    .limit(1);
  return row[0] ?? null;
}

/** Creates the real expenseEntries row (via the same logExpense every
 * other expense goes through, so rollup/AVAILABLE math is identical either
 * way) and marks the staged row categorized, linked back for traceability. */
export async function categorizeTransaction(
  id: number,
  input: { categoryId: number; debtPersonId: number | null }
) {
  const row = await db.query.importedTransactions.findFirst({ where: eq(importedTransactions.id, id) });
  if (!row) throw new Error(`Staged transaction ${id} not found.`);
  if (row.amountPence >= 0) {
    throw new Error("Only money-out (negative amount) transactions can be categorized as an expense.");
  }

  await logExpense({
    categoryId: input.categoryId,
    amountPence: Math.abs(row.amountPence),
    entryDate: row.bookingDate,
    note: row.payeeClean ?? row.payeeRaw,
    debtPersonId: input.debtPersonId ?? undefined,
    importedTransactionId: id,
  });

  await db
    .update(importedTransactions)
    .set({ status: "categorized" })
    .where(eq(importedTransactions.id, id));
}

/** Income's equivalent of categorizeTransaction - but income_entries is one
 * aggregate row per (source, year, month), not one row per transaction, so
 * there's no insert-a-new-row step the way logExpense has. Adds into
 * whatever's already there for that month (incrementIncomeEntry), never
 * replaces it - a second incoming payment the same month must not clobber
 * the first. categorizedIncomeSourceId is the traceability record instead
 * of a reverse FK from income_entries (see the schema comment on it). */
export async function categorizeTransactionAsIncome(
  id: number,
  input: { incomeSourceId: number }
) {
  const row = await db.query.importedTransactions.findFirst({ where: eq(importedTransactions.id, id) });
  if (!row) throw new Error(`Staged transaction ${id} not found.`);
  if (row.amountPence <= 0) {
    throw new Error("Only money-in (positive amount) transactions can be categorized as income.");
  }

  const { year, month } = await resolvePeriodForDate(row.bookingDate);
  await incrementIncomeEntry({
    incomeSourceId: input.incomeSourceId,
    year,
    month,
    amountPence: row.amountPence,
  });

  await db
    .update(importedTransactions)
    .set({ status: "categorized", categorizedIncomeSourceId: input.incomeSourceId })
    .where(eq(importedTransactions.id, id));
}

/** Reversible - nothing is ever hard-deleted, see the schema comment.
 * Covers both "this is a transfer" and "I already logged this manually". */
export async function ignoreTransaction(id: number) {
  await db.update(importedTransactions).set({ status: "ignored" }).where(eq(importedTransactions.id, id));
}

export async function bulkIgnoreTransactions(ids: number[]) {
  if (ids.length === 0) return;
  await db
    .update(importedTransactions)
    .set({ status: "ignored" })
    .where(or(...ids.map((id) => eq(importedTransactions.id, id))));
}

/** Undo for ignoreTransaction - back to the review pool. Does NOT undo a
 * categorize (that already created a real, independent expense; removing
 * it is a normal expense delete, not an undo of the import step). */
export async function restoreTransaction(id: number) {
  await db.update(importedTransactions).set({ status: "pending_review" }).where(eq(importedTransactions.id, id));
}
