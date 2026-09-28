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
import { logIncome } from "@/app/grid/actions";
import { createPerson } from "@/app/debt/actions";

const NEW_PERSON = "__new__";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Logs a real income transaction - money someone lent you (linked to the
 * debt ledger as a loan), a gift, or wages, all the same form. The loan
 * link is opt-in and off by default, since most income isn't debt. */
export function AddIncomeDialog({
  incomeSources,
  people,
}: {
  incomeSources: { id: number; name: string }[];
  people: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [isLoan, setIsLoan] = useState(false);
  const [personId, setPersonId] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setSourceId("");
    setAmount("");
    setDate(todayIso());
    setIsLoan(false);
    setPersonId("");
    setNewPersonName("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pounds = parseFloat(amount);
    if (!sourceId) {
      setError("Pick an income source.");
      return;
    }
    if (Number.isNaN(pounds) || pounds <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (isLoan && !personId) {
      setError("Pick who it's from, or add a new person.");
      return;
    }
    if (isLoan && personId === NEW_PERSON && !newPersonName.trim()) {
      setError("Enter the new person's name.");
      return;
    }
    setError(null);
    startTransition(async () => {
      let debtPersonId: number | undefined;
      if (isLoan) {
        debtPersonId =
          personId === NEW_PERSON
            ? (await createPerson(newPersonName)).id
            : parseInt(personId, 10);
      }
      await logIncome({
        incomeSourceId: parseInt(sourceId, 10),
        pounds,
        entryDate: date,
        debtPersonId,
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
          <Button size="sm">
            <Plus className="size-4" />
            Add income
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add income</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="income-source">Source</Label>
            <Select value={sourceId} onValueChange={(v) => setSourceId(v ?? "")}>
              <SelectTrigger id="income-source" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    value ? (incomeSources.find((s) => String(s.id) === value)?.name ?? value) : "Choose a source"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {incomeSources.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="income-amount">Amount</Label>
              <Input
                id="income-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="income-date">Date</Label>
              <Input
                id="income-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="income-is-loan"
              checked={isLoan}
              onCheckedChange={(checked) => setIsLoan(checked === true)}
            />
            <Label htmlFor="income-is-loan" className="font-normal">
              This is a loan (add to Debt)
            </Label>
          </div>

          {isLoan && (
            <div className="space-y-1.5">
              <Label htmlFor="income-person">From</Label>
              <Select value={personId} onValueChange={(v) => setPersonId(v ?? "")}>
                <SelectTrigger id="income-person" className="w-full">
                  <SelectValue>
                    {(value: string) => {
                      if (!value) return "Choose who it's from";
                      if (value === NEW_PERSON) return "+ New person…";
                      return people.find((p) => String(p.id) === value)?.name ?? value;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_PERSON}>+ New person…</SelectItem>
                </SelectContent>
              </Select>
              {personId === NEW_PERSON && (
                <Input
                  placeholder="Their name"
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  autoFocus
                />
              )}
            </div>
          )}

          {error && <p className="text-sm text-status-critical">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add income"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
