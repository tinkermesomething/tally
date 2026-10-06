/** Year total and monthly average of what was actually SPENT, from a
 * category's twelve monthly figures (Jan first). The average counts only the
 * months with any spending - the same rule the budgeted average uses for
 * months with a plan - so a category paid in three months averages over
 * three, not twelve. Shared by the Grid and its CSV export so they agree. */
export function spentTotals(actualByMonth: number[]): { total: number; average: number | undefined } {
  const cells = actualByMonth.slice(0, 12);
  const total = cells.reduce((s, v) => s + v, 0);
  const used = cells.filter((v) => v > 0);
  return { total, average: used.length === 0 ? undefined : Math.round(used.reduce((s, v) => s + v, 0) / used.length) };
}
