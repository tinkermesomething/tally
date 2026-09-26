import { formatPence } from "@/lib/money";
import { cn, FLOATING_PANEL_EDGE, floatingPanelFill } from "@/lib/utils";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type SummaryRow = {
  label: string;
  values: number[];
  total: number;
  showAverage: boolean;
};

/** WAGES/AVAILABLE/Remaining aren't expense line items - they're derived
 * from expenses + income together, so they get their own bubble instead of
 * living in the expense table's footer next to SUBTOTAL. */
export function MonthlySummaryTable({
  wagesByMonth,
  availableByMonth,
  remainingByMonth,
  yearTotal,
  categoryColWidth,
  monthColWidth,
  summaryColWidth,
}: {
  wagesByMonth: number[];
  availableByMonth: number[];
  remainingByMonth: number[];
  yearTotal: { wages: number; available: number };
  categoryColWidth: number;
  monthColWidth: number;
  summaryColWidth: number;
}) {
  const tableWidth = categoryColWidth + monthColWidth * 12 + summaryColWidth * 2;

  const rows: SummaryRow[] = [
    { label: "WAGES", values: wagesByMonth, total: yearTotal.wages, showAverage: true },
    { label: "AVAILABLE", values: availableByMonth, total: yearTotal.available, showAverage: true },
    {
      label: "Remaining this month",
      values: remainingByMonth,
      total: remainingByMonth.reduce((a, b) => a + b, 0),
      showAverage: false,
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm">
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
            <tr key={row.label} className="border-t border-border font-medium">
              <td className="sticky left-0 z-10 bg-card px-3 py-2">{row.label}</td>
              {row.values.map((value, i) => (
                <td
                  key={i}
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    row.label === "AVAILABLE" &&
                      (value < 0 ? "text-status-critical" : "text-status-good")
                  )}
                >
                  {formatPence(value)}
                </td>
              ))}
              <td
                style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--card") }}
                className={cn("sticky z-10 px-3 py-2 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
              >
                {formatPence(row.total)}
              </td>
              <td
                style={{ right: 0, backgroundColor: floatingPanelFill("--card") }}
                className="sticky z-10 px-3 py-2 text-right font-bold tabular-nums"
              >
                {row.showAverage ? formatPence(Math.round(row.total / 12)) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
