"use client";

import { useState } from "react";
import { formatPence } from "@/lib/money";
import { budgetValueColorClass, cn, FLOATING_PANEL_EDGE, floatingPanelFill } from "@/lib/utils";
import { UNGROUPED } from "@/lib/group-colors";
import { MONTH_ABBREVIATIONS as MONTHS } from "@/lib/months";
import { ScrollFade } from "@/components/scroll-fade";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { HouseholdCellDetailPopover } from "@/components/household/household-cell-detail-popover";
import type { HouseholdGridRow } from "@/lib/db/household";

/** Read-only - a deliberately simpler sibling of DesktopGridTables
 * (components/grid/desktop-grid-tables.tsx), not a reuse of it: that
 * component (and CategoryRow/GridCell underneath it) is wired throughout
 * to one signed-in user's own mutate actions and real category ids, which
 * a cross-user, text-keyed, non-editable view has no business touching.
 * Same column widths, same sticky left/right columns, same scroll-fade -
 * it's meant to read as the SAME grid, just not editable here. Width/sync
 * props (monthColWidth, containerRef, onScroll) come from the shared
 * household-desktop-tables.tsx wrapper, same way the Grid's own
 * IncomeTable/MonthlySummaryTable take theirs from DesktopGridTables. */
export function HouseholdGridTable({
  rows,
  year,
  groupColors,
  categoryColWidth,
  monthColWidth,
  summaryColWidth,
  containerRef,
  onScroll,
}: {
  rows: HouseholdGridRow[];
  year: number;
  groupColors: Map<string, string>;
  categoryColWidth: number;
  monthColWidth: number;
  summaryColWidth: number;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (el: HTMLDivElement) => void;
}) {
  const { currency } = useAppSettings();
  const [openCell, setOpenCell] = useState<{ categoryName: string; month: number; anchor: HTMLElement } | null>(null);
  const tableWidth = categoryColWidth + monthColWidth * 12 + summaryColWidth * 2;

  const monthTotals = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    return rows.reduce(
      (sum, r) => ({ budgetedPence: sum.budgetedPence + r.months[month].budgetedPence, spentPence: sum.spentPence + r.months[month].spentPence }),
      { budgetedPence: 0, spentPence: 0 }
    );
  });
  const yearTotalBudgeted = rows.reduce((s, r) => s + r.yearBudgetedPence, 0);
  const yearTotalSpent = rows.reduce((s, r) => s + r.yearSpentPence, 0);

  let lastGroup: string | null = null;

  return (
    <ScrollFade
      className="overflow-x-auto overflow-y-hidden rounded-xl border border-border/60 bg-card shadow-sm"
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
            <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">Category</th>
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
                Nothing shared for {year} yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const group = row.groupName ?? UNGROUPED;
              const showGroupHeader = group !== lastGroup;
              lastGroup = group;
              return (
                <GroupedRow
                  key={row.categoryName}
                  row={row}
                  color={groupColors.get(group) ?? "var(--chart-1)"}
                  showGroupHeader={showGroupHeader}
                  group={group}
                  currency={currency}
                  summaryColWidth={summaryColWidth}
                  onCellClick={(month, anchor) => setOpenCell({ categoryName: row.categoryName, month, anchor })}
                />
              );
            })
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-border bg-secondary font-medium">
              <td className="sticky left-0 z-10 bg-secondary px-3 py-2">TOTAL</td>
              {monthTotals.map((t, i) => (
                <td key={i} className="px-2 py-2 text-right tabular-nums">
                  <CellValue budgetedPence={t.budgetedPence} spentPence={t.spentPence} currency={currency} />
                </td>
              ))}
              <td
                style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--secondary") }}
                className={cn("sticky z-10 px-3 py-2 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
              >
                <CellValue budgetedPence={yearTotalBudgeted} spentPence={yearTotalSpent} currency={currency} />
              </td>
              <td style={{ right: 0, backgroundColor: floatingPanelFill("--secondary") }} className="sticky z-10 px-3 py-2 text-right font-bold tabular-nums">
                <CellValue budgetedPence={Math.round(yearTotalBudgeted / 12)} spentPence={Math.round(yearTotalSpent / 12)} currency={currency} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      {openCell && (
        <HouseholdCellDetailPopover
          categoryName={openCell.categoryName}
          year={year}
          month={openCell.month}
          anchor={openCell.anchor}
          onClose={() => setOpenCell(null)}
        />
      )}
    </ScrollFade>
  );
}

