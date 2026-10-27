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
import { pencilInPendingIncome } from "@/app/review/actions";

export type PendingIncomeRuleMatch = { incomeSourceId: number; incomeSourceName: string; debtPersonId?: number };

/** Money-in's exact mirror of PencilInButton - lets a pending-at-the-bank
 * credit be logged as real income ahead of it settling, so "left to
 * spend" reflects money the bank's already earmarked instead of waiting
 * on it to actually clear. */
export function PencilInIncomeButton({
  amountPence,
  date,
  payeeRaw,
  incomeSources,
  ruleMatch,
}: {
  amountPence: number;
  date: string | null;
  payeeRaw: string;
  incomeSources: { id: number; name: string }[];
  ruleMatch?: PendingIncomeRuleMatch | null;
}) {
  const [open, setOpen] = useState(false);
  const [incomeSourceId, setIncomeSourceId] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  if (done) {
    return <span className="text-xs text-muted-foreground">Pencilled in</span>;
  }

  function pencilIn(incomeSourceId: number, debtPersonId?: number) {
    startTransition(async () => {
      await pencilInPendingIncome({
        incomeSourceId,
        amountPence: Math.abs(amountPence),
        entryDate: date,
        note: payeeRaw,
        debtPersonId,
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
          title={`A rule already files this under ${ruleMatch.incomeSourceName} - pencil it in the same way`}
          onClick={() => pencilIn(ruleMatch.incomeSourceId, ruleMatch.debtPersonId)}
        >
          <Check className="size-3 text-status-good" />
          Pencil in as {ruleMatch.incomeSourceName}
        </Button>
      )}
      <Button
        ref={anchorRef}
        size="icon-xs"
        variant="ghost"
        title={ruleMatch ? "Pencil in as something else" : "Pencil in as income"}
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
                <Select value={incomeSourceId} onValueChange={(v) => setIncomeSourceId(v ?? "")}>
                  <SelectTrigger className="w-full">
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
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => incomeSourceId && pencilIn(parseInt(incomeSourceId, 10))}
                  disabled={pending || !incomeSourceId}
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
