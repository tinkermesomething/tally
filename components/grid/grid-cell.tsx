"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatPence } from "@/lib/money";

export function GridCell({
  amountPence,
  paid,
  spentPence = 0,
  previousAmountPence,
  showPaidToggle = true,
  onCommitAmount,
  onTogglePaid,
}: {
  amountPence: number | undefined;
  paid: boolean;
  spentPence?: number;
  previousAmountPence?: number;
  showPaidToggle?: boolean;
  onCommitAmount: (pounds: number) => void;
  onTogglePaid?: (paid: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(
    amountPence !== undefined ? (amountPence / 100).toFixed(2) : ""
  );

  function commit(pounds: number) {
    if (Number.isNaN(pounds)) {
      setValue(amountPence !== undefined ? (amountPence / 100).toFixed(2) : "");
      return;
    }
    if (pounds * 100 === amountPence) return;
    startTransition(() => onCommitAmount(pounds));
  }

  const remainingPence =
    spentPence > 0 ? (amountPence ?? 0) - spentPence : null;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center justify-end gap-1.5">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => commit(parseFloat(value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="—"
          className={cn(
            "w-20 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right text-[0.925rem] tabular-nums text-foreground transition-colors",
            "hover:border-input focus:border-input focus:bg-card focus:outline-none",
            paid && amountPence !== undefined && "line-through decoration-muted-foreground/70",
            pending && "opacity-60"
          )}
        />
        {showPaidToggle && (
          <Checkbox
            checked={paid}
            disabled={amountPence === undefined}
            onCheckedChange={(checked) =>
              onTogglePaid && startTransition(() => onTogglePaid(checked === true))
            }
            aria-label={paid ? "Mark unpaid" : "Mark paid"}
            className="shrink-0"
          />
        )}
      </div>
      {remainingPence !== null && (
        <span
          className={cn(
            "pr-7 text-xs tabular-nums",
            remainingPence < 0 ? "text-status-critical" : "text-muted-foreground"
          )}
        >
          {formatPence(remainingPence)} left
        </span>
      )}
      {amountPence === undefined && previousAmountPence !== undefined && (
        <button
          type="button"
          onClick={() => {
            setValue((previousAmountPence / 100).toFixed(2));
            commit(previousAmountPence / 100);
          }}
          className="flex items-center gap-1 pr-7 text-xs text-muted-foreground hover:text-foreground"
          title="Use last month's amount"
        >
          <Undo2 className="size-3" />
          {formatPence(previousAmountPence)}
        </button>
      )}
    </div>
  );
}
