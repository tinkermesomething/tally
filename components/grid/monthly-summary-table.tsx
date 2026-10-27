"use client";

import { formatPence } from "@/lib/money";
import { cn, FLOATING_PANEL_EDGE, floatingPanelFill } from "@/lib/utils";
import { ScrollFade } from "@/components/scroll-fade";
import { MONTH_ABBREVIATIONS as MONTHS } from "@/lib/months";
import { useAppSettings } from "@/components/providers/app-settings-provider";

type SummaryRow = {
  label: string;
  values: number[];
  total: number;
  showAverage: boolean;
  /** Negative reads as a problem (red), non-negative as fine (green) - only
   * the two "money you actually have" rows get this; INCOME/Budgeted/
   * Actually spent are plain facts, not a health signal either way. */
  signed: boolean;
  /** This row's colour (a chart token): edge bar, label, tint and totals. */
  color: string;
};

/** INCOME/Budgeted/AVAILABLE/Actually spent/Left to spend aren't expense line
 * items - they're derived from expenses + income together, so they get their
 * own bubble instead of living in the expense table's footer next to
 * SUBTOTAL. Budgeted/Available are a stable, forward-looking pair ("if I
 * stick to the plan"); Actually spent/Left to spend are a live pair that
 * moves as things get paid through the month - deliberately not the same
 * number, see the GridData comment in lib/db/queries.ts for why. */
export function MonthlySummaryTable({
  plannedByMonth,
  wagesByMonth,
  availableByMonth,
  actuallySpentByMonth,
  leftToSpendByMonth,
  yearTotal,
  categoryColWidth,
  monthColWidth,
  summaryColWidth,
  containerRef,
  onScroll,
}: {
  plannedByMonth: number[];
  wagesByMonth: number[];
  availableByMonth: number[];
  actuallySpentByMonth: number[];
  leftToSpendByMonth: number[];
  yearTotal: {
    planned: number;
    wages: number;
    available: number;
    actuallySpent: number;
    leftToSpend: number;
  };
  categoryColWidth: number;
  monthColWidth: number;
  summaryColWidth: number;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (el: HTMLDivElement) => void;
}) {
  const { currency } = useAppSettings();
  const tableWidth = categoryColWidth + monthColWidth * 12 + summaryColWidth * 2;

  const rows: SummaryRow[] = [
    { label: "INCOME", values: wagesByMonth, total: yearTotal.wages, showAverage: true, signed: false, color: "var(--chart-6)" },
    { label: "BUDGETED", values: plannedByMonth, total: yearTotal.planned, showAverage: true, signed: false, color: "var(--chart-1)" },
    { label: "AVAILABLE", values: availableByMonth, total: yearTotal.available, showAverage: true, signed: true, color: "var(--chart-3)" },
    {
      label: "ACTUALLY SPENT",
      values: actuallySpentByMonth,
      total: yearTotal.actuallySpent,
      showAverage: true,
      signed: false,
      color: "var(--chart-2)",
    },
    {
      label: "Left to spend",
      values: leftToSpendByMonth,
      total: yearTotal.leftToSpend,
      showAverage: false,
      signed: true,
      color: "var(--chart-7)",
    },
  ];

  return (
    <ScrollFade
      className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm"
      leftInset={categoryColWidth}
      rightInset={summaryColWidth * 2}
      containerRef={containerRef}
      onScroll={onScroll}
    >
      <table
        className="border-collapse text-sm"
        style={{ tableLayout: "fixed", width: tableWidth }}
      >
        <colgroup>
          <col style={{ width: categoryColWidth }} />
          {MONTHS.map((m) => (
            <col key={m} style={{ width: monthColWidth }} />
          ))}
          <col style={{ width: summaryColWidth }} />
          <col style={{ width: summaryColWidth }} />
        </colgroup>
        <thead>
          <tr className="bg-muted">
            <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">
              Summary
            </th>
            {MONTHS.map((m) => (
              <th key={m} className="px-3 py-2 text-right font-medium">
                {m}
              </th>
            ))}
            <th
              style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--muted") }}
              className={cn("sticky z-10 px-3 py-2 text-right font-medium", FLOATING_PANEL_EDGE)}
            >
              Year Total
            </th>
            <th
              style={{ right: 0, backgroundColor: floatingPanelFill("--muted") }}
              className="sticky z-10 px-3 py-2 text-right font-medium"
            >
              Monthly avg
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="tinted-row border-t border-border font-medium" style={{ "--row-color": row.color } as React.CSSProperties}>
              <td className="sticky left-0 z-10 bg-card px-3 py-2">{row.label}</td>
              {row.values.map((value, i) => (
                <td
                  key={i}
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    row.signed && (value < 0 ? "text-status-critical" : "text-status-good")
                  )}
                >
                  {formatPence(value, currency)}
                </td>
              ))}
              <td
                style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--card") }}
                className={cn("sticky z-10 px-3 py-2 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
              >
                {formatPence(row.total, currency)}
              </td>
              <td
                style={{ right: 0, backgroundColor: floatingPanelFill("--card") }}
                className="sticky z-10 px-3 py-2 text-right font-bold tabular-nums"
              >
                {row.showAverage ? formatPence(Math.round(row.total / 12), currency) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollFade>
  );
}
