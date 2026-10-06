import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  groupName: text("group_name"),
  sortOrder: integer("sort_order").notNull().default(0),
  isAnnual: integer("is_annual", { mode: "boolean" }).notNull().default(false),
  annualMonth: integer("annual_month"),
  dueDay: integer("due_day"), // 1-31, day of the month this is due
  // When set, logging an expense against this category auto-creates a debt
  // repayment for this person too (unless the caller already passed an
  // explicit debtPersonId, which always wins). For categories that only ever
  // mean "pay this one person back" (e.g. "Roberto"), so it's not a
  // per-transaction tickbox someone has to remember.
  linkedDebtPersonId: integer("linked_debt_person_id").references(() => people.id),
  // Every expense logged against this category also pays into this savings
  // bucket (see logExpense) - the same idea as linkedDebtPersonId.
  linkedBucketId: integer("linked_bucket_id").references(() => savingsBuckets.id),
  // Null = active. Set = hidden from the grid/rollups for any year AFTER the
  // one archivedAt falls in, but still visible and counted for that year and
  // every year before it - archiving something today must not rewrite what a
  // past year's SUBTOTAL/AVAILABLE said. A plain boolean can't express that;
  // see getGridData's `visibleForYear`.
  archivedAt: integer("archived_at", { mode: "timestamp" }),
});

export const categoryEntries = sqliteTable(
  "category_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1-12
    amountPence: integer("amount_pence").notNull(),
    paid: integer("paid", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("category_entries_unique").on(
      table.categoryId,
      table.year,
      table.month
    ),
  ]
);

export const expenseEntries = sqliteTable("expense_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(), // 1-12, derived from entryDate
  amountPence: integer("amount_pence").notNull(),
  note: text("note"),
  entryDate: text("entry_date").notNull(), // ISO date, when the money actually left
  // Set when this expense is *also* a debt repayment - e.g. paying Roberto
  // back logged under Misc. Purely for traceability; the actual ledger
  // effect is a separate debt_ledger_entries row created alongside it.
  debtPersonId: integer("debt_person_id").references(() => people.id),
  // Set when this expense was created by categorizing a staged bank-sync
  // row, rather than typed in directly - purely for traceability back to
  // its source (lib/db/bank-sync.ts), same reasoning as debtPersonId
  // above. Nothing about how this expense behaves in the grid/rollup math
  // changes once it exists; this is provenance only.
  importedTransactionId: integer("imported_transaction_id").references(
    () => importedTransactions.id
  ),
  // "Pencilled in" from a pending-at-the-bank preview, before the real
  // transaction has settled - counts in the grid like any other expense
  // (that's the point: reflect money that's already earmarked), but is
  // still a guess, not a confirmed fact, until the matching real
  // transaction arrives and the user confirms or discards it. Not named
  // "pending" - that word already means "unsettled at the bank" elsewhere
  // in this codebase, a different concept.
  provisional: integer("provisional", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const incomeSources = sqliteTable("income_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  // Null = active. Same year-relative treatment as categories.archivedAt -
  // archiving a source must not rewrite what a past year's WAGES said.
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  // At most one source is the pay anchor at a time (enforced at the app
  // layer, not the schema). Logging an entry against this source is what
  // creates a payPeriodAnchors boundary - see that table's comment.
  isPayAnchor: integer("is_pay_anchor", { mode: "boolean" }).notNull().default(false),
  // "#rrggbb" - the colour of this source's row in the Grid's income table
  // (set in Settings > Income). Null = a palette colour picked by position.
  color: text("color"),
});

export const incomeEntries = sqliteTable(
  "income_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    incomeSourceId: integer("income_source_id")
      .notNull()
      .references(() => incomeSources.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    amountPence: integer("amount_pence").notNull(),
  },
  (table) => [
    uniqueIndex("income_entries_unique").on(
      table.incomeSourceId,
      table.year,
      table.month
    ),
  ]
);

/** A boundary created each time the designated "pay anchor" income source
 * gets a logged entry: `receivedDate` is when the money actually landed,
 * `year`/`month` is which budget period it counts toward - the two can
 * differ (wages received Aug 28, counted as September). Every other logged
 * entry (expense, non-anchor income, debt) dated on/after the most recent
 * boundary's receivedDate resolves to that boundary's year/month instead of
 * its own calendar month - see resolvePeriodForDate in lib/db/pay-period.ts.
 * Entries dated before the earliest boundary ever recorded just fall back
 * to plain calendar-month resolution (nothing to anchor off yet). */
export const payPeriodAnchors = sqliteTable("pay_period_anchors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incomeSourceId: integer("income_source_id")
    .notNull()
    .references(() => incomeSources.id),
  receivedDate: text("received_date").notNull(), // ISO date
  year: integer("year").notNull(),
  month: integer("month").notNull(), // 1-12
});

