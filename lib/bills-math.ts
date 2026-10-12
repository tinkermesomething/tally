/** Pure date math for bill cadences - no DB, no React, same reasoning as
 * lib/savings-math.ts. */

export const BILL_CADENCES = ["weekly", "monthly", "yearly", "custom_days"] as const;
export type BillCadence = (typeof BILL_CADENCES)[number];

/** How far ahead a due-day category can surface as a bill (lib/db/bills.ts's
 * getCategoryDueBills) - lives here, not there, so the Bills page's client
 * components (timeline view) can read the same number without pulling
 * server-only DB code into the client bundle. */
export const BILLS_LOOKAHEAD_DAYS = 42;

function addDays(y: number, m: number, d: number, days: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Adds whole months, clamping the day to the target month's own length -
 * a bill due on the 31st rolls to the 30th in a 30-day month, not into the
 * month after (the naive behaviour of Date.setUTCMonth on overflow). */
function addMonthsClamped(y: number, m: number, d: number, months: number): string {
  const total = m - 1 + months;
  const targetYear = y + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().slice(0, 10);
}

/** One cycle forward from `date` (an ISO due date, not necessarily today). */
export function nextDueDateAfter(date: string, cadence: BillCadence, cadenceDays: number | null): string {
  const [y, m, d] = date.split("-").map(Number);
  switch (cadence) {
    case "weekly":
      return addDays(y, m, d, 7);
    case "custom_days":
      return addDays(y, m, d, Math.max(1, cadenceDays ?? 30));
    case "yearly":
      return addMonthsClamped(y, m, d, 12);
    case "monthly":
      return addMonthsClamped(y, m, d, 1);
  }
}

/** Whole days from today (UTC calendar date, not wall-clock) to `dueDate` -
 * negative means overdue by that many days. */
export function daysUntil(dueDate: string, today: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(dueDate) - toUtc(today)) / 86_400_000);
}
