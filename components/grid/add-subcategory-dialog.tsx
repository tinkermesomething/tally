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

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function AddSubcategoryDialog({
  parentId,
  parentName,
}: {
  parentId: number;
  parentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isAnnual, setIsAnnual] = useState(false);
  const [annualMonth, setAnnualMonth] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setName("");
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
        parentId,
        groupName: null,
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
          <button
            type="button"
            aria-label={`Add item under ${parentName}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3" />
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add item under {parentName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="subcategory-name">Name</Label>
            <Input
              id="subcategory-name"
              placeholder="e.g. Disney+"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="uppercase placeholder:normal-case"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="subcategory-annual"
              checked={isAnnual}
              onCheckedChange={(checked) => setIsAnnual(checked === true)}
            />
            <Label htmlFor="subcategory-annual" className="font-normal">
              Billed yearly, not monthly
            </Label>
          </div>

          {isAnnual && (
            <div className="space-y-1.5">
              <Label htmlFor="subcategory-annual-month">Usually billed in</Label>
              <Select value={annualMonth} onValueChange={(v) => setAnnualMonth(v ?? "1")}>
                <SelectTrigger id="subcategory-annual-month" className="w-full">
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
              {pending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
