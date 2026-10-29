"use client";

import { useState } from "react";
import { ChevronRight, CalendarClock } from "lucide-react";
import { GridCell } from "@/components/grid/grid-cell";
import { OverdueAlert } from "@/components/grid/overdue-alert";
import { overdueItemsFor, type OverdueItem } from "@/lib/overdue";
import { InlineEditText } from "@/components/inline-edit-text";
import { EditableGroupTag } from "@/components/grid/editable-group-tag";
import { AddSubcategoryDialog } from "@/components/grid/add-subcategory-dialog";
import { useCategoryDrag } from "@/components/grid/use-category-drag";
import { spentTotals } from "@/lib/grid-totals";
import { formatPence } from "@/lib/money";
import { cn, FLOATING_PANEL_EDGE, floatingPanelFill, budgetValueColorClass } from "@/lib/utils";
import type { GridCategory } from "@/lib/db/queries";
import {
  renameCategory,
  archiveCategory,
  updateAmount,
  clearAmount,
  togglePaid,
  confirmPayment,
} from "@/app/grid/actions";
import { MONTH_ABBREVIATIONS as MONTH_NAMES, MONTH_NUMBERS } from "@/lib/months";
import { useAppSettings } from "@/components/providers/app-settings-provider";

/** A total or average with, underneath, what was actually spent - the same
 * "Paid" line the month cells show, so the year columns tell the whole story.
 * `onToggleExpand`, when given (a parent's own year-total/average columns
 * only - see CategoryRow), makes that sub-line do the same thing the
 * chevron does, same reasoning as ComputedCell's own version below. */
function TotalWithPaid({
  budgeted,
  paid,
  currency,
  label = "Paid",
  onToggleExpand,
}: {
  budgeted: number;
  paid: number | undefined;
  currency: string;
  label?: string;
  onToggleExpand?: () => void;
}) {
  return (
    <>
      <div>{formatPence(budgeted, currency)}</div>
      {paid !== undefined && paid > 0 && (
        onToggleExpand ? (
          <button
            type="button"
            onClick={onToggleExpand}
            data-testid="paid-total"
            className="text-xs font-normal tabular-nums text-primary underline-offset-2 hover:underline"
          >
            {label} {formatPence(paid, currency)}
          </button>
        ) : (
          <div className="text-xs font-normal tabular-nums text-primary" data-testid="paid-total">
            {label} {formatPence(paid, currency)}
          </div>
        )
      )}
    </>
  );
}

function AnnualBadge({ annualMonth }: { annualMonth: number | null }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[0.65rem] text-muted-foreground"
      title={
        annualMonth
          ? `Billed yearly, usually in ${MONTH_NAMES[annualMonth - 1]}`
          : "Billed yearly"
      }
    >
      <CalendarClock className="size-3" />
      {annualMonth ? MONTH_NAMES[annualMonth - 1] : "Yearly"}
    </span>
  );
}

function ComputedCell({
  amountPence,
  spentPence,
  overdueItems,
  year,
  month,
  onToggleExpand,
}: {
  amountPence: number | undefined;
  spentPence: number;
  overdueItems: OverdueItem[];
  year: number;
  month: number;
  /** A computed cell only ever happens for a category WITH children (see
   * lib/db/grid.ts) - so this is always the parent's own chevron toggle,
   * never gated here. Clicking "Paid £X" does the same thing the chevron
   * does instead of opening a (non-existent, since this is a rollup of
   * several children, not one entries list) breakdown popup. */
  onToggleExpand: () => void;
}) {
  const { currency } = useAppSettings();
  return (
    <div className="flex flex-col items-end gap-0.5 px-1.5 py-1">
      <div className="flex items-center gap-1">
        {overdueItems.length > 0 && <OverdueAlert items={overdueItems} year={year} month={month} />}
        <span className={cn("text-[0.925rem] tabular-nums", budgetValueColorClass(amountPence, spentPence))}>
          {amountPence !== undefined ? formatPence(amountPence, currency) : "—"}
        </span>
      </div>
      {spentPence > 0 && (
        <button
          type="button"
          onClick={onToggleExpand}
          className="text-xs tabular-nums text-primary underline-offset-2 hover:underline"
        >
          Paid {formatPence(spentPence, currency)}
        </button>
      )}
    </div>
  );
}

export function CategoryMonthCell({
  category,
  year,
  month,
  onToggleExpand,
}: {
  category: GridCategory;
  year: number;
  month: number;
  /** Only meaningful when this category has children (a computed cell never
   * happens otherwise - see ComputedCell) - omit for a child's own cells,
   * which can't have children themselves. */
  onToggleExpand?: () => void;
}) {
  const cell = category.months[month];
  const overdueItems = overdueItemsFor(category, month);
  if (cell?.computed) {
    return (
      <ComputedCell
        amountPence={cell.amountPence}
        spentPence={cell.spentPence}
        overdueItems={overdueItems}
        year={year}
        month={month}
        onToggleExpand={onToggleExpand ?? (() => {})}
      />
    );
  }
  return (
    <GridCell
      amountPence={cell?.amountPence}
      paid={cell?.paid ?? false}
      spentPence={cell?.spentPence ?? 0}
      previousAmountPence={cell?.previousAmountPence}
      overdueItems={overdueItems}
      categoryId={category.id}
      year={year}
      month={month}
      onCommitAmount={(pounds) => updateAmount({ categoryId: category.id, year, month, pounds })}
      onClearAmount={() => clearAmount({ categoryId: category.id, year, month })}
      onTogglePaid={(paid) => togglePaid({ categoryId: category.id, year, month, paid })}
      onConfirmPayment={(pounds, entryDate) =>
        confirmPayment({ categoryId: category.id, year, month, pounds, entryDate })
      }
    />
  );
}

