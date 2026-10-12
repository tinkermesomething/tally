"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { addAssetValuation } from "@/app/net-worth/actions";
import { parsePounds } from "@/lib/money-input";

const today = () => new Date().toLocaleDateString("en-CA");

/** Appends a new valuation - never edits the old one, same append-only
 * reasoning as a debt/savings ledger entry. */
export function UpdateValueDialog({ assetId, assetName }: { assetId: number; assetName: string }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setAmount("");
    setDate(today());
    setError(null);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const pounds = parsePounds(amount);
    if (pounds === null || pounds < 0) return setError("Enter a value, e.g. 25 or 25.50.");
    setError(null);
    startTransition(async () => {
      try {
        await addAssetValuation(assetId, { entryDate: date, pounds });
        reset();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save that.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); reset(); }}>
      <DialogTrigger render={<Button size="icon-xs" variant="ghost" title={`Update ${assetName}'s value`}><RefreshCw className="size-3.5" /></Button>} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Update {assetName}&apos;s value</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="valuation-amount">New value (£)</Label>
            <Input id="valuation-amount" autoFocus inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="valuation-date">As of</Label>
            <Input id="valuation-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {error && <p className="text-sm text-status-critical">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
