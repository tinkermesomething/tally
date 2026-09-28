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
