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
import { NEW_PERSON, PersonPickerField, usePersonSelection } from "@/components/grid/person-picker";
import { parseIsoDate } from "@/lib/date";
import { MONTH_NAMES } from "@/lib/months";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** A rough starting guess for which budget month a pay-anchor entry counts
 * toward - paid in the last third of the month, guess it's for next month
 * (matches the common "paid on the last working day" case); always
 * overridable, never auto-applied silently once the user's touched it. */
function guessPeriod(dateStr: string): { year: number; month: number } {
  const { year, month } = parseIsoDate(dateStr);
  const day = Number(dateStr.slice(8, 10));
  if (day >= 20) {
    return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  }
  return { year, month };
}

/** Logs a real income transaction - money someone lent you (linked to the
 * debt ledger as a loan), a gift, or wages, all the same form. The loan
 * link is opt-in and off by default, since most income isn't debt. */
export function AddIncomeDialog({
  incomeSources,
  people,
}: {
  incomeSources: { id: number; name: string; isPayAnchor: boolean }[];
  people: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [isLoan, setIsLoan] = useState(false);
  const [period, setPeriod] = useState(() => guessPeriod(todayIso()));
  const [periodTouched, setPeriodTouched] = useState(false);
  const { personId, setPersonId, newPersonName, setNewPersonName, reset: resetPerson, resolvePersonId } =
    usePersonSelection();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedSource = incomeSources.find((s) => String(s.id) === sourceId);

  function reset() {
    setSourceId("");
    setAmount("");
    setDate(todayIso());
    setIsLoan(false);
    setPeriod(guessPeriod(todayIso()));
    setPeriodTouched(false);
    resetPerson();
    setError(null);
  }

  function handleDateChange(nextDate: string) {
    setDate(nextDate);
    if (!periodTouched) setPeriod(guessPeriod(nextDate));
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
      const debtPersonId = isLoan ? await resolvePersonId() : undefined;
      await logIncome({
        incomeSourceId: parseInt(sourceId, 10),
        pounds,
        entryDate: date,
        periodYear: selectedSource?.isPayAnchor ? period.year : undefined,
        periodMonth: selectedSource?.isPayAnchor ? period.month : undefined,
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

          {/* Stacked, not side-by-side - a native <input type="date"> has an
              intrinsic min-content width browsers won't shrink below, which
              overflows this dialog's fixed ~24rem max-width on every screen
              size, not just narrow ones (iOS Safari also enforces
              box-sizing:content-box on it specifically, hence appearance-none
              below too). */}
          <div className="space-y-3">
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
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full max-w-full appearance-none"
              />
            </div>
          </div>

          {selectedSource?.isPayAnchor && (
            <div className="space-y-1.5 rounded-lg border border-border bg-secondary/50 p-3">
              <Label>Counts toward</Label>
              <p className="text-xs text-muted-foreground">
                {selectedSource.name} is your pay anchor - pick which budget month this
                payment (and anything logged from {date || "this date"} onward) counts toward.
              </p>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <Select
                  value={String(period.month)}
                  onValueChange={(v) => {
                    setPeriodTouched(true);
                    setPeriod((p) => ({ ...p, month: v ? parseInt(v, 10) : p.month }));
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: string) => MONTH_NAMES[parseInt(value, 10) - 1]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((m, i) => (
                      <SelectItem key={m} value={String(i + 1)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(period.year)}
                  onValueChange={(v) => {
                    setPeriodTouched(true);
                    setPeriod((p) => ({ ...p, year: v ? parseInt(v, 10) : p.year }));
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: string) => value}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {[period.year - 1, period.year, period.year + 1]
                      .filter((y, i, arr) => arr.indexOf(y) === i)
                      .sort((a, b) => a - b)
                      .map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

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
            <PersonPickerField
              idPrefix="income"
              label="From"
              placeholder="Choose who it's from"
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
              {pending ? "Saving…" : "Add income"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
