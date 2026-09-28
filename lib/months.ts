/** Index 0 = January, matching the 0-based month index used across the grid
 * (e.g. Date.getMonth(), or `currentMonthIndex` in app/grid/page.tsx). */
export const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Same index convention as MONTH_ABBREVIATIONS - full names for dialogs and
 * selects where there's room to spell them out. */
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** 1-12, matching the DB's 1-based `month` column - for iterating grid
 * columns keyed by that number instead of a 0-based array index. */
export const MONTH_NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1);
