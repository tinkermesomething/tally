"use client";

import { useState } from "react";
import { ChevronRight, CalendarClock } from "lucide-react";
import { CategoryMonthCell } from "@/components/grid/category-row";
import { InlineEditText } from "@/components/inline-edit-text";
import { EditableGroupTag } from "@/components/grid/editable-group-tag";
import { AddSubcategoryDialog } from "@/components/grid/add-subcategory-dialog";
import { useCategoryDrag } from "@/components/grid/use-category-drag";
import { cn } from "@/lib/utils";
import type { GridCategory } from "@/lib/db/queries";
import { renameCategory, archiveCategory } from "@/app/grid/actions";
import { MONTH_ABBREVIATIONS as MONTH_NAMES } from "@/lib/months";

export function MobileCategoryCard({
  category,
  year,
  month,
  groupColor,
  existingGroups,
}: {
  category: GridCategory;
  year: number;
  month: number;
  groupColor: string;
  existingGroups: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = category.children.length > 0;
  const drag = useCategoryDrag(year);

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm" data-reorder-group="mobile-top" data-reorder-id={category.id}>
      {drag.error && (
        <p role="alert" className="mb-1 text-[0.65rem] text-status-critical">
          {drag.error}
        </p>
      )}
      <div className="flex items-start justify-between gap-2" onPointerDown={(e) => drag.onPointerDown(e, "mobile-top", category.id)}>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse" : "Expand"}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
            >
              <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
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
        <CategoryMonthCell category={category} year={year} month={month} onToggleExpand={hasChildren ? () => setExpanded((v) => !v) : undefined} />
      </div>
      <div className="flex items-center gap-1 pl-[18px]">
        <EditableGroupTag
          categoryId={category.id}
          groupName={category.groupName}
          color={groupColor}
          existingGroups={existingGroups}
        />
        {category.isAnnual && (
          <span className="inline-flex items-center gap-0.5 text-[0.65rem] text-muted-foreground">
            <CalendarClock className="size-3" />
            {category.annualMonth ? MONTH_NAMES[category.annualMonth - 1] : "Yearly"}
          </span>
        )}
        <AddSubcategoryDialog parentId={category.id} parentName={category.name} />
      </div>
      {expanded && hasChildren && (
        <div className="mt-2 ml-[18px] space-y-2 border-l border-border pl-3">
          {category.children.map((child) => (
            <div
              key={child.id}
              className="flex items-center justify-between gap-2"
              data-reorder-group={`mobile-kids-${category.id}`}
              data-reorder-id={child.id}
              onPointerDown={(e) => drag.onPointerDown(e, `mobile-kids-${category.id}`, child.id)}
            >
              <InlineEditText
                value={child.name}
                onCommit={(next) => renameCategory(child.id, next)}
                onDelete={() => archiveCategory(child.id)}
                className="min-w-0 text-sm text-muted-foreground uppercase"
              />
              <CategoryMonthCell category={child} year={year} month={month} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
