"use client";

import { useState } from "react";
import { ChevronRight, CalendarClock } from "lucide-react";
import { GridCell } from "@/components/grid/grid-cell";
import { InlineEditText } from "@/components/inline-edit-text";
import { EditableGroupTag } from "@/components/grid/editable-group-tag";
import { AddSubcategoryDialog } from "@/components/grid/add-subcategory-dialog";
import { formatPence } from "@/lib/money";
import { cn, FLOATING_PANEL_EDGE, floatingPanelFill } from "@/lib/utils";
import type { GridCategory } from "@/lib/db/queries";
import { renameCategory, updateAmount, togglePaid, confirmPayment } from "@/app/grid/actions";

const MONTH_NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
}: {
  amountPence: number | undefined;
  spentPence: number;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5 px-1.5 py-1">
      <span className="text-[0.925rem] tabular-nums text-foreground">
        {amountPence !== undefined ? formatPence(amountPence) : "—"}
      </span>
      {spentPence > 0 && (
        <span className="text-xs tabular-nums text-primary">Paid {formatPence(spentPence)}</span>
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
    return <ComputedCell amountPence={cell.amountPence} spentPence={cell.spentPence} />;
  }
  return (
    <GridCell
      amountPence={cell?.amountPence}
      paid={cell?.paid ?? false}
      spentPence={cell?.spentPence ?? 0}
      previousAmountPence={cell?.previousAmountPence}
      onCommitAmount={(pounds) => updateAmount({ categoryId: category.id, year, month, pounds })}
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
          {formatPence(category.yearTotalPence)}
        </td>
        <td
          style={{ right: 0, backgroundColor: floatingPanelFill("--card") }}
          className="sticky z-10 px-3 py-1.5 text-right font-bold tabular-nums"
        >
          {formatPence(category.monthlyAveragePence)}
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
              {formatPence(child.yearTotalPence)}
            </td>
            <td
              style={{ right: 0, backgroundColor: floatingPanelFill("--muted") }}
              className="sticky z-10 px-3 py-1.5 text-right font-bold text-muted-foreground tabular-nums"
            >
              {formatPence(child.monthlyAveragePence)}
            </td>
          </tr>
        ))}
    </>
  );
}
