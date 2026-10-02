import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "./index";
import { logExpense, incrementIncomeEntry, confirmPencilledExpense } from "./queries";
import { addDebtEntry } from "./debt";
import { resolvePeriodForDate } from "./pay-period";
import {
  bankAccounts,
  categories,
  categoryRules,
  expenseEntries,
  importedTransactions,
  people,
} from "./schema";
import { getAccountTransactions, toRawImportedTransaction, gcAmountToPence } from "../gocardless";
import {
  validateConditions,
  allConditionsMatch,
  ruleConditionsOf,
  type RuleCondition,
} from "../rules";

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
  const { booked, pending } = await getAccountTransactions(account.externalAccountId, dateFrom);
  const staged = await stageImportedTransactions(bankAccountId, booked.map(toRawImportedTransaction));

  // Cached here (one call, shared with the real sync) rather than
  // fetched separately by the Review page - see the schema comment on
  // pendingPreviewJson for why a second live call per page view isn't
  // safe against this endpoint's own rate limit.
  const pendingPreview: Omit<PendingPreviewTransaction, "bankAccountId" | "bankAccountName">[] = pending.map((t) => ({
    amountPence: gcAmountToPence(t.transactionAmount.amount),
    date: t.bookingDate ?? t.valueDate ?? null,
    payeeRaw: t.creditorName || t.debtorName || t.remittanceInformationUnstructured || "Unknown payee",
  }));

  await db
    .update(bankAccounts)
    .set({ lastSyncedAt: new Date(), pendingPreviewJson: JSON.stringify(pendingPreview) })
    .where(eq(bankAccounts.id, bankAccountId));

  return { staged: staged.length };
}

export type SyncResult =
  | { bankAccountId: number; displayName: string; ok: true; staged: number }
  | { bankAccountId: number; displayName: string; ok: false; error: string };

/** One account's consent expiring (a normal, EXPECTED recurring event - not
 * a bug) must not block every other account from syncing - each account's
 * sync is isolated so one failure is reported, not thrown, letting the
 * loop continue. */
export async function syncAllBankAccounts(): Promise<SyncResult[]> {
  const accounts = await getBankAccounts();
  const results: SyncResult[] = [];
  for (const account of accounts) {
    try {
      const { staged } = await syncBankAccount(account.id);
      results.push({ bankAccountId: account.id, displayName: account.displayName, ok: true, staged });
    } catch (err) {
      results.push({
        bankAccountId: account.id,
        displayName: account.displayName,
        ok: false,
        error: err instanceof Error ? err.message : "Sync failed",
      });
    }
  }
  return results;
}

export type PendingPreviewTransaction = {
  bankAccountId: number;
  bankAccountName: string;
  amountPence: number;
  // Not necessarily a real booking date - a pending transaction has no
  // bookingDate at all (see the GcTransaction comment in lib/gocardless.ts),
  // only valueDate. Named generically since what's shown here is "the best
  // date GoCardless currently has for this", not a settled booking date.
  date: string | null;
  payeeRaw: string;
};

/** Read-only preview of GoCardless's own "pending" transactions (not yet
 * settled/booked). Reads the cache syncBankAccount writes - deliberately
 * NOT a live GoCardless call (see the schema comment on
 * pendingPreviewJson for why a second live call per page view isn't safe
 * against that endpoint's rate limit). Showing pending transactions at
 * all (rather than staging them like booked ones) is itself deliberate:
 * some banks change a transaction's id when it settles from pending to
 * booked (confirmed via research, not assumed), so staging pending rows
 * the same way booked ones are staged would risk a genuine double-count
 * once the same real transaction reappears as booked under a different
 * id - nothing here is ever written to imported_transactions, so there's
 * nothing to double-count. Safe to call on every page render regardless,
 * since it's a plain DB read. A row with no cache yet (never synced) or
 * malformed JSON is skipped rather than thrown on - this is a best-effort
 * visibility aid, not load-bearing. */
