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
import { logExpense } from "@/app/grid/actions";
import { NEW_PERSON, PersonPickerField, usePersonSelection } from "@/components/grid/person-picker";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function LogExpenseDialog({
  categories,
  people,
}: {
  categories: { id: number; name: string }[];
  people: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [isRepayment, setIsRepayment] = useState(false);
  const { personId, setPersonId, newPersonName, setNewPersonName, reset: resetPerson, resolvePersonId } =
    usePersonSelection();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setCategoryId("");
    setAmount("");
    setDate(todayIso());
    setNote("");
    setIsRepayment(false);
    resetPerson();
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pounds = parseFloat(amount);
    if (!categoryId) {
      setError("Pick a category.");
      return;
    }
    if (Number.isNaN(pounds) || pounds <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (isRepayment && !personId) {
      setError("Pick who you're paying back, or add a new person.");
      return;
    }
    if (isRepayment && personId === NEW_PERSON && !newPersonName.trim()) {
      setError("Enter the new person's name.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const debtPersonId = isRepayment ? await resolvePersonId() : undefined;
      await logExpense({
        categoryId: parseInt(categoryId, 10),
        pounds,
        entryDate: date,
        note: note.trim() || undefined,
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
            Log expense
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log an expense</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="expense-category">Category</Label>
            <Select
              value={categoryId}
              onValueChange={(value) => setCategoryId(value ?? "")}
            >
              <SelectTrigger id="expense-category" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    value ? (categories.find((c) => String(c.id) === value)?.name ?? value) : "Choose a category"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="expense-amount">Amount</Label>
              <Input
                id="expense-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expense-note">Note (optional)</Label>
            <Input
              id="expense-note"
              placeholder="e.g. weekly shop"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="expense-is-repayment"
              checked={isRepayment}
              onCheckedChange={(checked) => setIsRepayment(checked === true)}
            />
            <Label htmlFor="expense-is-repayment" className="font-normal">
              This is paying someone back (add to Debt)
            </Label>
          </div>

          {isRepayment && (
            <PersonPickerField
              idPrefix="expense"
              label="Paying back"
              placeholder="Choose who you're paying back"
              people={people}
              personId={personId}
              onPersonIdChange={setPersonId}
              newPersonName={newPersonName}
              onNewPersonNameChange={setNewPersonName}
            />
          )}

          {error && <p className="text-sm text-status-critical">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Log expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
