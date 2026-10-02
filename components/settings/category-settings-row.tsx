"use client";

import { useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineEditText } from "@/components/inline-edit-text";
import { EditableGroupTag } from "@/components/grid/editable-group-tag";
import { EditableDueDay } from "@/components/grid/editable-due-day";
import { EditableDebtLink } from "@/components/grid/editable-debt-link";
import { AddSubcategoryDialog } from "@/components/grid/add-subcategory-dialog";
import { MoveCategoryButton } from "@/components/settings/move-category-button";
import { renameCategory, archiveCategory } from "@/app/grid/actions";
import type { CategoryTreeNode } from "@/lib/db/queries";

export function CategorySettingsRow({
  category,
  color,
  existingGroups,
  topLevelCategories,
  people,
}: {
  category: CategoryTreeNode;
  color: string;
  existingGroups: string[];
  /** Every top-level category (including this one) - used to populate the
   * "move to" target list for this row and its children. */
  topLevelCategories: { id: number; name: string }[];
  people: { id: number; name: string }[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <InlineEditText
          value={category.name}
          onCommit={(next) => renameCategory(category.id, next)}
          className="font-medium"
        />
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
              linkedDebtPersonId={category.linkedDebtPersonId}
              people={people}
            />
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
          <Archive className="size-3.5" />
        </Button>
      </div>
      {category.children.length > 0 && (
        <div className="ml-5 space-y-1.5 border-l border-border pl-3">
          {category.children.map((child) => (
            <div
              key={child.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5"
            >
              <InlineEditText
                value={child.name}
                onCommit={(next) => renameCategory(child.id, next)}
              />
              <EditableDueDay categoryId={child.id} dueDay={child.dueDay} />
              <EditableDebtLink
                categoryId={child.id}
                linkedDebtPersonId={child.linkedDebtPersonId}
                people={people}
              />
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
                <Archive className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