/** A category's parent changes only from a given year onward - past years
 * keep showing it under its old grouping, the same principle as
 * categories.archivedAt. Resolving a category's effective parent for year Y
 * means: the parentId of the move row with the largest effectiveYear <= Y,
 * or the category's own (original) parentId if no move row qualifies. See
 * resolveEffectiveParent in lib/db/queries.ts. */
export const categoryParentMoves = sqliteTable("category_parent_moves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  parentId: integer("parent_id"), // null = moved to top-level
  effectiveYear: integer("effective_year").notNull(),
});

export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

/** A pot of money being set aside - kids' savings, a holiday, a Revolut
 * bucket. Its balance is opening + deposits - withdrawals, computed on read
 * (never stored), so it can't drift if an entry is edited or deleted. Every
 * setting except the name is optional. */
export const savingsBuckets = sqliteTable("savings_buckets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color"), // "#rrggbb"; null = a palette colour picked by id
  goalPence: integer("goal_pence"),
  goalDate: text("goal_date"), // ISO date
  openingPence: integer("opening_pence").notNull().default(0),
  note: text("note"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const savingsEntries = sqliteTable("savings_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bucketId: integer("bucket_id")
    .notNull()
    .references(() => savingsBuckets.id),
  entryDate: text("entry_date").notNull(), // ISO date
  amountPence: integer("amount_pence").notNull(), // always positive
  direction: text("direction", { enum: ["deposit", "withdrawal"] }).notNull(),
  note: text("note"),
  // Set only when this deposit was created automatically alongside an
  // expense in a linked category - lets deleting or editing that expense
  // keep the bucket in step. Null for anything entered by hand.
  expenseEntryId: integer("expense_entry_id").references(() => expenseEntries.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const reportPanels = sqliteTable("report_panels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // JSON array of { type: "group", value: string } | { type: "category", value: number }
  selection: text("selection").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const debtLedgerEntries = sqliteTable("debt_ledger_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: integer("person_id")
    .notNull()
    .references(() => people.id),
  entryDate: text("entry_date").notNull(), // ISO date, user-entered
  amountPence: integer("amount_pence").notNull(),
  direction: text("direction", { enum: ["loan", "repayment"] }).notNull(),
  note: text("note"),
  // Set only when this ledger entry was created automatically alongside an
  // expense (see logExpense) - lets discarding a provisional/pencilled-in
  // expense clean up the matching repayment it created, rather than
  // leaving the ledger permanently wrong. Null for anything entered
  // directly on the Debt page.
  expenseEntryId: integer("expense_entry_id").references(() => expenseEntries.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/** Single-row table (app logic always reads/writes the first row, creating
 * it with these defaults on first read if missing) - app-wide display
 * preferences, not per-category/entry data. currency is an ISO 4217 code
 * fed straight to Intl.NumberFormat; dateFormat is one of DATE_FORMATS in
 * lib/date-format.ts. carryOverStartYear/Month mark the first tracked
 * period for the Left to spend rollover chain (see
 * getYearEndLeftToSpend in lib/db/queries.ts) - nothing carries into that
 * period itself, only out of it going forward. Null means "not configured
 * yet", which resolves to the CURRENT year/month at read time (always
 * fresh, not frozen to whenever the settings row happened to be created) -
 * see getAppSettings - so carry-over is effectively off until the user
 * deliberately picks a start point. */
export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  currency: text("currency").notNull().default("GBP"),
  dateFormat: text("date_format").notNull().default("dmy"),
  carryOverStartYear: integer("carry_over_start_year"),
  carryOverStartMonth: integer("carry_over_start_month"),
  // Opt-in - off by default so a fresh install never starts burning
  // through GoCardless's per-account rate limit (as few as 4-10 calls/day)
  // without the user deliberately choosing to. Frequency is a plain
  // interval in hours rather than a cron expression - the only sane
  // choices are bounded by that same rate limit, so a free-text schedule
  // would just be more ways to misconfigure it.
  bankSyncEnabled: integer("bank_sync_enabled", { mode: "boolean" }).notNull().default(false),
  bankSyncFrequencyHours: integer("bank_sync_frequency_hours").notNull().default(24),
});

/** A linked bank account (GoCardless for now, provider is a plain string so
 * a second provider never needs a schema change). One row per real account
 * - the user has 2, and nothing here assumes just one. consentExpiresAt
 * drives the same "flag once passed" overdue-style alerting already built
 * for categories.dueDay, not a new mechanism. archivedAt is soft-delete,
 * same convention as categories/incomeSources - unlinking an account
 * never deletes its imported history. */
export const bankAccounts = sqliteTable("bank_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  institutionId: text("institution_id").notNull(),
  requisitionId: text("requisition_id").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  displayName: text("display_name").notNull(),
  consentExpiresAt: integer("consent_expires_at", { mode: "timestamp" }).notNull(),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  // Cached from the LAST real sync's own `pending` array (JSON) - the
  // Review page's pending-visibility preview reads this instead of
  // calling GoCardless's transactions endpoint itself. That endpoint is
  // rate-limited to as few as 4 calls/day PER ACCOUNT (confirmed via
  // GoCardless's own published limits, not assumed) and is the SAME
  // endpoint the real sync depends on - a separate live call on every
  // single /review page view (which happens on every categorize/ignore
  // too, via revalidatePath) would burn through that tiny shared quota
  // in minutes and then break real syncing for the rest of the day.
  // Freshness is tied to whenever the account last synced, which is the
  // right cadence anyway - this was never meant to be live-live.
  pendingPreviewJson: text("pending_preview_json"),
  // JSON: how this account's CSV exports map to date/amount/payee, saved
  // after a successful CSV import so the next file needs no re-mapping.
  // provider "csv" accounts are CSV-only: never synced, never expire.
  csvMapping: text("csv_mapping"),
  // A name the user chose ("Main account", "Holiday pot"), shown everywhere
  // instead of the bank's own label. Null = use displayName.
  alias: text("alias"),
});

/** A single staged bank transaction, before (or instead of) becoming a real
 * expenseEntries row - the review/categorization pool. importedId is the
 * provider's own transaction id, the real dedup key (exact match only,
 * deliberately no fuzzy date/amount matching between two imports). amountPence keeps the provider's own
 * sign convention (negative = money out, positive = money in) rather than
 * normalizing to Tally's always-positive expense amounts, since a staged
 * row isn't necessarily an expense yet - that normalization only happens
 * once it's actually categorized into a real expenseEntries row.
 * payeeClean is reserved for a cleaned-up copy of the raw bank
 * descriptor, kept separate from payeeRaw so the original is never lost.
 * NOTHING writes it today (it is always null); rule matching reads both. `ignored` covers both "this is a transfer" and "I already
 * logged this manually" - either way nothing is ever hard-deleted, so
 * dismissing one is always reversible back to pending_review.
 * possibleDuplicateExpenseEntryId is a SUGGESTION only, computed once at
 * import time (same amount and a nearby date (+/-1 day for manual entries, +/-7 for
 * pencilled-in drafts), against already-logged expenseEntries - there's no
 * provider id to exact-match against those, unlike imported_id above) - the review UI surfaces it, the user decides;
 * it's never used to auto-ignore anything. Can go stale if that expense is
 * later edited/deleted, which is an acceptable imprecision for a "maybe",
 * not a correctness requirement. */
export const importedTransactions = sqliteTable(
  "imported_transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bankAccountId: integer("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id),
    importedId: text("imported_id").notNull(),
    amountPence: integer("amount_pence").notNull(),
    bookingDate: text("booking_date").notNull(), // ISO date
    payeeRaw: text("payee_raw").notNull(),
    payeeClean: text("payee_clean"),
    // Your own note while the row waits in Review ("what was this?"). Used
    // as the note of the expense it becomes - see categorizeTransaction.
    note: text("note"),
    status: text("status", { enum: ["pending_review", "categorized", "ignored"] })
      .notNull()
      .default("pending_review"),
    possibleDuplicateExpenseEntryId: integer("possible_duplicate_expense_entry_id"),
    // A CSV row that looks like a transaction already imported for the same
    // account (same amount, date within a day) - flagged in Review instead
    // of being silently dropped or auto-categorized.
    possibleDuplicateImportedId: integer("possible_duplicate_imported_id"),
    // Set when this row was categorized as INCOME rather than an expense -
    // income_entries is one aggregate row per (source, year, month), not
    // one row per transaction like expenseEntries, so there's no
    // equivalent of expenseEntries.importedTransactionId to join back
    // through. A real FK (unlike possibleDuplicateExpenseEntryId) since income
    // sources are only ever archived, never hard-deleted, so it can't go
    // stale the same way.
    categorizedIncomeSourceId: integer("categorized_income_source_id").references(
      () => incomeSources.id
    ),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("imported_transactions_dedup").on(table.bankAccountId, table.importedId),
  ]
);

/** An explicit auto-categorization rule (lib/db/bank-sync.ts) - runs
 * automatically at import time, before a transaction ever reaches the
 * review pool, same model as actual-budget's. `value` is stored as text
 * and parsed per field+operator at match time (e.g. "gt"/"lt" on amount
 * parse it as pence).
 *
 * targetType decides which of categoryId/incomeSourceId applies - exactly
 * one is set, matching targetType, enforced in application code (addCategoryRule).
 * Added for v2.1: staging imports BOTH directions (money in and out) but
 * rules were expense-only, so an incoming transaction matching an
 * expense-shaped rule (e.g. a "payee contains wages" rule meant for
 * something else entirely) would try to categorize it as an expense and
 * throw - matchCategoryRule now filters candidate rules by whether their
 * targetType is even compatible with the transaction's sign BEFORE
 * evaluating field/operator, so a mismatched rule can never fire on the
 * wrong direction's transaction in the first place.
 *
 * debtPersonId is expense-only: a rule can tag a category AND a debt
 * repayment/loan in one step, extending the existing debt-tag mechanism -
 * something actual-budget's own rules engine has no equivalent of. Not
 * meaningful for an income-targeted rule (the debt ledger already models
 * someone repaying you as its own ledger entry, unconnected to bank-sync). */
export const categoryRules = sqliteTable("category_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  field: text("field", { enum: ["payee", "amount", "account"] }).notNull(),
  operator: text("operator", { enum: ["contains", "is", "gt", "lt"] }).notNull(),
  value: text("value").notNull(),
  // JSON array of {field, operator, value} - ALL must match (stacked
  // conditions). field/operator/value above always mirror the FIRST
  // condition, so older rows (no JSON) and anything still reading the
  // single-condition columns keep working; see ruleConditionsOf in
  // lib/rules.ts, the only reader that matters.
  conditions: text("conditions"),
  targetType: text("target_type", { enum: ["expense", "income", "ignore"] })
    .notNull()
    .default("expense"),
  categoryId: integer("category_id").references(() => categories.id),
  incomeSourceId: integer("income_source_id").references(() => incomeSources.id),
  debtPersonId: integer("debt_person_id").references(() => people.id),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});
