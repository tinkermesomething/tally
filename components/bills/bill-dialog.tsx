"use client";

import { useState, useTransition } from "react";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createBill, editBill } from "@/app/bills/actions";
import { parsePounds } from "@/lib/money-input";
import { BILL_CADENCES, type BillCadence } from "@/lib/bills-math";

const today = () => new Date().toLocaleDateString("en-CA");

const CADENCE_LABELS: Record<BillCadence, string> = {
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
  custom_days: "Every N days",
};

const NO_CATEGORY = "none";

export type EditableBill = {
  id: number;
  name: string;
  amountPence: number;
  cadence: BillCadence;
  cadenceDays: number | null;
  nextDueDate: string;
  categoryId: number | null;
};

function initial(bill?: EditableBill) {
  return {
    name: bill?.name ?? "",
    amount: bill ? (bill.amountPence / 100).toFixed(2) : "",
    cadence: bill?.cadence ?? ("monthly" as BillCadence),
    cadenceDays: bill?.cadenceDays ? String(bill.cadenceDays) : "",
    nextDueDate: bill?.nextDueDate ?? today(),
    categoryId: bill?.categoryId ? String(bill.categoryId) : NO_CATEGORY,
  };
}

/** Create a bill, or edit one. categoryId is how it gets marked paid
 * automatically - see lib/db/bills.ts's advanceBillsForExpense. Without
 * one, "Mark paid" (components/bills/bill-row.tsx) is the only way to
 * advance it. */
export function BillDialog({
  trigger,
  bill,
  categories,
}: {
  trigger: React.ReactElement;
  bill?: EditableBill;
  categories: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => initial(bill));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Enter a name.");
    const pounds = parsePounds(form.amount);
    if (pounds === null || pounds <= 0) return setError("Enter an amount, e.g. 25 or 25.50.");
    if (!form.nextDueDate) return setError("Pick the next due date.");
    const cadenceDays = form.cadence === "custom_days" ? parseInt(form.cadenceDays, 10) : null;
    if (form.cadence === "custom_days" && (!Number.isInteger(cadenceDays) || (cadenceDays ?? 0) < 1)) {
      return setError("Enter how many days between each one.");
    }
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          name: form.name,
          pounds,
          cadence: form.cadence,
          cadenceDays,
          nextDueDate: form.nextDueDate,
          categoryId: form.categoryId === NO_CATEGORY ? null : parseInt(form.categoryId, 10),
        };
        if (bill) await editBill(bill.id, payload);
        else await createBill(payload);
        if (!bill) setForm(initial());
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save that.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); setForm(initial(bill)); setError(null); }}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{bill ? "Edit bill" : "New bill"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bill-name">Name</Label>
            <Input id="bill-name" autoFocus placeholder="e.g. Netflix, Rent, Council tax" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bill-amount">Amount (£)</Label>
              <Input id="bill-amount" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-due">Next due</Label>
              <Input id="bill-due" type="date" value={form.nextDueDate} onChange={(e) => set({ nextDueDate: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bill-cadence">Repeats</Label>
              <Select value={form.cadence} onValueChange={(v) => set({ cadence: v as BillCadence })}>
                <SelectTrigger id="bill-cadence"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILL_CADENCES.map((c) => (
                    <SelectItem key={c} value={c}>{CADENCE_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.cadence === "custom_days" && (
              <div className="space-y-1.5">
                <Label htmlFor="bill-cadence-days">Every how many days</Label>
                <Input id="bill-cadence-days" inputMode="numeric" placeholder="30" value={form.cadenceDays} onChange={(e) => set({ cadenceDays: e.target.value })} />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bill-category">Category (optional)</Label>
            <Select value={form.categoryId} onValueChange={(v) => set({ categoryId: v ?? NO_CATEGORY })}>
              <SelectTrigger id="bill-category" className="w-full">
                <SelectValue>
                  {(v: string) => (v === NO_CATEGORY ? "No category - mark paid by hand" : categories.find((c) => String(c.id) === v)?.name ?? v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>No category - mark paid by hand</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">An expense logged in this category on or after the due date marks it paid automatically.</p>
          </div>
          {error && <p className="text-sm text-status-critical">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : bill ? "Save" : "Add bill"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddBillButton({ categories }: { categories: { id: number; name: string }[] }) {
  return (
    <BillDialog
      categories={categories}
      trigger={
        <Button size="sm" variant="outline">
          <Receipt className="size-4" />
          Add bill
        </Button>
      }
    />
  );
}
