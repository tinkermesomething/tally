"use client";

import { useEffect, useRef } from "react";
import { CategoryRow } from "@/components/grid/category-row";
import { IncomeTable } from "@/components/grid/income-table";
import { MonthlySummaryTable } from "@/components/grid/monthly-summary-table";
import { ScrollFade } from "@/components/scroll-fade";
import { formatPence } from "@/lib/money";
import { cn, FLOATING_PANEL_EDGE, STICKY_HEADER_ROW, floatingPanelFill } from "@/lib/utils";
import { CATEGORY_COL_WIDTH, MONTH_COL_WIDTH, SUMMARY_COL_WIDTH, TABLE_WIDTH } from "@/lib/grid-layout";
import { UNGROUPED } from "@/lib/group-colors";
import type { GridCategory, IncomeSourceRow } from "@/lib/db/queries";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** The expense table, the WAGES/AVAILABLE/Remaining bubble, and the income
 * table are three separate horizontally-scrollable regions sharing the same
 * column layout - keeping their scroll positions in sync (and starting them
 * near the current month instead of always January) makes them read as one
 * scrolling surface instead of three independently-drifting tables. */
export function DesktopGridTables({
  categories,
  year,
  groupColors,
  existingGroups,
  subtotalByMonth,
  yearTotalSubtotal,
  wagesByMonth,
  availableByMonth,
  remainingByMonth,
  yearTotalWages,
  yearTotalAvailable,
  incomeSources,
  currentMonthIndex,
}: {
  categories: GridCategory[];
  year: number;
  groupColors: Record<string, string>;
  existingGroups: string[];
  subtotalByMonth: number[];
  yearTotalSubtotal: number;
  wagesByMonth: number[];
  availableByMonth: number[];
  remainingByMonth: number[];
  yearTotalWages: number;
  yearTotalAvailable: number;
  incomeSources: IncomeSourceRow[];
  currentMonthIndex: number;
}) {
  const expenseRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const incomeRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);

  function mirrorScroll(source: HTMLDivElement) {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    for (const ref of [expenseRef, summaryRef, incomeRef]) {
      if (ref.current && ref.current !== source) {
        ref.current.scrollLeft = source.scrollLeft;
      }
    }
    isSyncingRef.current = false;
  }

  useEffect(() => {
    const el = expenseRef.current;
    if (!el) return;
    // Bring the current month into view (roughly centered in the space
    // between the sticky category column and the sticky Year Total/Monthly
    // avg columns) instead of always starting scrolled to January. Clamped
    // to the valid scroll range, which is what naturally handles December
    // and January sitting at the edges - there's nowhere further to center
    // them, so they just end up flush against that edge instead.
    const visibleMonthWidth = el.clientWidth - CATEGORY_COL_WIDTH - SUMMARY_COL_WIDTH * 2;
    const monthCenter = currentMonthIndex * MONTH_COL_WIDTH + MONTH_COL_WIDTH / 2;
    const target = monthCenter - visibleMonthWidth / 2;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const clamped = Math.max(0, Math.min(target, maxScroll));
    for (const ref of [expenseRef, summaryRef, incomeRef]) {
      if (ref.current) ref.current.scrollLeft = clamped;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <ScrollFade
        className="hidden overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm md:block"
        leftInset={CATEGORY_COL_WIDTH}
        rightInset={SUMMARY_COL_WIDTH * 2}
        containerRef={expenseRef}
        onScroll={mirrorScroll}
      >
        <table
          className="border-collapse text-sm"
          style={{ tableLayout: "fixed", width: TABLE_WIDTH }}
        >
          <colgroup>
            <col style={{ width: CATEGORY_COL_WIDTH }} />
            {MONTHS.map((m) => (
              <col key={m} style={{ width: MONTH_COL_WIDTH }} />
            ))}
            <col style={{ width: SUMMARY_COL_WIDTH }} />
            <col style={{ width: SUMMARY_COL_WIDTH }} />
          </colgroup>
          <thead>
            <tr className="bg-muted">
              <th className={cn(STICKY_HEADER_ROW, "left-0 bg-muted px-3 py-2 text-left font-medium")}>
                Category
              </th>
              {MONTHS.map((m) => (
                <th key={m} className={cn(STICKY_HEADER_ROW, "bg-muted px-3 py-2 text-right font-medium")}>
                  {m}
                </th>
              ))}
              <th
                style={{ right: SUMMARY_COL_WIDTH, backgroundColor: floatingPanelFill("--muted") }}
                className={cn(STICKY_HEADER_ROW, "px-3 py-2 text-right font-medium", FLOATING_PANEL_EDGE)}
              >
                Year Total
              </th>
              <th
                style={{ right: 0, backgroundColor: floatingPanelFill("--muted") }}
                className={cn(STICKY_HEADER_ROW, "px-3 py-2 text-right font-medium")}
              >
                Monthly avg
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                year={year}
                summaryColWidth={SUMMARY_COL_WIDTH}
                groupColor={groupColors[category.groupName ?? UNGROUPED]}
                existingGroups={existingGroups}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-secondary font-medium">
              <td className="sticky left-0 z-10 bg-secondary px-3 py-2">SUBTOTAL</td>
              {subtotalByMonth.map((value, i) => (
                <td key={i} className="px-3 py-2 text-right tabular-nums">
                  {formatPence(value)}
                </td>
              ))}
              <td
                style={{ right: SUMMARY_COL_WIDTH, backgroundColor: floatingPanelFill("--secondary") }}
                className={cn("sticky z-10 px-3 py-2 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
              >
                {formatPence(yearTotalSubtotal)}
              </td>
              <td
                style={{ right: 0, backgroundColor: floatingPanelFill("--secondary") }}
                className="sticky z-10 px-3 py-2 text-right font-bold tabular-nums"
              >
                {formatPence(Math.round(yearTotalSubtotal / 12))}
              </td>
            </tr>
          </tfoot>
        </table>
      </ScrollFade>

      <div className="hidden md:block">
        <MonthlySummaryTable
          wagesByMonth={wagesByMonth}
          availableByMonth={availableByMonth}
          remainingByMonth={remainingByMonth}
          yearTotal={{ wages: yearTotalWages, available: yearTotalAvailable }}
          categoryColWidth={CATEGORY_COL_WIDTH}
          monthColWidth={MONTH_COL_WIDTH}
          summaryColWidth={SUMMARY_COL_WIDTH}
          containerRef={summaryRef}
          onScroll={mirrorScroll}
        />
      </div>

      <div className="hidden md:block">
        <IncomeTable
          sources={incomeSources}
          year={year}
          totalByMonth={wagesByMonth}
          categoryColWidth={CATEGORY_COL_WIDTH}
          monthColWidth={MONTH_COL_WIDTH}
          summaryColWidth={SUMMARY_COL_WIDTH}
          containerRef={incomeRef}
          onScroll={mirrorScroll}
        />
      </div>
    </>
  );
}
