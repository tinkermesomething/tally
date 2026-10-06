"use client";

import { Plus } from "lucide-react";
import { GridCell } from "@/components/grid/grid-cell";
import { formatPence } from "@/lib/money";
import { ScrollFade } from "@/components/scroll-fade";
import { AddIncomeSourceDialog } from "@/components/grid/add-income-source-dialog";
import { updateIncomeAmount, clearIncomeAmount } from "@/app/grid/actions";
import type { IncomeSourceRow } from "@/lib/db/queries";
import { GROUP_PALETTE } from "@/lib/group-colors";
import { cn, FLOATING_PANEL_EDGE, floatingPanelFill } from "@/lib/utils";
import { MONTH_ABBREVIATIONS as MONTHS, MONTH_NUMBERS } from "@/lib/months";
import { useAppSettings } from "@/components/providers/app-settings-provider";

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
  const { currency } = useAppSettings();
  const tableWidth = categoryColWidth + monthColWidth * 12 + summaryColWidth * 2;
  const yearTotal = totalByMonth.reduce((a, b) => a + b, 0);

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
              <div className="flex items-center gap-1">
                Income Source
                <AddIncomeSourceDialog
                  trigger={
                    <button
                      type="button"
                      title="Add income source"
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  }
                />
              </div>
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
            sources.map((source, index) => (
              <tr
                key={source.id}
                className="tinted-row border-t border-border"
                style={{ "--row-color": source.color ?? GROUP_PALETTE[index % GROUP_PALETTE.length] } as React.CSSProperties}
              >
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
                  {formatPence(source.yearTotalPence, currency)}
                </td>
                <td
                  style={{ right: 0, backgroundColor: floatingPanelFill("--card") }}
                  className="sticky z-10 px-3 py-1.5 text-right font-bold tabular-nums"
                >
                  {formatPence(source.monthlyAveragePence, currency)}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="tinted-row border-t border-border bg-secondary font-medium" style={{ "--row-color": "var(--status-good)" } as React.CSSProperties}>
            <td className="sticky left-0 z-10 bg-secondary px-3 py-2">Total income</td>
            {totalByMonth.map((value, i) => (
              <td key={i} className="px-3 py-2 text-right tabular-nums">
                {formatPence(value, currency)}
              </td>
            ))}
            <td
              style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--secondary") }}
              className={cn("sticky z-10 px-3 py-2 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
            >
              {formatPence(yearTotal, currency)}
            </td>
            <td
              style={{ right: 0, backgroundColor: floatingPanelFill("--secondary") }}
              className="sticky z-10 px-3 py-2 text-right font-bold tabular-nums"
            >
              {formatPence(Math.round(yearTotal / 12), currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </ScrollFade>
  );
}
