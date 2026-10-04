import { parseIsoDate } from "./date";

/** Shared input checks for server actions. `Number.isFinite` matters: `NaN <= 0`
 * is false, so a bare `pounds <= 0` check lets NaN (and Infinity) through. */
export function assertPositivePounds(pounds: number, message = "Amount must be greater than zero."): void {
  if (typeof pounds !== "number" || !Number.isFinite(pounds) || pounds <= 0) throw new Error(message);
}

export function assertNonNegativePounds(pounds: number, message = "Amount can't be negative."): void {
  if (typeof pounds !== "number" || !Number.isFinite(pounds) || pounds < 0) throw new Error(message);
}

export function assertPositivePence(pence: number): void {
  if (!Number.isInteger(pence) || pence <= 0) throw new Error("Amount must be greater than zero.");
}

/** Throws unless `date` is a real YYYY-MM-DD calendar date. */
export function assertIsoDate(date: string): void {
  parseIsoDate(date);
  const [y, m, d] = date.split("-").map(Number);
  const real = new Date(Date.UTC(y, m - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) {
    throw new Error(`entryDate is not a real date: "${date}"`);
  }
}
