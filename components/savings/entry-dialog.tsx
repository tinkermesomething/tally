"use client";

import { useState, useTransition } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { addEntry } from "@/app/savings/actions";
import { runAction } from "@/lib/action-result";
import { parsePounds } from "@/lib/money-input";

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the user's own timezone

/** Put money in, or take it out. Taking money out only changes the bucket -
 * the monthly budget is untouched, since the money was counted when it went in. */
export function EntryDialog({
  bucketId,
  bucketName,
  direction,
}: {
  bucketId: number;
  bucketName: string;
  direction: "deposit" | "withdrawal";
}) {
  const deposit = direction === "deposit";
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setAmount("");
    setDate(today());
    setNote("");
    setError(null);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const pounds = parsePounds(amount);
    if (pounds === null || pounds <= 0) return setError("Enter an amount, e.g. 25 or 25.50.");
    if (!date) return setError("Pick a date.");
    setError(null);
    startTransition(async () => {
      const failure = await runAction(() => addEntry({ bucketId, pounds, entryDate: date, direction, note }));
      if (failure) return setError(failure);
      reset();
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            {deposit ? <ArrowDownToLine className="size-4 text-status-good" /> : <ArrowUpFromLine className="size-4 text-chart-2" />}
            {deposit ? "Deposit" : "Withdraw"}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {deposit ? "Pay into" : "Take out of"} {bucketName}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`entry-amount-${direction}`}>Amount (£)</Label>
            <Input id={`entry-amount-${direction}`} autoFocus inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`entry-date-${direction}`}>Date</Label>
            <Input id={`entry-date-${direction}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`entry-note-${direction}`}>Note (optional)</Label>
            <Input id={`entry-note-${direction}`} placeholder={deposit ? "e.g. birthday money" : "e.g. flights"} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {!deposit && <p className="text-xs text-muted-foreground">This only lowers the bucket. Your monthly budget is not changed.</p>}
          {error && <p className="text-sm text-status-critical">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : deposit ? "Deposit" : "Withdraw"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
