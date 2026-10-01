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
 * its own calendar month - see resolvePeriodForDate in lib/pay-period.ts.
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
});