function CellValue({ budgetedPence, spentPence, currency }: { budgetedPence: number; spentPence: number; currency: string }) {
  if (budgetedPence === 0 && spentPence === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={budgetValueColorClass(budgetedPence || undefined, spentPence)}>
      {formatPence(budgetedPence, currency)}
      {spentPence > 0 && <span className="block text-xs font-normal tabular-nums text-muted-foreground">Spent {formatPence(spentPence, currency)}</span>}
    </span>
  );
}

function GroupedRow({
  row,
  color,
  showGroupHeader,
  group,
  currency,
  summaryColWidth,
  onCellClick,
}: {
  row: HouseholdGridRow;
  color: string;
  showGroupHeader: boolean;
  group: string;
  currency: string;
  summaryColWidth: number;
  onCellClick: (month: number, anchor: HTMLElement) => void;
}) {
  return (
    <>
      {showGroupHeader && (
        <tr>
          {/* `sticky` on a `colSpan` cell doesn't pin reliably (it tracks the
              whole spanned width, not just what's visible) - exactly what
              produced the blank-looking bar bug. Splitting into one
              single-column sticky cell (matching every data row's own
              category cell) plus a plain filler for the rest keeps the
              sticky behaviour working the same way it already does for
              every other row. */}
          <td className="sticky left-0 z-10 bg-card px-3 pt-3 pb-1">
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
            >
              {group}
            </span>
          </td>
          <td colSpan={14} className="bg-card" />
        </tr>
      )}
      <tr className="row-line border-b border-border/60">
        <td className="sticky left-0 z-10 bg-card px-3 py-2" style={{ borderLeft: `3px solid ${color}` }}>
          <span style={{ color }} className="font-medium">
            {row.categoryName}
          </span>
          {row.contributors.length > 0 && (
            <span className="block truncate text-xs font-normal text-muted-foreground" title={row.contributors.join(", ")}>
              {row.contributors.join(", ")}
            </span>
          )}
        </td>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
          const cell = row.months[month];
          const hasData = cell.budgetedPence > 0 || cell.spentPence > 0;
          return (
            <td key={month} className="px-2 py-2 text-right tabular-nums">
              {hasData ? (
                <button
                  type="button"
                  onClick={(e) => onCellClick(month, e.currentTarget)}
                  className={cn("rounded px-1 py-0.5 hover:bg-accent", budgetValueColorClass(cell.budgetedPence || undefined, cell.spentPence))}
                  title="Click to see who contributed"
                >
                  {formatPence(cell.budgetedPence, currency)}
                  {cell.spentPence > 0 && <span className="block text-xs font-normal text-muted-foreground">Spent {formatPence(cell.spentPence, currency)}</span>}
                </button>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
          );
        })}
        <td
          style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--card") }}
          className={cn("sticky z-10 px-3 py-2 text-right font-medium tabular-nums", FLOATING_PANEL_EDGE)}
        >
          <CellValue budgetedPence={row.yearBudgetedPence} spentPence={row.yearSpentPence} currency={currency} />
        </td>
        <td style={{ right: 0, backgroundColor: floatingPanelFill("--card") }} className="sticky z-10 px-3 py-2 text-right font-medium tabular-nums">
          <CellValue budgetedPence={Math.round(row.yearBudgetedPence / 12)} spentPence={Math.round(row.yearSpentPence / 12)} currency={currency} />
        </td>
      </tr>
    </>
  );
}
