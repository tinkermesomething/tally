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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCategory } from "@/app/grid/actions";

const NONE_PARENT = "none";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function AddCategoryDialog({
  topLevelCategories,
  existingGroups,
}: {
  topLevelCategories: { id: number; name: string }[];
  existingGroups: string[];
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
      await createCategory({
        name,
        parentId: parentId === NONE_PARENT ? null : parseInt(parentId, 10),
        groupName: groupName.trim() || null,
        isAnnual,
        annualMonth: isAnnual ? parseInt(annualMonth, 10) : null,
      });
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
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Plus className="size-4" />
            Add category
          </Button>
        }
      />
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

          <div className="flex items-center gap-2">
            <Checkbox
              id="category-annual"
              checked={isAnnual}
              onCheckedChange={(checked) => setIsAnnual(checked === true)}
            />
            <Label htmlFor="category-annual" className="font-normal">
              Billed yearly, not monthly
            </Label>
          </div>

          {isAnnual && (
            <div className="space-y-1.5">
              <Label htmlFor="category-annual-month">Usually billed in</Label>
              <Select value={annualMonth} onValueChange={(v) => setAnnualMonth(v ?? "1")}>
                <SelectTrigger id="category-annual-month" className="w-full">
                  <SelectValue>
                    {(value: string) => MONTHS[parseInt(value, 10) - 1] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
