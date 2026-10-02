import type { GridCategory } from "@/lib/db/queries";

export type OverdueItem = {
  name: string;
  dueDay: number | null;
  amountPence: number | undefined;
};

/** What a cell's red "Overdue" alert is actually about. A plain cell is
 * about its own category; a rollup parent's alert comes from whichever of
 * its sub-categories are overdue (see the rollup branches in
 * getGridData), so those are what's listed - the parent itself has no due
 * item of its own to point at. Empty when the cell isn't overdue. */
export function overdueItemsFor(category: GridCategory, month: number): OverdueItem[] {
  const cell = category.months[month];
  if (!cell?.overdue) return [];
  if (cell.computed) {
    const items = category.children
      .filter((child) => child.months[month]?.overdue)
      .map((child) => ({
        name: child.name,
        dueDay: child.dueDay,
        amountPence: child.months[month]?.amountPence,
      }));
    if (items.length > 0) return items;
  }
  return [{ name: category.name, dueDay: category.dueDay, amountPence: cell.amountPence }];
}

/** "1st Oct" - clamps a due day that doesn't exist in this month (31st in
 * February) to the real last day, same as the overdue check itself does,
 * so the date shown is the date that actually triggered the alert. */
export function formatDueDate(dueDay: number, year: number, month: number, monthNames: readonly string[]): string {
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(dueDay, lastDay);
  const suffix =
    day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix} ${monthNames[month - 1]}`;
}
