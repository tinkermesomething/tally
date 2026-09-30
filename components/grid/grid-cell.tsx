"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Undo2, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn, budgetValueColorClass } from "@/lib/utils";
import { formatPence, getCurrencySymbol } from "@/lib/money";
import { ExpenseEntriesPopover } from "@/components/grid/expense-entries-popover";
import { useAppSettings } from "@/components/providers/app-settings-provider";

export function GridCell({
  amountPence,
  paid,
  spentPence = 0,
  previousAmountPence,
  showPaidToggle = true,
  overdue = false,
  categoryId,
  year,
  month,
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
  /** Set on leaf category cells only (not income, not computed rollup
   * cells) - lets "Paid £X" open the individual logged-entries breakdown.
   * Omitting any of the three just hides that affordance. */
  categoryId?: number;
  year?: number;
  month?: number;
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
  const { currency } = useAppSettings();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(
    amountPence !== undefined ? (amountPence / 100).toFixed(2) : ""
  );
  const [confirming, setConfirming] = useState(false);
  const [viewingEntries, setViewingEntries] = useState(false);
  const canViewEntries = categoryId !== undefined && year !== undefined && month !== undefined;
  const [confirmValue, setConfirmValue] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLFormElement>(null);

  // `value` starts from amountPence at mount, but a plain useState
  // initializer never re-runs after that - without this, a successful
  // commit left the box showing whatever raw text was typed ("10") forever
  // instead of settling on the canonical "10.00" once the amountPence prop
  // came back around through the server round-trip.
  useEffect(() => {
    setValue(amountPence !== undefined ? (amountPence / 100).toFixed(2) : "");
  }, [amountPence]);

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
    setConfirmError(null);
    setConfirming(true);
  }

  function submitConfirm(e: React.FormEvent) {
    e.preventDefault();
    const pounds = parseFloat(confirmValue);
    if (Number.isNaN(pounds) || pounds <= 0) {
      setConfirmError(`Enter an amount greater than ${getCurrencySymbol(currency)}0`);
      return;
    }
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
            "w-20 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right text-[0.925rem] tabular-nums transition-colors",
            budgetValueColorClass(amountPence, spentPence),
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
                else if (onTogglePaid) startTransition(() => onTogglePaid(true));
              } else if (onTogglePaid) {
                startTransition(() => onTogglePaid(false));
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
          className="absolute top-full right-0 z-20 mt-1 flex flex-col gap-1 rounded-lg border border-border bg-card p-2 shadow-md"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Paid</span>
            <span className="text-xs text-muted-foreground">{getCurrencySymbol(currency)}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={confirmValue}
              onChange={(e) => {
                setConfirmValue(e.target.value);
                setConfirmError(null);
              }}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Escape") setConfirming(false);
              }}
              className="w-16 rounded-md border border-input bg-background px-1.5 py-1 text-right text-sm tabular-nums outline-none"
            />
            <Button type="submit" size="sm">
              Confirm
            </Button>
          </div>
          {confirmError && (
            <span className="text-xs text-status-critical">{confirmError}</span>
          )}
        </form>
      )}
      {spentPence > 0 && (
        canViewEntries ? (
          <button
            type="button"
            onClick={() => setViewingEntries((v) => !v)}
            className="pr-7 text-xs tabular-nums text-primary underline-offset-2 hover:underline"
            title="View logged entries"
          >
            Paid {formatPence(spentPence, currency)}
          </button>
        ) : (
          <span className="pr-7 text-xs tabular-nums text-primary">
            Paid {formatPence(spentPence, currency)}
          </span>
        )
      )}
      {viewingEntries && canViewEntries && (
        <ExpenseEntriesPopover
          categoryId={categoryId!}
          year={year!}
          month={month!}
          onClose={() => setViewingEntries(false)}
        />
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
          {formatPence(previousAmountPence, currency)}
        </button>
      )}
    </div>
  );
}
