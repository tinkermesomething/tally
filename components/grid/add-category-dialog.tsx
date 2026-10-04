"use client";

import { runAction } from "@/lib/action-result";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCategory } from "@/app/grid/actions";
import { AnnualBillingFields } from "@/components/grid/annual-billing-fields";

const NONE_PARENT = "none";

const DEFAULT_TRIGGER = (
  <Button size="sm" variant="outline">
    <Plus className="size-4" />
    Add category
  </Button>
);

export function AddCategoryDialog({
  topLevelCategories,
  existingGroups,
  trigger = DEFAULT_TRIGGER,
}: {
  topLevelCategories: { id: number; name: string }[];
  existingGroups: string[];
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(NONE_PARENT);
  const [groupName, setGroupName] = useState("");
  const [isAnnual, setIsAnnual] = useState(false);
  const [annualMonth, setAnnualMonth] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setName("");
    setParentId(NONE_PARENT);
    setGroupName("");
    setIsAnnual(false);
    setAnnualMonth("1");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const failure = await runAction(() =>
        createCategory({
          name,
          parentId: parentId === NONE_PARENT ? null : parseInt(parentId, 10),
          groupName: groupName.trim() || null,
          isAnnual,
          annualMonth: isAnnual ? parseInt(annualMonth, 10) : null,
        })
      );
      if (failure) {
        setError(failure);
        return;
      }
      reset();
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New category</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              placeholder="e.g. Spotify, Car insurance"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="uppercase placeholder:normal-case"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category-parent">Nest under</Label>
            <Select value={parentId} onValueChange={(v) => setParentId(v ?? NONE_PARENT)}>
              <SelectTrigger id="category-parent" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    value === NONE_PARENT
                      ? "Nothing - top-level category"
                      : (topLevelCategories.find((c) => String(c.id) === value)?.name ?? value)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_PARENT}>Nothing - top-level category</SelectItem>
                {topLevelCategories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {parentId === NONE_PARENT && (
            <div className="space-y-1.5">
              <Label htmlFor="category-group">Group (for the pie chart)</Label>
              <Input
                id="category-group"
                list="existing-groups"
                placeholder="e.g. Housing, Utilities"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
              <datalist id="existing-groups">
                {existingGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
          )}

          <AnnualBillingFields
            idPrefix="category"
            isAnnual={isAnnual}
            onIsAnnualChange={setIsAnnual}
            annualMonth={annualMonth}
            onAnnualMonthChange={setAnnualMonth}
          />

          {error && <p className="text-sm text-status-critical">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
