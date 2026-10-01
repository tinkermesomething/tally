/** Parses a strict "YYYY-MM-DD" date string into its year/month, rejecting
 * anything malformed instead of silently writing a bad month (e.g. 13) into
 * the database - entryDate arrives from a `<input type="date">` in the UI
 * (always well-formed there) but also from the token-authed API, which a
 * script client could pass anything to. */
export function parseIsoDate(entryDate: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entryDate);
  if (!match) {
    throw new Error(`entryDate must be in YYYY-MM-DD format, got "${entryDate}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new Error(`entryDate has an invalid month: "${entryDate}"`);
  }
  if (day < 1 || day > 31) {
    throw new Error(`entryDate has an invalid day: "${entryDate}"`);
  }
  return { year, month };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Sensible default date for confirming a specific grid cell's payment:
 * today, if today actually falls within that cell's own year/month -
 * otherwise the LAST day of that cell's month, never today's real date.
 * Ticking "paid" on an old month's cell (catching up retroactively) must
 * not silently file the resulting expense under whatever month today
 * happens to be - entryDate drives which year/month an expense lands in
 * (see logExpense in lib/db/queries.ts), so defaulting to today here would
 * reproduce exactly that bug for anyone who doesn't notice and change it.
 * Date.UTC(year, month, 0) is the timezone-safe "last day of this 1-based
 * month" trick - day 0 of month's own 0-based next-month index rolls back
 * one day into the target month, with no local-offset involvement (the
 * same BST-safe pattern used in lib/db/bank-sync.ts). */
export function defaultEntryDateFor(year: number, month: number): string {
  const now = new Date();
  if (now.getFullYear() === year && now.getMonth() + 1 === month) {
    return todayIso();
  }
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
