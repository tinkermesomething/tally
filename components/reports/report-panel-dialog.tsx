"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createReportPanel, updateReportPanel } from "@/app/reports/actions";
import type { ReportPanelPick } from "@/lib/db/queries";

type CategoryOption = { id: number; name: string };

function defaultName(groups: string[], categoryIds: number[], categories: CategoryOption[]) {
  const categoryNames = categoryIds
    .map((id) => categories.find((c) => c.id === id)?.name)
    .filter((n): n is string => !!n);
  return [...groups, ...categoryNames].join(", ");
}

/** The dialog's whole state derives from `panel` (or blanks out for a new
 * one) - shared by useState's initializer and reset() so the two can't
 * silently drift apart. */
function initialState(panel?: { name: string; selection: ReportPanelPick[] }) {
  return {
    name: panel?.name ?? "",
    nameTouched: false,
    groups: new Set(panel?.selection.filter((p) => p.type === "group").map((p) => p.value as string)),
    categoryIds: new Set(
      panel?.selection.filter((p) => p.type === "category").map((p) => p.value as number)
    ),
    error: null as string | null,
  };
}

export function ReportPanelDialog({
  trigger,
  existingGroups,
  categories,
  panel,
}: {
  trigger: React.ReactElement;
  existingGroups: string[];
  categories: CategoryOption[];
  /** Omit to create a new panel; pass an existing one to edit it. */
  panel?: { id: number; name: string; selection: ReportPanelPick[] };
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => initialState(panel).name);
  const [nameTouched, setNameTouched] = useState(false);
  const [groups, setGroups] = useState<Set<string>>(() => initialState(panel).groups);
  const [categoryIds, setCategoryIds] = useState<Set<number>>(() => initialState(panel).categoryIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    const s = initialState(panel);
    setName(s.name);
    setNameTouched(s.nameTouched);
    setGroups(s.groups);
    setCategoryIds(s.categoryIds);
    setError(s.error);
  }

  function toggleGroup(group: string) {
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  function toggleCategory(id: number) {
    setCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const groupList = Array.from(groups);
    const categoryList = Array.from(categoryIds);
    if (groupList.length === 0 && categoryList.length === 0) {
      setError("Pick at least one group or category.");
      return;
    }
    const finalName = name.trim() || defaultName(groupList, categoryList, categories);
    const selection: ReportPanelPick[] = [
      ...groupList.map((value): ReportPanelPick => ({ type: "group", value })),
      ...categoryList.map((value): ReportPanelPick => ({ type: "category", value })),
    ];
    setError(null);
    startTransition(async () => {
      if (panel) {
        await updateReportPanel(panel.id, { name: finalName, selection });
      } else {
        await createReportPanel(finalName, selection);
      }
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{panel ? "Edit report panel" : "New report panel"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="panel-name">Name</Label>
            <Input
              id="panel-name"
              placeholder={defaultName(Array.from(groups), Array.from(categoryIds), categories) || "e.g. Household bills"}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              onBlur={() => {
                if (!nameTouched && !name.trim()) {
                  setName(defaultName(Array.from(groups), Array.from(categoryIds), categories));
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Groups</Label>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-input p-2">
              {existingGroups.map((group) => (
                <label key={group} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={groups.has(group)}
                    onCheckedChange={() => toggleGroup(group)}
                  />
                  {group}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Categories</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-input p-2">
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={categoryIds.has(c.id)}
                    onCheckedChange={() => toggleCategory(c.id)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-status-critical">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddReportPanelButton({
  existingGroups,
  categories,
}: {
  existingGroups: string[];
  categories: CategoryOption[];
}) {
  return (
    <ReportPanelDialog
      existingGroups={existingGroups}
      categories={categories}
      trigger={
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          Add report panel
        </Button>
      }
    />
  );
}