/** Renders a child (leaf) category's own row cells - always directly
 * editable, never computed, since only top-level categories can have
 * children in this app. */
function ChildRowCells({
  category,
  year,
  onHold,
}: {
  category: GridCategory;
  year: number;
  /** Press-and-hold on the name cell starts dragging this subcategory. */
  onHold: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  return (
    <>
      <td onPointerDown={onHold} className="sticky left-0 z-10 bg-muted px-3 py-1.5 pl-8 text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <InlineEditText
            value={category.name}
            onCommit={(next) => renameCategory(category.id, next)}
            onDelete={() => archiveCategory(category.id)}
            className="text-muted-foreground uppercase"
          />
          {category.isAnnual && <AnnualBadge annualMonth={category.annualMonth} />}
        </div>
      </td>
      {MONTH_NUMBERS.map((month) => (
        <td key={month} className="px-1 py-1">
          <CategoryMonthCell category={category} year={year} month={month} />
        </td>
      ))}
    </>
  );
}

export function CategoryRow({
  category,
  year,
  summaryColWidth,
  groupColor,
  existingGroups,
}: {
  category: GridCategory;
  year: number;
  summaryColWidth: number;
  groupColor: string;
  existingGroups: string[];
}) {
  const { currency } = useAppSettings();
  const [expanded, setExpanded] = useState(false);
  const hasChildren = category.children.length > 0;
  const drag = useCategoryDrag(year);

  return (
    <>
      <tr className="group border-t border-border/60" data-reorder-group="top" data-reorder-id={category.id}>
        <td
          onPointerDown={(e) => drag.onPointerDown(e, "top", category.id, "kids-")}
          className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium"
          title="Press and hold to drag this category up or down"
        >
          {drag.error && (
            <p role="alert" className="mb-1 text-[0.65rem] text-status-critical">
              {drag.error}
            </p>
          )}
          <div className="flex items-center gap-1">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? "Collapse" : "Expand"}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
              >
                <ChevronRight
                  className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
                />
              </button>
            ) : (
              <span className="w-[18px] shrink-0" />
            )}
            <InlineEditText
              value={category.name}
              onCommit={(next) => renameCategory(category.id, next)}
              onDelete={() => archiveCategory(category.id)}
              className="font-medium uppercase"
            />
          </div>
          {/* Metadata sits on its own line so it never competes with the
              name for space and forces a truncated, unreadable label. */}
          <div className="flex items-center gap-1 pl-[18px]">
            <EditableGroupTag
              categoryId={category.id}
              groupName={category.groupName}
              color={groupColor}
              existingGroups={existingGroups}
            />
            {category.isAnnual && <AnnualBadge annualMonth={category.annualMonth} />}
            <AddSubcategoryDialog parentId={category.id} parentName={category.name} />
          </div>
        </td>
        {MONTH_NUMBERS.map((month) => (
          <td key={month} className="px-1 py-1">
            <CategoryMonthCell category={category} year={year} month={month} onToggleExpand={() => setExpanded((v) => !v)} />
          </td>
        ))}
        <td
          style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--card") }}
          className={cn("sticky z-10 px-3 py-1.5 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
        >
          <TotalWithPaid
            budgeted={category.yearTotalPence}
            paid={spentTotals(category.actualByMonth).total}
            currency={currency}
            onToggleExpand={hasChildren ? () => setExpanded((v) => !v) : undefined}
          />
        </td>
        <td
          style={{ right: 0, backgroundColor: floatingPanelFill("--card") }}
          className="sticky z-10 px-3 py-1.5 text-right font-bold tabular-nums"
        >
          <TotalWithPaid
            budgeted={category.monthlyAveragePence}
            paid={spentTotals(category.actualByMonth).average}
            currency={currency}
            onToggleExpand={hasChildren ? () => setExpanded((v) => !v) : undefined}
          />
        </td>
      </tr>
      {expanded &&
        category.children.map((child) => (
          <tr
            key={child.id}
            className="group border-t border-border/40 bg-muted"
            data-reorder-group={`kids-${category.id}`}
            data-reorder-id={child.id}
          >
            <ChildRowCells category={child} year={year} onHold={(e) => drag.onPointerDown(e, `kids-${category.id}`, child.id)} />
            <td
              style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--muted") }}
              className={cn(
                "sticky z-10 px-3 py-1.5 text-right font-bold text-muted-foreground tabular-nums",
                FLOATING_PANEL_EDGE
              )}
            >
              <TotalWithPaid budgeted={child.yearTotalPence} paid={spentTotals(child.actualByMonth).total} currency={currency} />
            </td>
            <td
              style={{ right: 0, backgroundColor: floatingPanelFill("--muted") }}
              className="sticky z-10 px-3 py-1.5 text-right font-bold text-muted-foreground tabular-nums"
            >
              <TotalWithPaid budgeted={child.monthlyAveragePence} paid={spentTotals(child.actualByMonth).average} currency={currency} />
            </td>
          </tr>
        ))}
    </>
  );
}
