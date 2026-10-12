"use client";

import { formatPence } from "@/lib/money";
import { cn, FLOATING_PANEL_EDGE, floatingPanelFill } from "@/lib/utils";
import { MONTH_ABBREVIATIONS as MONTHS } from "@/lib/months";
import { ScrollFade } from "@/components/scroll-fade";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import type { HouseholdIncomeGridRow } from "@/lib/db/household";

/** Same shape as the real Grid's own Income table (components/grid/income-table.tsx) -
 * amount only, no budgeted/planned split (personal income already has no
 * separate "planned" figure in this app either). Width/sync props come
 * from household-desktop-tables.tsx, same as the real IncomeTable takes
 * its own from DesktopGridTables. */
export function HouseholdIncomeTable({
  rows,
  year,
  categoryColWidth,
  monthColWidth,
  summaryColWidth,
  containerRef,
  onScroll,
}: {
  rows: HouseholdIncomeGridRow[];
  year: number;
  categoryColWidth: number;
  monthColWidth: number;
  summaryColWidth: number;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (el: HTMLDivElement) => void;
}) {
  const { currency } = useAppSettings();
  const tableWidth = categoryColWidth + monthColWidth * 12 + summaryColWidth * 2;
  const monthTotals = Array.from({ length: 12 }, (_, i) => rows.reduce((sum, r) => sum + r.months[i + 1], 0));
  const yearTotal = rows.reduce((s, r) => s + r.yearTotalPence, 0);

  return (
    <ScrollFade
      className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm"
      leftInset={categoryColWidth}
      rightInset={summaryColWidth * 2}
      containerRef={containerRef}
      onScroll={onScroll}
    >
      <table className="border-collapse text-sm" style={{ tableLayout: "fixed", width: tableWidth }}>
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
            <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">Income</th>
            {MONTHS.map((m) => (
              <th key={m} className="px-2 py-2 text-right font-medium">
                {m}
              </th>
            ))}
            <th
              style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--muted") }}
              className={cn("sticky z-10 px-3 py-2 text-right font-medium", FLOATING_PANEL_EDGE)}
            >
              Year Total
            </th>
            <th style={{ right: 0, backgroundColor: floatingPanelFill("--muted") }} className="sticky z-10 px-3 py-2 text-right font-medium">
              Monthly avg
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={15} className="px-3 py-10 text-center text-muted-foreground">
                No income shared for {year} yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.sourceName} className="row-line border-b border-border/60">
                <td className="sticky left-0 z-10 bg-card px-3 py-2">
                  {row.sourceName}
                  {row.contributors.length > 0 && (
                    <span className="block truncate text-xs font-normal text-muted-foreground" title={row.contributors.join(", ")}>
                      {row.contributors.join(", ")}
                    </span>
                  )}
                </td>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <td key={month} className="px-2 py-2 text-right tabular-nums">
                    {row.months[month] > 0 ? formatPence(row.months[month], currency) : <span className="text-muted-foreground">—</span>}
                  </td>
                ))}
                <td
                  style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--card") }}
                  className={cn("sticky z-10 px-3 py-2 text-right font-medium tabular-nums", FLOATING_PANEL_EDGE)}
                >
                  {formatPence(row.yearTotalPence, currency)}
                </td>
                <td style={{ right: 0, backgroundColor: floatingPanelFill("--card") }} className="sticky z-10 px-3 py-2 text-right font-medium tabular-nums">
                  {formatPence(Math.round(row.yearTotalPence / 12), currency)}
                </td>
              </tr>
            ))
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-border bg-secondary font-medium">
              <td className="sticky left-0 z-10 bg-secondary px-3 py-2">TOTAL</td>
              {monthTotals.map((t, i) => (
                <td key={i} className="px-2 py-2 text-right tabular-nums">
                  {formatPence(t, currency)}
                </td>
              ))}
              <td
                style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--secondary") }}
                className={cn("sticky z-10 px-3 py-2 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
              >
                {formatPence(yearTotal, currency)}
              </td>
              <td style={{ right: 0, backgroundColor: floatingPanelFill("--secondary") }} className="sticky z-10 px-3 py-2 text-right font-bold tabular-nums">
                {formatPence(Math.round(yearTotal / 12), currency)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </ScrollFade>
  );
}
