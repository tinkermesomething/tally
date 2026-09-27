"use client";

import { GridCell } from "@/components/grid/grid-cell";
import { formatPence } from "@/lib/money";
import { ScrollFade } from "@/components/scroll-fade";
import { updateIncomeAmount, clearIncomeAmount } from "@/app/grid/actions";
import type { IncomeSourceRow } from "@/lib/db/queries";
import { cn, FLOATING_PANEL_EDGE, floatingPanelFill } from "@/lib/utils";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1);

export function IncomeTable({
  sources,
  year,
  totalByMonth,
  categoryColWidth,
  monthColWidth,
  summaryColWidth,
  containerRef,
  onScroll,
}: {
  sources: IncomeSourceRow[];
  year: number;
  totalByMonth: number[];
  categoryColWidth: number;
  monthColWidth: number;
  summaryColWidth: number;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (el: HTMLDivElement) => void;
}) {
  const tableWidth = categoryColWidth + monthColWidth * 12 + summaryColWidth * 2;
  const yearTotal = totalByMonth.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Income</h2>
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
                Source
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
            {sources.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-3 py-6 text-center text-muted-foreground">
                  No income sources yet - add one to start tracking.
                </td>
              </tr>
            ) : (
              sources.map((source) => (
                <tr key={source.id} className="border-t border-border">
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium">
                    {source.name}
                  </td>
                  {MONTH_NUMBERS.map((month) => {
                    const cell = source.months[month];
                    return (
                      <td key={month} className="px-1 py-1">
                        <GridCell
                          amountPence={cell?.amountPence}
                          paid={true}
                          previousAmountPence={cell?.previousAmountPence}
                          showPaidToggle={false}
                          onCommitAmount={(pounds) =>
                            updateIncomeAmount({ incomeSourceId: source.id, year, month, pounds })
                          }
                          onClearAmount={() =>
                            clearIncomeAmount({ incomeSourceId: source.id, year, month })
                          }
                        />
                      </td>
                    );
                  })}
                  <td
                    style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--card") }}
                    className={cn("sticky z-10 px-3 py-1.5 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
                  >
                    {formatPence(source.yearTotalPence)}
                  </td>
                  <td
                    style={{ right: 0, backgroundColor: floatingPanelFill("--card") }}
                    className="sticky z-10 px-3 py-1.5 text-right font-bold tabular-nums"
                  >
                    {formatPence(source.monthlyAveragePence)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-secondary font-medium">
              <td className="sticky left-0 z-10 bg-secondary px-3 py-2">Total income</td>
              {totalByMonth.map((value, i) => (
                <td key={i} className="px-3 py-2 text-right tabular-nums">
                  {formatPence(value)}
                </td>
              ))}
              <td
                style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--secondary") }}
                className={cn("sticky z-10 px-3 py-2 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
              >
                {formatPence(yearTotal)}
              </td>
              <td
                style={{ right: 0, backgroundColor: floatingPanelFill("--secondary") }}
                className="sticky z-10 px-3 py-2 text-right font-bold tabular-nums"
              >
                {formatPence(Math.round(yearTotal / 12))}
              </td>
            </tr>
          </tfoot>
        </table>
      </ScrollFade>
    </div>
  );
}
