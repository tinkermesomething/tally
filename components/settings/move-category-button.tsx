"use client";

import { useTransition } from "react";
import { FolderInput } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { moveCategory } from "@/app/grid/actions";

const TOP_LEVEL = "top-level";

/** Moves a category to a different (top-level) parent, or back to
 * top-level itself - only shown for categories with no children of their
 * own (this app's rollups are strictly two levels deep). Takes effect from
 * the current calendar year onward; past years keep showing the old
 * grouping - see moveCategoryParent's comment in lib/db/queries.ts. */
export function MoveCategoryButton({
  categoryId,
  currentParentId,
  topLevelCategories,
}: {
  categoryId: number;
  currentParentId: number | null;
  topLevelCategories: { id: number; name: string }[];
}) {
  const [, startTransition] = useTransition();

  const targets = topLevelCategories.filter((c) => c.id !== categoryId);
  const currentValue = currentParentId !== null ? String(currentParentId) : TOP_LEVEL;

  function handleChange(value: string | null) {
    if (!value || value === currentValue) return;
    const newParentId = value === TOP_LEVEL ? null : parseInt(value, 10);
    startTransition(() => moveCategory(categoryId, newParentId));
  }

  return (
    <Select value={currentValue} onValueChange={handleChange}>
      <SelectTrigger
        size="sm"
        className="h-auto w-auto gap-1 rounded-full border-0 bg-transparent px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:bg-accent"
        title="Move to a different category"
      >
        <SelectValue>
          {() => (
            <span className="inline-flex items-center gap-1">
              <FolderInput className="size-3" />
              Move
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TOP_LEVEL}>Top-level (no parent)</SelectItem>
        {targets.map((t) => (
          <SelectItem key={t.id} value={String(t.id)}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
