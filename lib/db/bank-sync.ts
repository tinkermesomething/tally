import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, inTransaction } from "./index";
import { accountDisplayName } from "../accounts";
import { logExpense, incrementIncomeEntry, confirmPencilledExpense } from "./queries";
import { addDebtEntry } from "./debt";
import { addTagsToExpense } from "./retro-tags";
import { recordAnchorForWage } from "./pay-period";
import { parseIsoDate } from "../date";
import {
  bankAccounts,
  categories,
  categoryRules,
  debtLedgerEntries,
  expenseEntries,
  importedTransactions,
  incomeSources,
  people,
  savingsBuckets,
  savingsEntries,
} from "./schema";
import { getAccountTransactions, toRawImportedTransaction, gcAmountToPence, payeeFromTransaction } from "../gocardless";
import {
  validateConditions,
  allConditionsMatch,
  payeesMatch,
  ruleConditionsOf,
  type RuleCondition,
} from "../rules";

// ---- Bank accounts ----

/** bank_accounts.provider for accounts that only ever receive CSV imports. */
export const CSV_PROVIDER = "csv";

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

const MAX_ALIAS_LENGTH = 60;

/** Sets (or, with an empty string, clears) the user's own name for an account. */
export async function setBankAccountAlias(id: number, alias: string) {
  const text = alias.replace(/\s+/g, " ").trim();
  if (text.length > MAX_ALIAS_LENGTH) throw new Error(`Aliases can be at most ${MAX_ALIAS_LENGTH} characters.`);
  const updated = await db
    .update(bankAccounts)
    .set({ alias: text || null })
    .where(eq(bankAccounts.id, id))
    .returning({ id: bankAccounts.id });
  if (updated.length === 0) throw new Error("That account no longer exists.");
}

export type RecentTransaction = {
  id: number;
  bookingDate: string;
  payee: string;
  amountPence: number;
  status: "pending_review" | "categorized" | "ignored";
};

/** The newest few transactions per account - enough to recognise which
 * account is which at a glance. */
