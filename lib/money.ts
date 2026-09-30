/** Common currencies for the Settings picker - not exhaustive, but covers
 * this app's realistic audience. formatPence works with any valid ISO 4217
 * code Intl.NumberFormat accepts, so adding to this list is the only step
 * needed to offer another one. */
// Labels' bracketed symbols are the real en-GB Intl.NumberFormat output for
// that code (verified, not assumed) - en-GB disambiguates currencies that
// share the plain "$"/"¥" glyph (US$, CA$, A$, JP¥) rather than rendering
// them all identically, which formatPence/getCurrencySymbol also rely on.
export const CURRENCIES = [
  { code: "GBP", label: "British Pound (£)" },
  { code: "USD", label: "US Dollar (US$)" },
  { code: "EUR", label: "Euro (€)" },
  { code: "CAD", label: "Canadian Dollar (CA$)" },
  { code: "AUD", label: "Australian Dollar (A$)" },
  { code: "CHF", label: "Swiss Franc (CHF)" },
  { code: "JPY", label: "Japanese Yen (JP¥)" },
] as const;

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && CURRENCIES.some((c) => c.code === value);
}

// One formatter per currency code, built lazily and reused - Intl.NumberFormat
// construction isn't free, and this app renders a LOT of amounts per page.
const formatters = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: string): Intl.NumberFormat {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency });
    formatters.set(currency, formatter);
  }
  return formatter;
}

export function formatPence(pence: number, currency: string): string {
  return getFormatter(currency).format(pence / 100);
}

/** Just the symbol ("£", "$", "€"...) - for UI that needs a currency prefix
 * next to a raw, still-being-typed number (formatPence itself needs a real
 * pence amount, which a mid-edit input doesn't have yet). */
export function getCurrencySymbol(currency: string): string {
  const part = getFormatter(currency)
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value ?? currency;
}

export function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100);
}