export async function getPendingPreview(): Promise<PendingPreviewTransaction[]> {
  const accounts = await getBankAccounts();
  const results: PendingPreviewTransaction[] = [];
  for (const account of accounts) {
    if (!account.pendingPreviewJson) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(account.pendingPreviewJson);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const t of parsed) {
      if (
        typeof t !== "object" ||
        t === null ||
        typeof t.amountPence !== "number" ||
        typeof t.payeeRaw !== "string"
      ) {
        continue;
      }
      results.push({
        bankAccountId: account.id,
        bankAccountName: account.displayName,
        amountPence: t.amountPence,
        date: typeof t.date === "string" ? t.date : null,
        payeeRaw: t.payeeRaw,
      });
    }
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

export type RuleTarget =
  | { targetType: "expense"; categoryId: number; debtPersonId?: number }
  | { targetType: "income"; incomeSourceId: number; debtPersonId?: number };

/** Stored conditions are all-must-match. field/operator/value mirror the
 * first condition so the single-condition columns stay valid (they're NOT
 * NULL) - see the schema comment on `conditions`. New rules go to the end
 * of the order: first match wins, same as before. */
export async function addCategoryRule(input: { conditions: RuleCondition[] } & RuleTarget) {
  const conditions = validateConditions(input.conditions);
  const [maxRow] = await db
    .select({ max: sql<number>`max(${categoryRules.sortOrder})` })
    .from(categoryRules);
  const first = conditions[0];
  const target =
    input.targetType === "expense"
      ? { targetType: "expense" as const, categoryId: input.categoryId, debtPersonId: input.debtPersonId }
      : { targetType: "income" as const, incomeSourceId: input.incomeSourceId, debtPersonId: input.debtPersonId };
  const [created] = await db
    .insert(categoryRules)
    .values({
      field: first.field,
      operator: first.operator,
      value: first.value,
      conditions: JSON.stringify(conditions),
      ...target,
      sortOrder: (maxRow?.max ?? -1) + 1,
    })
    .returning();
  return created;
}

export async function deactivateCategoryRule(id: number) {
  await db.update(categoryRules).set({ active: false }).where(eq(categoryRules.id, id));
}

export type RuleMatch =
  | { targetType: "expense"; categoryId: number; debtPersonId: number | null }
  | { targetType: "income"; incomeSourceId: number; debtPersonId: number | null };

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
  for (const rule of rules) {
    if (rule.targetType !== direction) continue;

    const matched = allConditionsMatch(ruleConditionsOf(rule), transaction);
    if (!matched) continue;

    if (rule.targetType === "expense") {
      // categoryId is NOT NULL at the application level for an "expense"
      // rule (enforced by addCategoryRule's discriminated input type), but
      // the column itself is nullable in the schema (shared with income
      // rules) - the ! is safe given that invariant, not a type escape hatch
      // papering over a real gap.
      return { targetType: "expense", categoryId: rule.categoryId!, debtPersonId: rule.debtPersonId ?? null };
    }
    return { targetType: "income", incomeSourceId: rule.incomeSourceId!, debtPersonId: rule.debtPersonId ?? null };
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
      // ruleMatch.debtPersonId is null when the RULE itself has no debt tag
      // - that must not override the category's own linkedDebtPersonId, so
      // pass undefined (no explicit choice) rather than null (opt-out).
      await categorizeTransaction(id, {
        categoryId: ruleMatch.categoryId,
        debtPersonId: ruleMatch.debtPersonId ?? undefined,
      });
    } else {
      await categorizeTransactionAsIncome(id, {
        incomeSourceId: ruleMatch.incomeSourceId,
        debtPersonId: ruleMatch.debtPersonId ?? undefined,
      });
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
        await categorizeTransaction(id, { categoryId: learnedCategoryId });
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
export async function getPossibleDuplicateDetails(expenseEntryId: number): Promise<{
  id: number;
  categoryName: string;
  amountPence: number;
  entryDate: string;
  note: string | null;
  provisional: boolean;
} | null> {
  const row = await db
    .select({
      id: expenseEntries.id,
      categoryName: categories.name,
      amountPence: expenseEntries.amountPence,
      entryDate: expenseEntries.entryDate,
      note: expenseEntries.note,
      provisional: expenseEntries.provisional,
    })
    .from(expenseEntries)
    .innerJoin(categories, eq(expenseEntries.categoryId, categories.id))
    .where(eq(expenseEntries.id, expenseEntryId))
    .limit(1);
  return row[0] ?? null;
}

/** The real transaction settling matches what the user pencilled in -
 * makes that draft permanent and marks this bank row as already logged
 * (same "ignored" status as any other already-logged duplicate, see
 * ignoreTransaction). */
export async function confirmPencilledMatch(importedTransactionId: number, expenseEntryId: number) {
  await confirmPencilledExpense(expenseEntryId, importedTransactionId);
  await ignoreTransaction(importedTransactionId);
}

/** A person must exist BEFORE anything is written for them: the loan/
 * repayment row is inserted after the income/expense one, so a bad id
 * would otherwise fail midway and leave the money recorded but the row
 * still waiting in Review (and double-counted on retry). */
async function assertPersonExists(personId: number | null | undefined) {
  if (!personId) return;
  const person = await db.query.people.findFirst({ where: eq(people.id, personId) });
  if (!person) throw new Error("That person no longer exists - pick someone else.");
}

/** Creates the real expenseEntries row (via the same logExpense every
 * other expense goes through, so rollup/AVAILABLE math is identical either
 * way) and marks the staged row categorized, linked back for traceability. */
export async function categorizeTransaction(
  id: number,
  // debtPersonId omitted (not null) falls back to the category's own
  // linkedDebtPersonId, if any - see logExpense.
  input: { categoryId: number; debtPersonId?: number | null }
) {
  const row = await db.query.importedTransactions.findFirst({ where: eq(importedTransactions.id, id) });
  if (!row) throw new Error(`Staged transaction ${id} not found.`);
  if (row.status !== "pending_review") {
    // A stale tab or selection must never log a second expense for a
    // transaction that was already categorized (or deliberately ignored).
    throw new Error("This transaction was already handled.");
  }
  if (row.amountPence >= 0) {
    throw new Error("Only money-out (negative amount) transactions can be categorized as an expense.");
  }
  await assertPersonExists(input.debtPersonId);

  await logExpense({
    categoryId: input.categoryId,
    amountPence: Math.abs(row.amountPence),
    entryDate: row.bookingDate,
    note: row.payeeClean ?? row.payeeRaw,
    debtPersonId: input.debtPersonId,
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
  // debtPersonId: this money is a LOAN from that person - recorded on the
  // Debt ledger as well as counting as income (it's really in the bank),
  // exactly like "This is a loan" in the grid's Add income dialog.
  input: { incomeSourceId: number; debtPersonId?: number }
) {
  const row = await db.query.importedTransactions.findFirst({ where: eq(importedTransactions.id, id) });
  if (!row) throw new Error(`Staged transaction ${id} not found.`);
  if (row.status !== "pending_review") throw new Error("This transaction was already handled.");
  if (row.amountPence <= 0) {
    throw new Error("Only money-in (positive amount) transactions can be categorized as income.");
  }
  await assertPersonExists(input.debtPersonId);

  const { year, month } = await resolvePeriodForDate(row.bookingDate);
  await incrementIncomeEntry({
    incomeSourceId: input.incomeSourceId,
    year,
    month,
    amountPence: row.amountPence,
  });

  if (input.debtPersonId) {
    await addDebtEntry({
      personId: input.debtPersonId,
      entryDate: row.bookingDate,
      amountPence: row.amountPence,
      direction: "loan",
      note: row.payeeClean ?? row.payeeRaw,
    });
  }

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

/** Only ids still waiting in Review are touched: a stale tab or selection
 * can carry ids that were categorized or ignored since, and those must be
 * skipped quietly rather than abort the batch partway (or, worse, log a
 * second expense for something already logged). */
async function stillPending(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: importedTransactions.id })
    .from(importedTransactions)
    .where(and(inArray(importedTransactions.id, ids), eq(importedTransactions.status, "pending_review")));
  return rows.map((r) => r.id);
}

/** Bulk form of categorizeTransaction/categorizeTransactionAsIncome - for
 * applying one chosen category/source to a whole batch at once (e.g.
 * catching up a big import where many rows share the same payee). Each
 * transaction still becomes its own real expense/income row; this is just a
 * loop, not a different code path - so rollup math and the debt-link
 * fallback behave identically to categorizing one at a time. */
export async function bulkCategorizeTransactionsAsExpense(
  ids: number[],
  input: { categoryId: number; debtPersonId?: number | null }
) {
  for (const id of await stillPending(ids)) {
    await categorizeTransaction(id, input);
  }
}

export async function bulkCategorizeTransactionsAsIncome(
  ids: number[],
  input: { incomeSourceId: number; debtPersonId?: number }
) {
  for (const id of await stillPending(ids)) {
    await categorizeTransactionAsIncome(id, input);
  }
}

export async function bulkIgnoreTransactions(ids: number[]) {
  if (ids.length === 0) return;
  // inArray, not or(...ids.map(eq)) - a "select all" bulk-ignore after a
  // large import can mean thousands of ids; one IN clause instead of
  // thousands of OR'd equality terms.
  await db
    .update(importedTransactions)
    .set({ status: "ignored" })
    .where(and(inArray(importedTransactions.id, ids), eq(importedTransactions.status, "pending_review")));
}

/** Undo for ignoreTransaction - back to the review pool. Does NOT undo a
 * categorize (that already created a real, independent expense; removing
 * it is a normal expense delete, not an undo of the import step). */
export async function restoreTransaction(id: number) {
  await db.update(importedTransactions).set({ status: "pending_review" }).where(eq(importedTransactions.id, id));
}

// ---- Rule preview + apply (Review "Rule" window) ----

const MAX_PREVIEW_ROWS = 1000;

export type RulePreviewRow = {
  id: number;
  bookingDate: string;
  payeeRaw: string;
  payeeClean: string | null;
  amountPence: number;
  /** Matches the rule but can't (or shouldn't) be bulk-applied: a
   * pencilled-in draft has to be confirmed/discarded on its own row;
   * a possible duplicate is shown but left unticked by default. */
  blocked: "pencilled-match" | "possible-duplicate" | null;
};

export type RulePreview = {
  rows: RulePreviewRow[];
  /** Real number of matches - rows is capped, this isn't. */
  total: number;
  /** How many of the matches an EXISTING rule would already claim on
   * import (first match wins, so the new rule wouldn't fire for those). */
  alreadyCoveredByEarlierRule: number;
};

/** Every transaction still waiting in Review that these conditions would
 * catch - searches the WHOLE pending pool (not just whatever date filter
 * the page is showing) and uses the exact matcher imports use, so what
 * the preview shows is what the rule will really do. Direction is fixed
 * by the target: expense rules only see money out, income only money in. */
export async function previewRuleMatches(
  conditionsInput: RuleCondition[],
  direction: "expense" | "income"
): Promise<RulePreview> {
  const conditions = validateConditions(conditionsInput);
  const pending = await db
    .select()
    .from(importedTransactions)
    .where(
      and(
        eq(importedTransactions.status, "pending_review"),
        direction === "expense" ? sql`${importedTransactions.amountPence} < 0` : sql`${importedTransactions.amountPence} > 0`
      )
    )
    .orderBy(sql`${importedTransactions.bookingDate} desc`, sql`${importedTransactions.id} desc`);

  const matches = pending.filter((t) => allConditionsMatch(conditions, t));

  const duplicateIds = matches
    .map((t) => t.possibleDuplicateExpenseEntryId)
    .filter((id): id is number => id !== null);
  const provisionalById = new Map<number, boolean>();
  if (duplicateIds.length > 0) {
    const entries = await db
      .select({ id: expenseEntries.id, provisional: expenseEntries.provisional })
      .from(expenseEntries)
      .where(inArray(expenseEntries.id, duplicateIds));
    for (const e of entries) provisionalById.set(e.id, e.provisional);
  }

  const existingRules = await getCategoryRules();
  let alreadyCoveredByEarlierRule = 0;
  const rows: RulePreviewRow[] = [];
  for (const t of matches) {
    if (matchCategoryRule(t, existingRules)) alreadyCoveredByEarlierRule++;
    if (rows.length >= MAX_PREVIEW_ROWS) continue;
    const dupId = t.possibleDuplicateExpenseEntryId;
    const dupStillExists = dupId !== null && provisionalById.has(dupId);
    rows.push({
      id: t.id,
      bookingDate: t.bookingDate,
      payeeRaw: t.payeeRaw,
      payeeClean: t.payeeClean,
      amountPence: t.amountPence,
      blocked: !dupStillExists ? null : provisionalById.get(dupId!) ? "pencilled-match" : "possible-duplicate",
    });
  }
  return { rows, total: matches.length, alreadyCoveredByEarlierRule };
}

export type CreateRuleAndApplyResult = {
  ruleId: number;
  categorized: number;
  /** Ids that were asked for but not applied (no longer matching, no
   * longer pending, pencilled-in, or failed) - with why, never silent. */
  skipped: { id: number; reason: string }[];
};

/** Saves the rule, then (optionally) categorizes the chosen matches with
 * the same target. The ids are only a request: each one is re-checked
 * against what the rule really matches RIGHT NOW, so a stale tab, a row
 * categorized elsewhere in the meantime, or a tampered request can't push
 * a non-matching transaction into the wrong category. */
export async function createRuleAndCategorize(input: {
  conditions: RuleCondition[];
  target: RuleTarget;
  applyToIds: number[];
}): Promise<CreateRuleAndApplyResult> {
  const conditions = validateConditions(input.conditions);
  const rule = await addCategoryRule({ conditions, ...input.target });

  const skipped: { id: number; reason: string }[] = [];
  let categorized = 0;
  if (input.applyToIds.length === 0) return { ruleId: rule.id, categorized, skipped };

  const preview = await previewRuleMatches(conditions, input.target.targetType);
  const eligible = new Map(preview.rows.map((r) => [r.id, r]));
  for (const id of new Set(input.applyToIds)) {
    const row = eligible.get(id);
    if (!row) {
      skipped.push({ id, reason: "no longer matches or is no longer waiting in Review" });
      continue;
    }
    if (row.blocked === "pencilled-match") {
      skipped.push({ id, reason: "matches a pencilled-in entry - confirm or discard it on its own row" });
      continue;
    }
    try {
      if (input.target.targetType === "expense") {
        await categorizeTransaction(id, { categoryId: input.target.categoryId, debtPersonId: input.target.debtPersonId });
      } else {
        await categorizeTransactionAsIncome(id, {
          incomeSourceId: input.target.incomeSourceId,
          debtPersonId: input.target.debtPersonId,
        });
      }
      categorized++;
    } catch (err) {
      skipped.push({ id, reason: err instanceof Error ? err.message : "failed" });
    }
  }
  return { ruleId: rule.id, categorized, skipped };
}