export async function getRecentTransactions(accountIds: number[], limit = 5): Promise<Map<number, RecentTransaction[]>> {
  const out = new Map<number, RecentTransaction[]>();
  for (const id of accountIds) {
    const rows = await db
      .select()
      .from(importedTransactions)
      .where(eq(importedTransactions.bankAccountId, id))
      .orderBy(desc(importedTransactions.bookingDate), desc(importedTransactions.id))
      .limit(limit);
    out.set(
      id,
      rows.map((r) => ({ id: r.id, bookingDate: r.bookingDate, payee: r.payeeClean ?? r.payeeRaw, amountPence: r.amountPence, status: r.status }))
    );
  }
  return out;
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
// Banks can report a transaction days after its booking date, so a re-sync
// starts a few days BEFORE the last one. Re-fetched rows are harmless: the
// (account, importedId) unique index drops anything already staged.
const SYNC_OVERLAP_DAYS = 7;

export async function syncBankAccount(bankAccountId: number): Promise<{ staged: number }> {
  const account = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, bankAccountId) });
  if (!account) throw new Error(`Bank account ${bankAccountId} not found.`);
  if (account.provider === CSV_PROVIDER) throw new Error("This account is CSV-only - import a CSV file instead of syncing.");

  const dateFrom = account.lastSyncedAt
    ? new Date(account.lastSyncedAt.getTime() - SYNC_OVERLAP_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : undefined;
  const { booked, pending } = await getAccountTransactions(account.externalAccountId, dateFrom);
  // One malformed item must not block the account's other transactions (or
  // keep lastSyncedAt from advancing) - skip it loudly instead.
  const raw = booked.flatMap((t) => {
    const parsed = toRawImportedTransaction(t);
    if (!parsed) console.warn(`[bank-sync] skipped unusable booked transaction on account ${bankAccountId}:`, t.transactionId ?? t.internalTransactionId);
    return parsed ? [parsed] : [];
  });
  const staged = await stageImportedTransactions(bankAccountId, raw);

  // Cached here (one call, shared with the real sync) rather than
  // fetched separately by the Review page - see the schema comment on
  // pendingPreviewJson for why a second live call per page view isn't
  // safe against this endpoint's own rate limit.
  const pendingPreview: Omit<PendingPreviewTransaction, "bankAccountId" | "bankAccountName" | "pencilled" | "ruleMatch">[] = pending.map((t) => ({
    amountPence: gcAmountToPence(t.transactionAmount.amount),
    date: t.bookingDate ?? t.valueDate ?? null,
    payeeRaw: payeeFromTransaction(t),
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
export function syncAllBankAccounts(): Promise<SyncResult[]> {
  // One pass at a time across BOTH callers (the scheduler and the manual API
  // endpoint): a second caller joins the pass already running instead of
  // starting another, which would spend GoCardless's tiny per-account daily
  // quota twice for the same data.
  syncInFlight ??= syncEachAccount().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

let syncInFlight: Promise<SyncResult[]> | null = null;

async function syncEachAccount(): Promise<SyncResult[]> {
  // CSV-only accounts have nothing to sync from.
  const accounts = (await getBankAccounts()).filter((a) => a.provider !== CSV_PROVIDER);
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
  /** Already pencilled in as an expense (a provisional entry with this
   * amount and payee exists) - the preview comes from the bank's cache, so
   * without this a refresh offered the pencil again. */
  pencilled: boolean;
  /** An existing rule's conditions already match this row (money-out, so
   * only ever an expense target) - lets Review default the Pencil-in picker
   * to it instead of asking the user to categorize every single one by
   * hand again. Still just a default: the picker can be changed. */
  ruleMatch: { categoryId: number; categoryName: string; debtPersonId?: number; savingsBucketId?: number } | null;
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
  const rules = await getCategoryRules();
  const categoryNameById = new Map((await db.select({ id: categories.id, name: categories.name }).from(categories)).map((c) => [c.id, c.name]));
  // pencilInExpense stores the preview's payee as the note and its amount as
  // a positive figure. Each provisional entry covers ONE preview row, so two
  // identical pending rows with one pencilled show one pencil.
  const provisional = await db
    .select({ amountPence: expenseEntries.amountPence, note: expenseEntries.note })
    .from(expenseEntries)
    .where(eq(expenseEntries.provisional, true));
  const claimed = provisional.map((e) => ({ ...e, used: false }));
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
      const match =
        t.amountPence < 0
          ? claimed.find((e) => !e.used && e.amountPence === Math.abs(t.amountPence) && e.note === t.payeeRaw)
          : undefined;
      if (match) match.used = true;
      // Same matcher sync uses - direction-filtered the same way (an
      // expense rule only ever matches money-out), so what this suggests
      // is exactly what the rule would do once the real row settles.
      const ruleMatch = t.amountPence < 0 ? matchCategoryRule({ payeeRaw: t.payeeRaw, payeeClean: null, amountPence: t.amountPence, bankAccountId: account.id }, rules) : null;
      results.push({
        bankAccountId: account.id,
        bankAccountName: accountDisplayName(account),
        amountPence: t.amountPence,
        date: typeof t.date === "string" ? t.date : null,
        payeeRaw: t.payeeRaw,
        pencilled: !!match,
        ruleMatch:
          ruleMatch && ruleMatch.targetType === "expense"
            ? {
                categoryId: ruleMatch.categoryId,
                categoryName: categoryNameById.get(ruleMatch.categoryId) ?? "Unknown category",
                debtPersonId: ruleMatch.debtPersonId ?? undefined,
                savingsBucketId: ruleMatch.savingsBucketId ?? undefined,
              }
            : null,
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
  | { targetType: "expense"; categoryId: number; debtPersonId?: number; savingsBucketId?: number }
  | { targetType: "income"; incomeSourceId: number; debtPersonId?: number }
  // Matching rows are ignored instead of categorized - e.g. money moved
  // between your own accounts. Applies to money in AND out, so both halves
  // of a transfer clear.
  | { targetType: "ignore" };

/** An account condition must point at a real linked account. */
async function assertConditionAccountsExist(conditions: RuleCondition[]) {
  for (const c of conditions) {
    if (c.field !== "account") continue;
    const id = parseInt(c.value, 10);
    const account = Number.isNaN(id) ? undefined : await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, id) });
    if (!account) throw new Error("That bank account no longer exists.");
  }
}

/** A rule's target (category / income source / person) must exist now, so a
 * stale form can't save a rule that would throw on every import. */
async function assertRuleTargetExists(t: RuleTarget) {
  if (t.targetType === "expense") {
    if (!(await db.query.categories.findFirst({ where: eq(categories.id, t.categoryId) }))) {
      throw new Error("That category no longer exists.");
    }
  } else if (t.targetType === "income") {
    if (!(await db.query.incomeSources.findFirst({ where: eq(incomeSources.id, t.incomeSourceId) }))) {
      throw new Error("That income source no longer exists.");
    }
  }
  await assertPersonExists(t.targetType === "ignore" ? undefined : t.debtPersonId);
  if (t.targetType === "expense" && t.savingsBucketId !== undefined) {
    const bucket = await db.query.savingsBuckets.findFirst({ where: eq(savingsBuckets.id, t.savingsBucketId) });
    if (!bucket || bucket.archived) throw new Error("That savings bucket no longer exists.");
  }
}

/** Stored conditions are all-must-match. field/operator/value mirror the
 * first condition so the single-condition columns stay valid (they're NOT
 * NULL) - see the schema comment on `conditions`. New rules go to the end
 * of the order: first match wins. */
export async function addCategoryRule(input: { conditions: RuleCondition[] } & RuleTarget) {
  const conditions = validateConditions(input.conditions);
  await assertConditionAccountsExist(conditions);
  await assertRuleTargetExists(input);
  const [maxRow] = await db
    .select({ max: sql<number>`max(${categoryRules.sortOrder})` })
    .from(categoryRules);
  const first = conditions[0];
  const target = ruleTargetColumns(input);
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

/** The target columns for a rule - the ones that don't apply are set to
 * null explicitly, so editing a rule from one target type to another never
 * leaves a stale category/source/person behind. */
function ruleTargetColumns(t: RuleTarget) {
  return {
    targetType: t.targetType,
    categoryId: t.targetType === "expense" ? t.categoryId : null,
    incomeSourceId: t.targetType === "income" ? t.incomeSourceId : null,
    debtPersonId: t.targetType === "ignore" ? null : (t.debtPersonId ?? null),
    savingsBucketId: t.targetType === "expense" ? (t.savingsBucketId ?? null) : null,
  };
}

/** Edits a rule in place: keeps its position in the first-match-wins order
 * and only changes future imports - transactions already categorized by it
 * stay as they are. */
export async function updateCategoryRule(id: number, input: { conditions: RuleCondition[] } & RuleTarget) {
  const conditions = validateConditions(input.conditions);
  await assertConditionAccountsExist(conditions);
  const existing = await db.query.categoryRules.findFirst({
    where: and(eq(categoryRules.id, id), eq(categoryRules.active, true)),
  });
  if (!existing) throw new Error("This rule no longer exists.");
  await assertRuleTargetExists(input);
  const first = conditions[0];
  const [updated] = await db
    .update(categoryRules)
    .set({
      field: first.field,
      operator: first.operator,
      value: first.value,
      conditions: JSON.stringify(conditions),
      ...ruleTargetColumns(input),
    })
    .where(eq(categoryRules.id, id))
    .returning();
  return updated;
}

export async function deactivateCategoryRule(id: number) {
  await db.update(categoryRules).set({ active: false }).where(eq(categoryRules.id, id));
}

export type RuleMatch =
  | { targetType: "expense"; categoryId: number; debtPersonId: number | null; savingsBucketId: number | null }
  | { targetType: "income"; incomeSourceId: number; debtPersonId: number | null }
  | { targetType: "ignore" };

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
  transaction: { payeeRaw: string; payeeClean: string | null; amountPence: number; bankAccountId?: number },
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
    // Ignore rules are direction-free (both halves of a transfer).
    if (rule.targetType !== "ignore" && rule.targetType !== direction) continue;

    const matched = allConditionsMatch(ruleConditionsOf(rule), transaction);
    if (!matched) continue;

    if (rule.targetType === "ignore") return { targetType: "ignore" };

    if (rule.targetType === "expense") {
      // categoryId is NOT NULL at the application level for an "expense"
      // rule (enforced by addCategoryRule's discriminated input type), but
      // the column itself is nullable in the schema (shared with income
      // rules) - the ! is safe given that invariant, not a type escape hatch
      // papering over a real gap.
      return {
        targetType: "expense",
        categoryId: rule.categoryId!,
        debtPersonId: rule.debtPersonId ?? null,
        savingsBucketId: rule.savingsBucketId ?? null,
      };
    }
    return { targetType: "income", incomeSourceId: rule.incomeSourceId!, debtPersonId: rule.debtPersonId ?? null };
  }
  return null;
}

// ---- Possible-duplicate suggestion (manual entries only - never automatic) ----

// A manually-logged expense is only a candidate within a day of the booking.
const MANUAL_DUPLICATE_WINDOW_DAYS = 1;
// A pencilled-in draft carries the PENDING date (or today's, when the bank
// gave none), and a transaction can settle days later (weekends, bank
// holidays) - so a draft is a candidate across a much wider window.
const PENCILLED_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

// Date.UTC + toISOString round-trips exactly regardless of the server's
// local timezone - constructing via `new Date(y, m-1, d)` (local midnight)
// and then calling toISOString() on it does NOT: toISOString always renders
// in UTC, so a positive local offset (e.g. UK's BST) silently shifts the
// calendar date back by a day.
function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function shiftIsoDate(iso: string, days: number): string {
  return new Date(isoToUtcMs(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Finds an already-logged expense this bank row is probably the same money
 * as - same amount, near the same date, no provider id to exact-match
 * against (so necessarily fuzzy). A SUGGESTION only: the review UI surfaces
 * it, the user decides whether to confirm it, ignore the staged row or
 * categorize it as a genuinely separate transaction. Only meaningful for
 * money-out (negative imported amounts) against expenses, which are always
 * positive.
 *
 * Ranking when several qualify: a pencilled-in draft wins over a manual
 * entry (it is a placeholder waiting for exactly this row), then the one
 * whose note is this row's payee, then the closest date. A draft already
 * suggested for another waiting row is skipped, so two identical purchases
 * pair one-to-one instead of both pointing at the same draft. */
export async function findPossibleManualDuplicate(
  amountPence: number,
  bookingDate: string,
  payeeRaw?: string
): Promise<number | null> {
  if (amountPence >= 0) return null;

  const wide = shiftIsoDate(bookingDate, -PENCILLED_WINDOW_DAYS);
  const wideEnd = shiftIsoDate(bookingDate, PENCILLED_WINDOW_DAYS);
  const candidates = await db
    .select()
    .from(expenseEntries)
    .where(
      and(
        eq(expenseEntries.amountPence, Math.abs(amountPence)),
        gte(expenseEntries.entryDate, wide),
        lte(expenseEntries.entryDate, wideEnd),
        isNull(expenseEntries.importedTransactionId)
      )
    );
  if (candidates.length === 0) return null;

  const claimedRows = await db
    .select({ id: importedTransactions.possibleDuplicateExpenseEntryId })
    .from(importedTransactions)
    .where(and(eq(importedTransactions.status, "pending_review"), isNotNull(importedTransactions.possibleDuplicateExpenseEntryId)));
  const claimed = new Set(claimedRows.map((r) => r.id));

  const bookingMs = isoToUtcMs(bookingDate);
  const eligible = candidates
    .map((e) => ({ e, distanceDays: Math.abs(isoToUtcMs(e.entryDate) - bookingMs) / DAY_MS }))
    .filter(({ e, distanceDays }) =>
      e.provisional ? !claimed.has(e.id) : distanceDays <= MANUAL_DUPLICATE_WINDOW_DAYS
    );
  eligible.sort(
    (a, b) =>
      Number(b.e.provisional) - Number(a.e.provisional) ||
      Number(b.e.note === payeeRaw) - Number(a.e.note === payeeRaw) ||
      a.distanceDays - b.distanceDays ||
      a.e.id - b.e.id
  );
  return eligible[0]?.e.id ?? null;
}

// ---- Staging / review pool ----

export type RawImportedTransaction = {
  importedId: string;
  amountPence: number;
  bookingDate: string;
  payeeRaw: string;
  payeeClean?: string | null;
  /** CSV rows that look like an already-imported transaction: kept (not
   * dropped) but held in Review instead of being auto-categorized. */
  possibleDuplicateImportedId?: number | null;
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
  // All-or-nothing: if auto-categorizing one row throws, nothing is left
  // half-staged (rows inserted but never auto-processed), and the next sync
  // simply retries the whole batch.
  return inTransaction(() => stageBatch(bankAccountId, transactions));
}

async function stageBatch(bankAccountId: number, transactions: RawImportedTransaction[]) {
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
        possibleDuplicateImportedId: t.possibleDuplicateImportedId ?? null,
      }))
    )
    .onConflictDoNothing({ target: [importedTransactions.bankAccountId, importedTransactions.importedId] })
    .returning();

  // Oldest first, money in before money out within a day: a wage must
  // record its anchor before the expenses that follow it are filed, or they
  // land in the wrong month (and would need re-filing).
  inserted.sort(
    (a, b) =>
      a.bookingDate.localeCompare(b.bookingDate) ||
      Math.sign(b.amountPence) - Math.sign(a.amountPence) ||
      a.id - b.id
  );
  const rules = await getCategoryRules();
  const results = [];
  for (const row of inserted) {
    results.push(await autoProcessStagedTransaction(row, rules));
  }
  return results;
}

/** Runs the auto-categorization pipeline for one newly-staged row: a
 * possible duplicate of a manual entry always wins and blocks auto-
 * categorization (never silently create a second expense for money
 * that's possibly already logged), then explicit rules. Falls through to
 * plain pending_review if nothing matches (or a duplicate hint was set).
 * `rules` is loaded once per batch by the caller, not once per row. */
async function autoProcessStagedTransaction(row: typeof importedTransactions.$inferSelect, rules: CategoryRule[]) {
  const id = row.id;

  // A CSV row that looks like something already imported waits in Review for a
  // person to decide - rules and learned patterns must not file it behind
  // their back (that would count the same money twice).
  if (row.possibleDuplicateImportedId) return row;

  const duplicateOf = await findPossibleManualDuplicate(row.amountPence, row.bookingDate, row.payeeRaw);
  if (duplicateOf !== null) {
    // The booked row replacing the draft you pencilled in: same amount and
    // the same merchant. Confirm it here instead of waiting for a click -
    // left alone, a rule would categorize this row into a SECOND expense.
    // Strict on purpose: only a provisional draft (never a manual entry),
    // and the payee must match, not just the amount. Anything weaker stays
    // in Review with a Confirm/Discard hint.
    const draft = await db.query.expenseEntries.findFirst({ where: eq(expenseEntries.id, duplicateOf) });
    if (draft?.provisional && payeesMatch(draft.note, row.payeeRaw)) {
      await confirmPencilledMatch(id, duplicateOf);
      return (await db.query.importedTransactions.findFirst({ where: eq(importedTransactions.id, id) }))!;
    }
    await db
      .update(importedTransactions)
      .set({ possibleDuplicateExpenseEntryId: duplicateOf })
      .where(eq(importedTransactions.id, id));
    return { ...row, possibleDuplicateExpenseEntryId: duplicateOf };
  }

  const ruleMatch = matchCategoryRule(row, rules);
  if (ruleMatch) {
    if (ruleMatch.targetType === "ignore") {
      await ignoreTransaction(id);
    } else if (ruleMatch.targetType === "expense") {
      // ruleMatch.debtPersonId is null when the RULE itself has no debt tag
      // - that must not override the category's own linkedDebtPersonId, so
      // pass undefined (no explicit choice) rather than null (opt-out).
      await categorizeTransaction(id, {
        categoryId: ruleMatch.categoryId,
        debtPersonId: ruleMatch.debtPersonId ?? undefined,
        // Same as the debt tag: no savings choice on the rule must not
        // override the category's own linked bucket.
        bucketId: ruleMatch.savingsBucketId ?? undefined,
      });
    } else {
      await categorizeTransactionAsIncome(id, {
        incomeSourceId: ruleMatch.incomeSourceId,
        debtPersonId: ruleMatch.debtPersonId ?? undefined,
      });
    }
    return (await db.query.importedTransactions.findFirst({ where: eq(importedTransactions.id, id) }))!;
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
/** What an "already imported" duplicate flag points at, for Review's tooltip. */
export async function getImportedDuplicateDetails(ids: number[]) {
  const map = new Map<number, { payee: string; bookingDate: string; status: string }>();
  if (ids.length === 0) return map;
  const rows = await db.select().from(importedTransactions).where(inArray(importedTransactions.id, ids));
  for (const r of rows) map.set(r.id, { payee: r.payeeClean ?? r.payeeRaw, bookingDate: r.bookingDate, status: r.status });
  return map;
}

export async function confirmPencilledMatch(importedTransactionId: number, expenseEntryId: number) {
  await inTransaction(async () => {
    await confirmPencilledExpense(expenseEntryId, importedTransactionId);
    await ignoreTransaction(importedTransactionId);
  });
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

const MAX_NOTE_LENGTH = 200;

/** Saves (or clears, when empty) your note on a row still waiting in Review. */
export async function setTransactionNote(id: number, note: string) {
  const text = note.replace(/\s+/g, " ").trim();
  if (text.length > MAX_NOTE_LENGTH) throw new Error(`Notes can be at most ${MAX_NOTE_LENGTH} characters.`);
  const updated = await db
    .update(importedTransactions)
    .set({ note: text || null })
    .where(and(eq(importedTransactions.id, id), eq(importedTransactions.status, "pending_review")))
    .returning({ id: importedTransactions.id });
  if (updated.length === 0) throw new Error("This transaction was already handled.");
}

/** The note an entry gets from a bank row: your note first, then the payee
 * so it can still be traced back to the bank line. */
function entryNoteFor(row: { note: string | null; payeeClean: string | null; payeeRaw: string }) {
  const payee = row.payeeClean ?? row.payeeRaw;
  return row.note ? `${row.note} — ${payee}` : payee;
}

/** Creates the real expenseEntries row (via the same logExpense every
 * other expense goes through, so rollup/AVAILABLE math is identical either
 * way) and marks the staged row categorized, linked back for traceability. */
export async function categorizeTransaction(
  id: number,
  // debtPersonId omitted (not null) falls back to the category's own
  // linkedDebtPersonId, if any - see logExpense.
  input: { categoryId: number; debtPersonId?: number | null; bucketId?: number | null }
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

  await inTransaction(async () => {
    await logExpense({
      categoryId: input.categoryId,
      amountPence: Math.abs(row.amountPence),
      entryDate: row.bookingDate,
      note: entryNoteFor(row),
      debtPersonId: input.debtPersonId,
      bucketId: input.bucketId,
      importedTransactionId: id,
    });

    await db
      .update(importedTransactions)
      .set({ status: "categorized" })
      .where(eq(importedTransactions.id, id));
  });
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

  await inTransaction(async () => {
    // Only the pay-anchor source (Wages) follows the anchors: its deposit
    // records one from the bank timestamp and is filed in the month it funds.
    // Every other income keeps its plain bank-date calendar month - anchors
    // only ever re-file expenses.
    const source = await db.query.incomeSources.findFirst({ where: eq(incomeSources.id, input.incomeSourceId) });
    const { year, month } = source?.isPayAnchor
      ? await recordAnchorForWage(input.incomeSourceId, row.bookingDate)
      : parseIsoDate(row.bookingDate);
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
        note: entryNoteFor(row),
      });
    }

    await db
      .update(importedTransactions)
      .set({ status: "categorized", categorizedIncomeSourceId: input.incomeSourceId })
      .where(eq(importedTransactions.id, id));
  });
}

/** Reversible - nothing is ever hard-deleted, see the schema comment.
 * Covers both "this is a transfer" and "I already logged this manually". */
export async function ignoreTransaction(id: number) {
  // Never from "categorized": that row already created a real expense/income,
  // and flipping its status would orphan it from the Review history.
  const updated = await db
    .update(importedTransactions)
    .set({ status: "ignored" })
    .where(and(eq(importedTransactions.id, id), inArray(importedTransactions.status, ["pending_review", "ignored"])))
    .returning({ id: importedTransactions.id });
  if (updated.length === 0) throw new Error("This transaction was already handled.");
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
  await inTransaction(async () => {
    for (const id of await stillPending(ids)) {
      await categorizeTransaction(id, input);
    }
  });
}

export async function bulkCategorizeTransactionsAsIncome(
  ids: number[],
  input: { incomeSourceId: number; debtPersonId?: number }
) {
  await inTransaction(async () => {
    for (const id of await stillPending(ids)) {
      await categorizeTransactionAsIncome(id, input);
    }
  });
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
  // Only an ignored row can come back: reopening a categorized one would let
  // it be categorized a second time (a duplicate expense/income).
  const updated = await db
    .update(importedTransactions)
    .set({ status: "pending_review" })
    .where(and(eq(importedTransactions.id, id), eq(importedTransactions.status, "ignored")))
    .returning({ id: importedTransactions.id });
  if (updated.length === 0) throw new Error("Only an ignored transaction can be restored.");
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
  /** Past (already categorized) expenses this rule's debt / savings tag would
   * be added to. Null when the rule has no such tag, or isn't an expense rule. */
  retro: RetroPreview | null;
};

/** The tags a rule adds, for finding past expenses that are missing them. */
export type RuleTags = { categoryId: number; debtPersonId?: number; savingsBucketId?: number };

export type RetroRow = {
  expenseEntryId: number;
  bookingDate: string;
  payeeRaw: string;
  payeeClean: string | null;
  amountPence: number;
  /** What would be added to this expense. */
  adds: { debt: boolean; savings: boolean };
};

export type RetroPreview = {
  rows: RetroRow[];
  /** Real number - rows is capped, this isn't. */
  total: number;
  /** Matching expenses sitting in a DIFFERENT category: left alone. */
  otherCategory: number;
};

/** Every transaction still waiting in Review that these conditions would
 * catch - searches the WHOLE pending pool (not just whatever date filter
 * the page is showing) and uses the exact matcher imports use, so what
 * the preview shows is what the rule will really do. Direction is fixed
 * by the target: expense rules only see money out, income only money in. */
export async function previewRuleMatches(
  conditionsInput: RuleCondition[],
  direction: "expense" | "income" | "ignore",
  /** When editing a rule: only the rules BEFORE it can claim a row first
   * (its own old version, and later rules, can't), so the "already claimed"
   * count stays honest. Omit for a new rule, which goes last. */
  editingRuleId?: number,
  /** Expense rules: also find past expenses this rule's debt/savings tag would be added to. */
  tags?: RuleTags
): Promise<RulePreview> {
  const conditions = validateConditions(conditionsInput);
  const pending = await db
    .select()
    .from(importedTransactions)
    .where(
      and(
        eq(importedTransactions.status, "pending_review"),
        direction === "expense"
          ? sql`${importedTransactions.amountPence} < 0`
          : direction === "income"
            ? sql`${importedTransactions.amountPence} > 0`
            : sql`${importedTransactions.amountPence} != 0`
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

  let existingRules = await getCategoryRules();
  if (editingRuleId !== undefined) {
    const at = existingRules.findIndex((r) => r.id === editingRuleId);
    existingRules = at === -1 ? existingRules : existingRules.slice(0, at);
  }
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
  const retro = direction === "expense" && tags ? await findUntaggedExpenses(conditions, tags) : null;
  return { rows, total: matches.length, alreadyCoveredByEarlierRule, retro };
}

// ---- Retroactive tags (past, already categorized expenses) ----

type UntaggedExpense = RetroRow & { categoryId: number };

/** Past expenses (bank rows already categorized) that these conditions match
 * and that are missing the rule's debt and/or savings tag - so a tag forgotten
 * when the rule was made can be added afterwards. Only expenses in the rule's
 * own category are offered; matches in another category are counted and left
 * alone. An expense already tagged (to anyone / any bucket) is never touched,
 * and pencilled-in drafts are skipped. */
async function listUntaggedExpenses(conditions: RuleCondition[], tags: RuleTags): Promise<{ eligible: UntaggedExpense[]; otherCategory: number }> {
  if (tags.debtPersonId === undefined && tags.savingsBucketId === undefined) return { eligible: [], otherCategory: 0 };
  const past = await db
    .select({
      importedId: importedTransactions.id,
      bankAccountId: importedTransactions.bankAccountId,
      bookingDate: importedTransactions.bookingDate,
      payeeRaw: importedTransactions.payeeRaw,
      payeeClean: importedTransactions.payeeClean,
      amountPence: importedTransactions.amountPence,
      expenseEntryId: expenseEntries.id,
      categoryId: expenseEntries.categoryId,
      debtPersonId: expenseEntries.debtPersonId,
    })
    .from(importedTransactions)
    .innerJoin(expenseEntries, eq(expenseEntries.importedTransactionId, importedTransactions.id))
    .where(and(eq(importedTransactions.status, "categorized"), sql`${importedTransactions.amountPence} < 0`, eq(expenseEntries.provisional, false)))
    .orderBy(sql`${importedTransactions.bookingDate} desc`, sql`${importedTransactions.id} desc`);

  const matched = past.filter((t) => allConditionsMatch(conditions, t));
  if (matched.length === 0) return { eligible: [], otherCategory: 0 };
  const ids = matched.map((t) => t.expenseEntryId);
  const ledgered = new Set(
    (await db.select({ id: debtLedgerEntries.expenseEntryId }).from(debtLedgerEntries).where(inArray(debtLedgerEntries.expenseEntryId, ids))).map((r) => r.id)
  );
  const deposited = new Set(
    (await db.select({ id: savingsEntries.expenseEntryId }).from(savingsEntries).where(inArray(savingsEntries.expenseEntryId, ids))).map((r) => r.id)
  );

  const eligible: UntaggedExpense[] = [];
  let otherCategory = 0;
  for (const t of matched) {
    const needsDebt = tags.debtPersonId !== undefined && t.debtPersonId === null && !ledgered.has(t.expenseEntryId);
    const needsSavings = tags.savingsBucketId !== undefined && !deposited.has(t.expenseEntryId);
    if (!needsDebt && !needsSavings) continue;
    if (t.categoryId !== tags.categoryId) {
      otherCategory++;
      continue;
    }
    eligible.push({
      expenseEntryId: t.expenseEntryId,
      categoryId: t.categoryId,
      bookingDate: t.bookingDate,
      payeeRaw: t.payeeRaw,
      payeeClean: t.payeeClean,
      amountPence: t.amountPence,
      adds: { debt: needsDebt, savings: needsSavings },
    });
  }
  return { eligible, otherCategory };
}

async function findUntaggedExpenses(conditions: RuleCondition[], tags: RuleTags): Promise<RetroPreview> {
  const { eligible, otherCategory } = await listUntaggedExpenses(conditions, tags);
  return {
    rows: eligible.slice(0, MAX_PREVIEW_ROWS).map((r) => ({ expenseEntryId: r.expenseEntryId, bookingDate: r.bookingDate, payeeRaw: r.payeeRaw, payeeClean: r.payeeClean, amountPence: r.amountPence, adds: r.adds })),
    total: eligible.length,
    otherCategory,
  };
}

/** Adds the rule's debt / savings tag to the chosen past expenses. Each id is
 * re-checked against what the rule would tag RIGHT NOW (still matching, still
 * untagged), and everything is saved as one unit. */
async function tagPastExpenses(
  conditions: RuleCondition[],
  tags: RuleTags,
  expenseEntryIds: number[]
): Promise<{ tagged: number; skipped: { id: number; reason: string }[] }> {
  const skipped: { id: number; reason: string }[] = [];
  if (expenseEntryIds.length === 0) return { tagged: 0, skipped };
  const { eligible } = await listUntaggedExpenses(conditions, tags);
  const byId = new Map(eligible.map((r) => [r.expenseEntryId, r]));
  let tagged = 0;
  await inTransaction(async () => {
    for (const id of new Set(expenseEntryIds)) {
      const row = byId.get(id);
      if (!row) {
        skipped.push({ id, reason: "no longer matches, was already tagged, or is in another category" });
        continue;
      }
      const entry = await db.query.expenseEntries.findFirst({ where: eq(expenseEntries.id, id) });
      if (!entry) {
        skipped.push({ id, reason: "that expense no longer exists" });
        continue;
      }
      await addTagsToExpense(entry, row.adds, tags);
      tagged++;
    }
  });
  return { tagged, skipped };
}

export type CreateRuleAndApplyResult = {
  ruleId: number;
  categorized: number;
  /** Past expenses that had the rule's debt / savings tag added. */
  tagged: number;
  /** Ids that were asked for but not applied (no longer matching, no
   * longer pending, pencilled-in, or failed) - with why, never silent. */
  skipped: { id: number; reason: string }[];
};

/** Categorizes the chosen waiting transactions with a rule's target. The ids
 * are only a request: each one is re-checked against what the rule really
 * matches RIGHT NOW, so a stale tab, a row categorized elsewhere in the
 * meantime, or a tampered request can't push a non-matching transaction into
 * the wrong category. */
async function applyTargetToMatching(
  conditions: RuleCondition[],
  target: RuleTarget,
  ids: number[],
  editingRuleId?: number
): Promise<{ categorized: number; skipped: { id: number; reason: string }[] }> {
  const skipped: { id: number; reason: string }[] = [];
  let categorized = 0;
  if (ids.length === 0) return { categorized, skipped };

  const preview = await previewRuleMatches(conditions, target.targetType, editingRuleId);
  const eligible = new Map(preview.rows.map((r) => [r.id, r]));
  for (const id of new Set(ids)) {
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
      if (target.targetType === "ignore") {
        await ignoreTransaction(id);
      } else if (target.targetType === "expense") {
        await categorizeTransaction(id, {
          categoryId: target.categoryId,
          debtPersonId: target.debtPersonId,
          bucketId: target.savingsBucketId,
        });
      } else {
        await categorizeTransactionAsIncome(id, {
          incomeSourceId: target.incomeSourceId,
          debtPersonId: target.debtPersonId,
        });
      }
      categorized++;
    } catch (err) {
      skipped.push({ id, reason: err instanceof Error ? err.message : "failed" });
    }
  }
  return { categorized, skipped };
}

/** Saves the rule, then (optionally) categorizes the chosen matches with
 * the same target. */
export async function createRuleAndCategorize(input: {
  conditions: RuleCondition[];
  target: RuleTarget;
  applyToIds: number[];
  /** Past expenses (ids from the preview's `retro` rows) to add the tags to. */
  tagExpenseIds?: number[];
}): Promise<CreateRuleAndApplyResult> {
  const conditions = validateConditions(input.conditions);
  const rule = await addCategoryRule({ conditions, ...input.target }); // validates again; cheap and keeps addCategoryRule safe to call alone
  return { ruleId: rule.id, ...(await applyEverything(conditions, input.target, input.applyToIds, input.tagExpenseIds ?? [])) };
}

async function applyEverything(conditions: RuleCondition[], target: RuleTarget, applyToIds: number[], tagExpenseIds: number[], editingRuleId?: number) {
  const waiting = await applyTargetToMatching(conditions, target, applyToIds, editingRuleId);
  if (target.targetType !== "expense" || tagExpenseIds.length === 0) return { ...waiting, tagged: 0 };
  const past = await tagPastExpenses(conditions, { categoryId: target.categoryId, debtPersonId: target.debtPersonId, savingsBucketId: target.savingsBucketId }, tagExpenseIds);
  return { categorized: waiting.categorized, tagged: past.tagged, skipped: [...waiting.skipped, ...past.skipped] };
}

/** Edits a rule, then (optionally) applies the NEW version to the waiting
 * transactions the user picked - so a changed rule isn't stuck only
 * affecting future imports. Rows already categorized stay as they are. */
export async function updateRuleAndCategorize(
  id: number,
  input: { conditions: RuleCondition[]; target: RuleTarget; applyToIds: number[]; tagExpenseIds?: number[] }
): Promise<CreateRuleAndApplyResult> {
  const conditions = validateConditions(input.conditions);
  await updateCategoryRule(id, { conditions, ...input.target });
  return { ruleId: id, ...(await applyEverything(conditions, input.target, input.applyToIds, input.tagExpenseIds ?? [], id)) };
}
