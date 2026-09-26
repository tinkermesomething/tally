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
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
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
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const incomeSources = sqliteTable("income_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
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

export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
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
