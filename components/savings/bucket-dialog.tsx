"use client";

import { useState, useTransition } from "react";
import { PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ColourPicker } from "@/components/savings/colour-picker";
import { nativePickerActive } from "@/components/swatch-row";
import { createBucket, editBucket } from "@/app/savings/actions";
import { runAction } from "@/lib/action-result";
import { parsePounds } from "@/lib/money-input";

export type EditableBucket = {
  id: number;
  name: string;
  color: string | null;
  goalPence: number | null;
  goalDate: string | null;
  openingPence: number;
  note: string | null;
};

const pounds = (pence: number | null) => (pence ? (pence / 100).toFixed(2) : "");

function initial(bucket?: EditableBucket) {
  return {
    name: bucket?.name ?? "",
    goal: pounds(bucket?.goalPence ?? null),
    goalDate: bucket?.goalDate ?? "",
    opening: bucket?.openingPence ? pounds(bucket.openingPence) : "",
    color: bucket?.color ?? "",
    note: bucket?.note ?? "",
  };
}

/** Create a bucket, or edit one. Only the name is required. */
export function BucketDialog({ trigger, bucket }: { trigger: React.ReactElement; bucket?: EditableBucket }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => initial(bucket));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const goal = form.goal.trim() ? parsePounds(form.goal) : null;
    const opening = form.opening.trim() ? parsePounds(form.opening) : null;
    if (form.goal.trim() && (goal === null || goal <= 0)) return setError("Enter the goal as an amount, e.g. 2000 or 2000.50.");
    if (form.opening.trim() && opening === null) return setError("Enter the opening balance as an amount, e.g. 150.");
    if (form.goalDate && !form.goal.trim()) {
      // A date alone is allowed (it still counts the days down); nothing to compute per month.
    }
    setError(null);
    startTransition(async () => {
      const payload = {
        name: form.name,
        color: form.color || null,
        goalPounds: goal,
        goalDate: form.goalDate || null,
        openingPounds: opening,
        note: form.note || null,
      };
      const failure = await runAction(() => (bucket ? editBucket(bucket.id, payload) : createBucket(payload)));
      if (failure) return setError(failure);
      if (!bucket) setForm(initial());
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && nativePickerActive()) return;
        setOpen(next);
        setForm(initial(bucket)); // fresh on every open and close
        setError(null);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{bucket ? "Edit bucket" : "New savings bucket"}</DialogTitle>
          <DialogDescription>Only the name is needed. Add a goal, a date or a colour if you want them.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bucket-name">Name</Label>
            <Input id="bucket-name" autoFocus placeholder="e.g. Kids savings, Holiday" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bucket-goal">Goal (£, optional)</Label>
              <Input id="bucket-goal" inputMode="decimal" placeholder="2000" value={form.goal} onChange={(e) => set({ goal: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bucket-date">Goal date (optional)</Label>
              <Input id="bucket-date" type="date" value={form.goalDate} onChange={(e) => set({ goalDate: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bucket-opening">Already saved (£, optional)</Label>
            <Input id="bucket-opening" inputMode="decimal" placeholder="0" value={form.opening} onChange={(e) => set({ opening: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <ColourPicker value={form.color} onChange={(color) => set({ color })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bucket-note">Note (optional)</Label>
            <Input id="bucket-note" placeholder="e.g. Revolut pot: Holiday" value={form.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
          {error && <p className="text-sm text-status-critical">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : bucket ? "Save" : "Create bucket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddBucketButton() {
  return (
    <BucketDialog
      trigger={
        <Button size="sm" variant="outline">
          <PiggyBank className="size-4 text-chart-6" />
          New bucket
        </Button>
      }
    />
  );
}
