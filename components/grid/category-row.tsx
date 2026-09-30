"use client";

import { useState } from "react";
import { ChevronRight, CalendarClock, AlertCircle } from "lucide-react";
import { GridCell } from "@/components/grid/grid-cell";
import { InlineEditText } from "@/components/inline-edit-text";
import { EditableGroupTag } from "@/components/grid/editable-group-tag";
import { AddSubcategoryDialog } from "@/components/grid/add-subcategory-dialog";
import { formatPence } from "@/lib/money";
import { cn, FLOATING_PANEL_EDGE, floatingPanelFill } from "@/lib/utils";
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
  overdue,
}: {
  amountPence: number | undefined;
  spentPence: number;
  overdue: boolean;
}) {
  const { currency } = useAppSettings();
  return (
    <div className="flex flex-col items-end gap-0.5 px-1.5 py-1">
      <div className="flex items-center gap-1">
        {overdue && (
          <span title="Overdue">
            <AlertCircle className="size-3.5 shrink-0 text-status-critical" aria-label="Overdue" />
          </span>
        )}
        <span className="text-[0.925rem] tabular-nums text-foreground">
          {amountPence !== undefined ? formatPence(amountPence, currency) : "—"}
        </span>
      </div>
      {spentPence > 0 && (
        <span className="text-xs tabular-nums text-primary">Paid {formatPence(spentPence, currency)}</span>
      )}
    </div>
  );
}

export function CategoryMonthCell({
  category,
  year,
  month,
}: {
  category: GridCategory;
  year: number;
  month: number;
}) {
  const cell = category.months[month];
  if (cell?.computed) {
    return (
      <ComputedCell
        amountPence={cell.amountPence}
        spentPence={cell.spentPence}
        overdue={cell.overdue}
      />
    );
  }
  return (
    <GridCell
      amountPence={cell?.amountPence}
      paid={cell?.paid ?? false}
      spentPence={cell?.spentPence ?? 0}
      previousAmountPence={cell?.previousAmountPence}
      overdue={cell?.overdue ?? false}
      categoryId={category.id}
      year={year}
      month={month}
      onCommitAmount={(pounds) => updateAmount({ categoryId: category.id, year, month, pounds })}
      onClearAmount={() => clearAmount({ categoryId: category.id, year, month })}
      onTogglePaid={(paid) => togglePaid({ categoryId: category.id, year, month, paid })}
      onConfirmPayment={(pounds) => confirmPayment({ categoryId: category.id, year, month, pounds })}
    />
  );
}

/** Renders a child (leaf) category's own row cells - always directly
 * editable, never computed, since only top-level categories can have
 * children in this app. */
function ChildRowCells({ category, year }: { category: GridCategory; year: number }) {
  return (
    <>
      <td className="sticky left-0 z-10 bg-muted px-3 py-1.5 pl-8 text-muted-foreground">
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

  return (
    <>
      <tr className="group border-t border-border/60">
        <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium">
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
            <CategoryMonthCell category={category} year={year} month={month} />
          </td>
        ))}
        <td
          style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--card") }}
          className={cn("sticky z-10 px-3 py-1.5 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
        >
          {formatPence(category.yearTotalPence, currency)}
        </td>
        <td
          style={{ right: 0, backgroundColor: floatingPanelFill("--card") }}
          className="sticky z-10 px-3 py-1.5 text-right font-bold tabular-nums"
        >
          {formatPence(category.monthlyAveragePence, currency)}
        </td>
      </tr>
      {expanded &&
        category.children.map((child) => (
          <tr key={child.id} className="border-t border-border/40 bg-muted">
            <ChildRowCells category={child} year={year} />
            <td
              style={{ right: summaryColWidth, backgroundColor: floatingPanelFill("--muted") }}
              className={cn(
                "sticky z-10 px-3 py-1.5 text-right font-bold text-muted-foreground tabular-nums",
                FLOATING_PANEL_EDGE
              )}
            >
              {formatPence(child.yearTotalPence, currency)}
            </td>
            <td
              style={{ right: 0, backgroundColor: floatingPanelFill("--muted") }}
              className="sticky z-10 px-3 py-1.5 text-right font-bold text-muted-foreground tabular-nums"
            >
              {formatPence(child.monthlyAveragePence, currency)}
            </td>
          </tr>
        ))}
    </>
  );
}
