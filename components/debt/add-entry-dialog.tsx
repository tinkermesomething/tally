"use client";

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
import { addLedgerEntry } from "@/app/debt/actions";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const NONE = "none";

export function AddEntryDialog({
  personId,
  personName,
  incomeSources,
  categories,
}: {
  personId: number;
  personName: string;
  incomeSources: { id: number; name: string }[];
  categories: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"loan" | "repayment">("loan");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [incomeSourceId, setIncomeSourceId] = useState(NONE);
  const [categoryId, setCategoryId] = useState(NONE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setDirection("loan");
    setAmount("");
    setDate(todayIso());
    setNote("");
    setIncomeSourceId(NONE);
    setCategoryId(NONE);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pounds = parseFloat(amount);
    if (Number.isNaN(pounds) || pounds <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addLedgerEntry({
          personId,
          pounds,
          entryDate: date,
          direction,
          note: note.trim() || undefined,
          incomeSourceId:
            direction === "loan" && incomeSourceId !== NONE ? parseInt(incomeSourceId, 10) : undefined,
          categoryId:
            direction === "repayment" && categoryId !== NONE ? parseInt(categoryId, 10) : undefined,
        });
        reset();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add entry.");
      }
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
          <Button size="sm">
            <Plus className="size-4" />
            Add entry
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add entry for {personName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="entry-direction">Type</Label>
            <Select
              value={direction}
              onValueChange={(value) =>
                setDirection((value as "loan" | "repayment") ?? "loan")
              }
            >
              <SelectTrigger id="entry-direction" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    value === "loan"
                      ? "Borrowed (increases what you owe)"
                      : "Paid back (decreases what you owe)"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="loan">Borrowed (increases what you owe)</SelectItem>
                <SelectItem value="repayment">Paid back (decreases what you owe)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {direction === "loan" && (
            <div className="space-y-1.5">
              <Label htmlFor="entry-income-source">
                Also count as income this month (optional)
              </Label>
              <Select value={incomeSourceId} onValueChange={(v) => setIncomeSourceId(v ?? NONE)}>
                <SelectTrigger id="entry-income-source" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      value === NONE
                        ? "Don't count toward income"
                        : (incomeSources.find((s) => String(s.id) === value)?.name ?? value)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Don&apos;t count toward income</SelectItem>
                  {incomeSources.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {direction === "repayment" && (
            <div className="space-y-1.5">
              <Label htmlFor="entry-category">
                Also log as an expense this month (optional)
              </Label>
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? NONE)}>
                <SelectTrigger id="entry-category" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      value === NONE
                        ? "Don't count toward a category"
                        : (categories.find((c) => String(c.id) === value)?.name ?? value)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Don&apos;t count toward a category</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Stacked, not side-by-side - a native <input type="date"> has an
              intrinsic min-content width browsers won't shrink below, which
              overflows this dialog's fixed ~24rem max-width on every screen
              size, not just narrow ones (iOS Safari also enforces
              box-sizing:content-box on it specifically, hence appearance-none
              below too). */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="entry-amount">Amount</Label>
              <Input
                id="entry-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entry-date">Date</Label>
              <Input
                id="entry-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full max-w-full appearance-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="entry-note">Note (optional)</Label>
            <Input
              id="entry-note"
              placeholder="e.g. petrol money"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
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
