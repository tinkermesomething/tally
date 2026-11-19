"use client";

import { useState } from "react";
import { Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SplitPartsEditor, emptyPart, resolveSplitParts, type SplitPartDraft } from "@/components/entries/split-parts-editor";
import { splitExpenseEntry } from "@/app/grid/actions";
import { formatPence } from "@/lib/money";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import type { EntryRow, ExpenseEntryRow } from "@/lib/db/queries";

/** Lets one logged expense be redistributed into several categories - e.g.
 * one Amazon order = pets + household. Lives on the Entries tab (and the
 * Review tab has its own equivalent for a not-yet-categorized transaction,
 * which never has a tag to lose - see categorizeTransactionSplit). */
export function SplitExpenseDialog({
  entry,
  categories,
  onSplit,
}: {
  entry: Pick<EntryRow, "id" | "amountPence" | "debtPersonId" | "debtPersonName" | "savingsBucketId" | "savingsBucketName" | "sharedToHousehold">;
  categories: { id: number; name: string }[];
  onSplit: (created: ExpenseEntryRow[]) => void;
}) {
  const { currency } = useAppSettings();
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<SplitPartDraft[]>([emptyPart(), emptyPart()]);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const totalPence = Math.abs(entry.amountPence);
  const tagged = entry.debtPersonId !== null || entry.savingsBucketId !== null || entry.sharedToHousehold;
  const tagDescription = [
    entry.debtPersonName ? `a debt repayment to ${entry.debtPersonName}` : null,
    entry.savingsBucketName ? `a savings deposit to ${entry.savingsBucketName}` : null,
    entry.sharedToHousehold ? "shared to the household tab" : null,
  ]
    .filter(Boolean)
    .join(", ");

  function reset() {
    setParts([emptyPart(), emptyPart()]);
    setAck(false);
    setError(null);
  }

  async function submit() {
    const resolved = resolveSplitParts(parts);
    if (!resolved) return setError("Fill in a category and a positive amount for every part.");
    if (resolved.reduce((s, p) => s + Math.round(p.pounds * 100), 0) !== totalPence) {
      return setError("The parts must add up to the original amount.");
    }
    if (tagged && !ack) return setError("Confirm you understand the tag will be dropped.");
    setPending(true);
    setError(null);
    try {
      const created = await splitExpenseEntry(entry.id, resolved, tagged);
      onSplit(created);
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't split this entry.");
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
          <Button size="icon-xs" variant="ghost" title="Split into multiple categories">
            <Scissors className="size-3.5" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Split this entry</DialogTitle>
          <DialogDescription>Redistribute {formatPence(totalPence, currency)} across multiple categories.</DialogDescription>
        </DialogHeader>
        {tagged && (
          <div className="rounded-lg border border-status-critical/40 bg-status-critical/5 p-2 text-sm">
            This entry counts towards {tagDescription}. Splitting it removes that tag - there&apos;s no single piece to hand it to.
            <div className="mt-1.5 flex items-center gap-2">
              <Checkbox checked={ack} onCheckedChange={(c) => setAck(c === true)} aria-label="Confirm removing the tag" />
              <span className="text-xs">I understand, remove the tag and split</span>
            </div>
          </div>
        )}
        <SplitPartsEditor categories={categories} totalPence={totalPence} parts={parts} onChange={setParts} />
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
