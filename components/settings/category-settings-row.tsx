"use client";

import { useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineEditText } from "@/components/inline-edit-text";
import { EditableGroupTag } from "@/components/grid/editable-group-tag";
import { EditableDueDay } from "@/components/grid/editable-due-day";
import { EditableDebtLink } from "@/components/grid/editable-debt-link";
import { EditableBucketLink } from "@/components/settings/editable-bucket-link";
import { EditableHouseholdLink } from "@/components/grid/editable-household-link";
import { CategoryBillLink } from "@/components/settings/category-bill-link";
import { AddSubcategoryDialog } from "@/components/grid/add-subcategory-dialog";
import { MoveCategoryButton } from "@/components/settings/move-category-button";
import { useCategoryDrag } from "@/components/grid/use-category-drag";
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

  return (
    <div className="space-y-1.5" data-reorder-group="settings-top" data-reorder-id={category.id}>
      <div className="flex items-center gap-2 row-card rounded-lg bg-card px-3 py-2">
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
        <EditableDueDay categoryId={category.id} dueDay={category.dueDay} />
        {category.children.length === 0 && (
          <>
            <EditableDebtLink
              categoryId={category.id}
              categoryName={category.name}
              linkedDebtPersonId={category.linkedDebtPersonId}
              people={people}
            />
            <EditableBucketLink
              categoryId={category.id}
              categoryName={category.name}
              linkedBucketId={category.linkedBucketId}
              buckets={buckets}
            />
            <CategoryBillLink categoryId={category.id} bills={bills} />
            {householdEnabled && (
              <EditableHouseholdLink categoryId={category.id} categoryName={category.name} sharedToHousehold={category.sharedToHousehold} />
            )}
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
              <EditableDueDay categoryId={child.id} dueDay={child.dueDay} />
              <EditableDebtLink
                categoryId={child.id}
                categoryName={child.name}
                linkedDebtPersonId={child.linkedDebtPersonId}
                people={people}
              />
              <EditableBucketLink
                categoryId={child.id}
                categoryName={child.name}
                linkedBucketId={child.linkedBucketId}
                buckets={buckets}
              />
              <CategoryBillLink categoryId={child.id} bills={bills} />
              {householdEnabled && (
                <EditableHouseholdLink categoryId={child.id} categoryName={child.name} sharedToHousehold={child.sharedToHousehold} />
              )}
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
