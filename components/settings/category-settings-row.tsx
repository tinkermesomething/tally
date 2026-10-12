"use client";

import { useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineEditText } from "@/components/inline-edit-text";
import { EditableGroupTag } from "@/components/grid/editable-group-tag";
import { CategoryLinksRow } from "@/components/settings/category-links-row";
import { CategoryBillLink } from "@/components/settings/category-bill-link";
import { AddSubcategoryDialog } from "@/components/grid/add-subcategory-dialog";
import { MoveCategoryButton } from "@/components/settings/move-category-button";
import { useCategoryDrag } from "@/components/grid/use-category-drag";
import { useCategorySelection } from "@/components/settings/category-selection-provider";
import { renameCategory, archiveCategory } from "@/app/grid/actions";
import type { CategoryTreeNode } from "@/lib/db/queries";
import type { BillWithStatus } from "@/lib/db/bills";

export function CategorySettingsRow({
  category,
  color,
  existingGroups,
  topLevelCategories,
  people,
  buckets = [],
  bills = [],
  householdEnabled = false,
}: {
  buckets?: { id: number; name: string; color: string }[];
  bills?: BillWithStatus[];
  /** Hides EditableHouseholdLink entirely when the household feature is
   * off instance-wide - no point offering a toggle for a tab that doesn't
   * exist. */
  householdEnabled?: boolean;
  category: CategoryTreeNode;
  color: string;
  existingGroups: string[];
  /** Every top-level category (including this one) - used to populate the
   * "move to" target list for this row and its children. */
  topLevelCategories: { id: number; name: string }[];
  people: { id: number; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const drag = useCategoryDrag(new Date().getFullYear());
  const { selected, toggle } = useCategorySelection();

  return (
    <div className="space-y-1.5" data-reorder-group="settings-top" data-reorder-id={category.id}>
      <div className="flex items-center gap-2 row-card rounded-lg bg-card px-3 py-2">
        <Checkbox
          checked={selected.has(category.id)}
          onCheckedChange={() => toggle(category.id)}
          aria-label={`Select ${category.name}`}
        />
        <span
          onPointerDown={(e) => drag.onPointerDown(e, "settings-top", category.id)}
          title="Press and hold to drag this category up or down"
          className="min-w-0"
        >
          <InlineEditText
            value={category.name}
            onCommit={(next) => renameCategory(category.id, next)}
            className="font-medium"
          />
        </span>
        {drag.error && (
          <span role="alert" className="text-xs text-status-critical">
            {drag.error}
          </span>
        )}
        <EditableGroupTag
          categoryId={category.id}
          groupName={category.groupName}
          color={color}
          existingGroups={existingGroups}
        />
        {/* Due day is always offered, even for a parent/rollup category (it
            can carry its own, independent of its children) - the other
            three links only make sense for a leaf, same gating this
            already had, now expressed as "not offered" (undefined) rather
            than not rendering CategoryLinksRow at all. */}
        <CategoryLinksRow
          categoryId={category.id}
          categoryName={category.name}
          dueDay={category.dueDay}
          linkedDebtPersonId={category.children.length === 0 ? category.linkedDebtPersonId : undefined}
          linkedBucketId={category.children.length === 0 ? category.linkedBucketId : undefined}
          sharedToHousehold={category.children.length === 0 ? category.sharedToHousehold : undefined}
          people={people}
          buckets={buckets}
          householdEnabled={householdEnabled}
        />
        {category.children.length === 0 && (
          <>
            <CategoryBillLink categoryId={category.id} bills={bills} />
            <MoveCategoryButton
              categoryId={category.id}
              currentParentId={null}
              topLevelCategories={topLevelCategories}
            />
          </>
        )}
        <AddSubcategoryDialog parentId={category.id} parentName={category.name} />
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          title="Archive"
          onClick={() => startTransition(() => archiveCategory(category.id))}
        >
          <Archive className="size-3.5 text-chart-2" />
        </Button>
      </div>
      {category.children.length > 0 && (
        <div className="ml-5 space-y-1.5 border-l border-border pl-3">
          {category.children.map((child) => (
            <div
              key={child.id}
              className="flex items-center gap-2 row-card rounded-lg bg-card px-3 py-1.5"
              data-reorder-group={`settings-kids-${category.id}`}
              data-reorder-id={child.id}
            >
              <Checkbox
                checked={selected.has(child.id)}
                onCheckedChange={() => toggle(child.id)}
                aria-label={`Select ${child.name}`}
              />
              <span
                onPointerDown={(e) => drag.onPointerDown(e, `settings-kids-${category.id}`, child.id)}
                title="Press and hold to drag this subcategory up or down"
                className="min-w-0"
              >
                <InlineEditText
                  value={child.name}
                  onCommit={(next) => renameCategory(child.id, next)}
                />
              </span>
              <CategoryLinksRow
                categoryId={child.id}
                categoryName={child.name}
                dueDay={child.dueDay}
                linkedDebtPersonId={child.linkedDebtPersonId}
                linkedBucketId={child.linkedBucketId}
                sharedToHousehold={child.sharedToHousehold}
                people={people}
                buckets={buckets}
                householdEnabled={householdEnabled}
              />
              <CategoryBillLink categoryId={child.id} bills={bills} />
              <MoveCategoryButton
                categoryId={child.id}
                currentParentId={category.id}
                topLevelCategories={topLevelCategories}
              />
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={pending}
                title="Archive"
                onClick={() => startTransition(() => archiveCategory(child.id))}
              >
                <Archive className="size-3.5 text-chart-2" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
