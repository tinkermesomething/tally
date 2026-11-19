"use client";

import { useState } from "react";
import { Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SplitPartsEditor, emptyPart, resolveSplitParts, type SplitPartDraft } from "@/components/entries/split-parts-editor";
import { categorizeImportedTransactionSplit } from "@/app/review/actions";
import { formatPence } from "@/lib/money";
import { useAppSettings } from "@/components/providers/app-settings-provider";

/** Review's equivalent of SplitExpenseDialog, for a pending transaction
 * instead of an already-logged entry - no tag-loss warning, since a
 * not-yet-categorized transaction has nothing to lose. */
export function SplitTransactionDialog({ transactionId, amountPence, categories }: {
  transactionId: number;
  amountPence: number;
  categories: { id: number; name: string }[];
}) {
  const { currency } = useAppSettings();
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<SplitPartDraft[]>([emptyPart(), emptyPart()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setParts([emptyPart(), emptyPart()]);
    setError(null);
  }

  async function submit() {
    const resolved = resolveSplitParts(parts);
    if (!resolved) return setError("Fill in a category and a positive amount for every part.");
    if (resolved.reduce((s, p) => s + Math.round(p.pounds * 100), 0) !== amountPence) {
      return setError("The parts must add up to the original amount.");
    }
    setPending(true);
    setError(null);
    try {
      await categorizeImportedTransactionSplit(transactionId, resolved);
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't split this transaction.");
    } finally {
      setPending(false);
    }
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
          <Button size="xs" variant="outline" title="Split into multiple categories">
            <Scissors className="size-3 text-chart-5" />
            Split
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Split this transaction</DialogTitle>
          <DialogDescription>Categorize {formatPence(amountPence, currency)} across multiple categories.</DialogDescription>
        </DialogHeader>
        <SplitPartsEditor categories={categories} totalPence={amountPence} parts={parts} onChange={setParts} />
        {error && (
          <p role="alert" className="text-sm text-status-critical">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? "Splitting…" : "Split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
