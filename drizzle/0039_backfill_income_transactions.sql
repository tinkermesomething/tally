-- v4.9.2 split income into a budgeted figure (income_entries, unchanged)
-- and a real per-transaction ledger (income_transactions, new) - but
-- shipped with no backfill. Every month recorded BEFORE that release had
-- its "received" figure living only in income_entries (the only table
-- that existed then), so wagesByMonth/Left to spend/the Grid's own WAGES
-- summary row silently dropped to 0 for anything already-elapsed the
-- instant the new release started reading from the (empty) new table.
--
-- This copies each income_entries row with no income_transactions row yet
-- for that source/year/month into one non-provisional transaction, dated
-- the 1st of that month (income_entries never had a real date, only
-- year/month) - but ONLY for a month up to and including the current one.
-- A future month's income_entries figure is a forward-looking budget
-- guess, not money received - backfilling that too would defeat the point
-- of this release by making every future month look fully received on
-- day one. A month that already has ANY income_transactions row (a
-- pencil-in, a bank-synced row, or anything logged since the fix landed)
-- is left alone - trusting what's really there over the old aggregate,
-- at the cost of possibly under-counting the one narrow window where a
-- partial real transaction landed before this backfill ran.
INSERT INTO income_transactions (income_source_id, year, month, amount_pence, note, entry_date, provisional)
SELECT
  ie.income_source_id,
  ie.year,
  ie.month,
  ie.amount_pence,
  'Backfilled from the pre-4.9.2 budgeted figure (see the v4.9.3 release notes)',
  printf('%04d-%02d-01', ie.year, ie.month),
  0
FROM income_entries ie
WHERE ie.amount_pence > 0
  AND (
    ie.year < CAST(strftime('%Y', 'now') AS INTEGER)
    OR (ie.year = CAST(strftime('%Y', 'now') AS INTEGER) AND ie.month <= CAST(strftime('%m', 'now') AS INTEGER))
  )
  AND NOT EXISTS (
    SELECT 1 FROM income_transactions it
    WHERE it.income_source_id = ie.income_source_id AND it.year = ie.year AND it.month = ie.month
  );
