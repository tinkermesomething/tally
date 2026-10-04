/** Parses what someone typed into an amount box ("12", "12.5", " 12.50 ").
 * Returns null for anything that isn't a plain finite number - parseFloat on
 * its own happily reads "12abc" as 12 and "1e9" as a billion. */
export function parsePounds(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
