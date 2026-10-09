"use client";

import { useState, useTransition, useRef } from "react";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";
import { pencilInPendingExpense } from "@/app/review/actions";

export type PendingRuleMatch = { categoryId: number; categoryName: string; debtPersonId?: number; savingsBucketId?: number };

/** Lets the user log a pending-at-the-bank transaction as an expense ahead
 * of it settling, so "left to spend" reflects money the bank's already
 * earmarked. Expense-only - see PencilInButton's caller, which only
 * renders this for money-out preview rows.
 *
 * `ruleMatch`, when given, is what an existing auto-categorization rule
 * would do with this row once it settles (see getPendingPreview) - a one-
 * click "Pencil in as X" button uses it straight away, so a rule already
 * means something here too, not just for rows that have already synced in.
 * The picker is still there to pencil in as something else instead. */
export function PencilInButton({
  amountPence,
  date,
  payeeRaw,
  categories,
  ruleMatch,
}: {
  amountPence: number;
  date: string | null;
  payeeRaw: string;
  categories: { id: number; name: string }[];
  ruleMatch?: PendingRuleMatch | null;
}) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  if (done) {
    return <span className="text-xs text-muted-foreground">Pencilled in</span>;
  }

  function pencilIn(categoryId: number, tags?: { debtPersonId?: number; bucketId?: number }) {
    startTransition(async () => {
      await pencilInPendingExpense({
        categoryId,
        amountPence: Math.abs(amountPence),
        entryDate: date,
        note: payeeRaw,
        debtPersonId: tags?.debtPersonId,
        bucketId: tags?.bucketId,
      });
      setDone(true);
      setOpen(false);
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      {ruleMatch && (
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          title={`A rule already files this under ${ruleMatch.categoryName} - pencil it in the same way`}
          onClick={() => pencilIn(ruleMatch.categoryId, { debtPersonId: ruleMatch.debtPersonId, bucketId: ruleMatch.savingsBucketId })}
        >
          <Check className="size-3 text-status-good" />
          Pencil in as {ruleMatch.categoryName}
        </Button>
      )}
      <Button
        ref={anchorRef}
        size="icon-xs"
        variant="ghost"
        title={ruleMatch ? "Pencil in as something else" : "Pencil in as an expense"}
        onClick={() => setOpen((v) => !v)}
      >
        <Pencil className="size-3.5" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverPortal>
          <PopoverPositioner anchor={anchorRef} align="end" sideOffset={4}>
            <PopoverPopup>
              <div className="w-56 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Logs this now, before it settles. You&apos;ll get Confirm/Discard once the real transaction syncs in.
                </p>
                <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                  <SelectTrigger className="w-full">
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
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => categoryId && pencilIn(parseInt(categoryId, 10))}
                  disabled={pending || !categoryId}
                >
                  Pencil in
                </Button>
              </div>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </span>
  );
}
