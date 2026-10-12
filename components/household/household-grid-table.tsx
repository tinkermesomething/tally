"use client";

import { useState } from "react";
import { formatPence } from "@/lib/money";
import { budgetValueColorClass, cn } from "@/lib/utils";
import { buildGroupColorMap, UNGROUPED } from "@/lib/group-colors";
import { MONTH_ABBREVIATIONS as MONTHS } from "@/lib/months";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { HouseholdCellDetailPopover } from "@/components/household/household-cell-detail-popover";
import type { HouseholdGridRow } from "@/lib/db/household";

/** Read-only - a deliberately simpler sibling of DesktopGridTables
 * (components/grid/desktop-grid-tables.tsx), not a reuse of it: that
 * component (and CategoryRow/GridCell underneath it) is wired throughout
 * to one signed-in user's own mutate actions and real category ids, which
 * a cross-user, text-keyed, non-editable view has no business touching.
 * Same visual language (muted header, sticky category column, tabular
 * numbers, a totals row) so it reads as "the same kind of page," built
 * fresh. Budgeted/spent colour reuses the real grid's own
 * budgetValueColorClass (lib/utils.ts) for consistency. */
export function HouseholdGridTable({ rows, year }: { rows: HouseholdGridRow[]; year: number }) {
  const { currency } = useAppSettings();
  const [openCell, setOpenCell] = useState<{ categoryName: string; month: number; anchor: HTMLElement } | null>(null);
  const groupColors = buildGroupColorMap(rows);

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
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm">
      <table className="w-full border-collapse text-sm" style={{ minWidth: 980 }}>
        <thead>
          <tr className="bg-muted">
            <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">Category</th>
            {MONTHS.map((m) => (
              <th key={m} className="px-2 py-2 text-right font-medium">
                {m}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Year total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={14} className="px-3 py-10 text-center text-muted-foreground">
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
                  color={groupColors.get(group)!}
                  showGroupHeader={showGroupHeader}
                  group={group}
                  currency={currency}
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
              <td className="px-3 py-2 text-right font-bold tabular-nums">
                <CellValue budgetedPence={yearTotalBudgeted} spentPence={yearTotalSpent} currency={currency} />
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
    </div>
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
  onCellClick,
}: {
  row: HouseholdGridRow;
  color: string;
  showGroupHeader: boolean;
  group: string;
  currency: string;
  onCellClick: (month: number, anchor: HTMLElement) => void;
}) {
  return (
    <>
      {showGroupHeader && (
        <tr>
          <td colSpan={14} className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground" style={{ borderLeft: `3px solid ${color}` }}>
            {group}
          </td>
        </tr>
      )}
      <tr className="row-line border-b border-border/60" style={{ borderLeft: `3px solid ${color}` }}>
        <td className="sticky left-0 z-10 bg-card px-3 py-2">{row.categoryName}</td>
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
        <td className="px-3 py-2 text-right font-medium tabular-nums">
          <CellValue budgetedPence={row.yearBudgetedPence} spentPence={row.yearSpentPence} currency={currency} />
        </td>
      </tr>
    </>
  );
}
