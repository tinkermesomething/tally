/** Reports can show what was budgeted, what was actually spent, or both
 * side by side with the gap between them. */
export type ReportView = "budgeted" | "spent" | "compare" | "trend";

export const REPORT_VIEWS: { id: ReportView; label: string }[] = [
  { id: "budgeted", label: "Budgeted" },
  { id: "spent", label: "Spent" },
  { id: "compare", label: "Compare" },
  { id: "trend", label: "Trend" },
];

export function parseReportView(value: string | undefined): ReportView {
  return REPORT_VIEWS.some((v) => v.id === value) ? (value as ReportView) : "budgeted";
}

/** Title prefix for every panel on the page, so "Budgeted - Household
 * bills" and "Spent - Household bills" are never mistaken for each other. */
export const VIEW_PREFIX: Record<ReportView, string> = {
  budgeted: "Budgeted",
  spent: "Spent",
  compare: "Budgeted vs spent",
  trend: "Trend",
};

export type VarianceRow = {
  key: string;
  label: string;
  color: string;
  budgetedPence: number;
  spentPence: number;
  /** spent - budgeted: positive = over budget, negative = under. */
  diffPence: number;
};

type SliceLike = { group: string; amountPence: number; color: string };

/** One row per group/pick that has either a budget or spending, in the
 * order of the budgeted slices first (so it lines up with the pies), then
 * anything that was only spent. */
export function buildVarianceRows(budgeted: SliceLike[], spent: SliceLike[]): VarianceRow[] {
  const rows = new Map<string, VarianceRow>();
  for (const s of budgeted) {
    rows.set(s.group, {
      key: s.group,
      label: s.group,
      color: s.color,
      budgetedPence: s.amountPence,
      spentPence: 0,
      diffPence: 0,
    });
  }
  for (const s of spent) {
    const row = rows.get(s.group);
    if (row) row.spentPence = s.amountPence;
    else
      rows.set(s.group, {
        key: s.group,
        label: s.group,
        color: s.color,
        budgetedPence: 0,
        spentPence: s.amountPence,
        diffPence: 0,
      });
  }
  return [...rows.values()]
    .filter((r) => r.budgetedPence !== 0 || r.spentPence !== 0)
    .map((r) => ({ ...r, diffPence: r.spentPence - r.budgetedPence }))
    .sort((a, b) => b.budgetedPence - a.budgetedPence || b.spentPence - a.spentPence);
}
