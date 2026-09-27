"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Undo2, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPence } from "@/lib/money";

export function GridCell({
  amountPence,
  paid,
  spentPence = 0,
  previousAmountPence,
  showPaidToggle = true,
  overdue = false,
  onCommitAmount,
  onClearAmount,
  onTogglePaid,
  onConfirmPayment,
}: {
  amountPence: number | undefined;
  paid: boolean;
  spentPence?: number;
  previousAmountPence?: number;
  showPaidToggle?: boolean;
  overdue?: boolean;
  onCommitAmount: (pounds: number) => void;
  /** Blank is a real, distinct state from "0" - clearing a cell deletes the
   * entry rather than reverting to whatever it was before. */
  onClearAmount?: () => void;
  onTogglePaid?: (paid: boolean) => void;
  /** Called instead of onTogglePaid when checking (not unchecking) the paid
   * box, once the user confirms the actual amount in the popover - the
   * moment it's ticked is also the moment the real figure is known, which
   * may differ from what was allocated. */
  onConfirmPayment?: (pounds: number) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(
    amountPence !== undefined ? (amountPence / 100).toFixed(2) : ""
  );
  const [confirming, setConfirming] = useState(false);
  const [confirmValue, setConfirmValue] = useState("");
  const confirmRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!confirming) return;
    function handlePointerDown(e: PointerEvent) {
      if (confirmRef.current && !confirmRef.current.contains(e.target as Node)) {
        setConfirming(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [confirming]);

  function commit(raw: string) {
    if (raw.trim() === "") {
      if (amountPence === undefined) return; // already blank
      if (onClearAmount) startTransition(() => onClearAmount());
      return;
    }
    const pounds = parseFloat(raw);
    if (Number.isNaN(pounds)) {
      setValue(amountPence !== undefined ? (amountPence / 100).toFixed(2) : "");
      return;
    }
    if (pounds * 100 === amountPence) return;
    startTransition(() => onCommitAmount(pounds));
  }

  function openConfirm() {
    setConfirmValue(amountPence !== undefined ? (amountPence / 100).toFixed(2) : "");
    setConfirming(true);
  }

  function submitConfirm(e: React.FormEvent) {
    e.preventDefault();
    const pounds = parseFloat(confirmValue);
    if (Number.isNaN(pounds) || pounds <= 0) return;
    setConfirming(false);
    startTransition(() => onConfirmPayment?.(pounds));
  }

  return (
    <div className="relative flex flex-col items-end gap-0.5">
      <div className="flex items-center justify-end gap-1.5">
        {overdue && (
          <span title="Overdue">
            <AlertCircle className="size-3.5 shrink-0 text-status-critical" aria-label="Overdue" />
          </span>
        )}
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => commit(value)}
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
            onCheckedChange={(checked) => {
              if (checked === true) {
                if (onConfirmPayment) openConfirm();
                else onTogglePaid && startTransition(() => onTogglePaid(true));
              } else {
                onTogglePaid && startTransition(() => onTogglePaid(false));
              }
            }}
            aria-label={paid ? "Mark unpaid" : "Mark paid"}
            className="shrink-0"
          />
        )}
      </div>
      {confirming && (
        <form
          ref={confirmRef}
          onSubmit={submitConfirm}
          className="absolute top-full right-0 z-20 mt-1 flex items-center gap-1.5 rounded-lg border border-border bg-card p-2 shadow-md"
        >
          <span className="text-xs text-muted-foreground">Paid</span>
          <span className="text-xs text-muted-foreground">£</span>
          <input
            autoFocus
            inputMode="decimal"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setConfirming(false);
            }}
            className="w-16 rounded-md border border-input bg-background px-1.5 py-1 text-right text-sm tabular-nums outline-none"
          />
          <Button type="submit" size="sm">
            Confirm
          </Button>
        </form>
      )}
      {spentPence > 0 && (
        <span className="pr-7 text-xs tabular-nums text-primary">
          Paid {formatPence(spentPence)}
        </span>
      )}
      {amountPence === undefined && previousAmountPence !== undefined && (
        <button
          type="button"
          onClick={() => {
            const text = (previousAmountPence / 100).toFixed(2);
            setValue(text);
            commit(text);
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
