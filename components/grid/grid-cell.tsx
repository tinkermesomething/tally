"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Undo2, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn, budgetValueColorClass } from "@/lib/utils";
import { formatPence, getCurrencySymbol } from "@/lib/money";
import { defaultEntryDateFor } from "@/lib/date";
import { ExpenseEntriesPopover } from "@/components/grid/expense-entries-popover";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import {
  Popover,
  PopoverPortal,
  PopoverPositioner,
  PopoverPopup,
} from "@/components/ui/popover";

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
   * box, once the user confirms the actual amount AND date in the popover -
   * the moment it's ticked is also the moment the real figure is known,
   * which may differ from what was allocated. entryDate drives which
   * year/month the resulting expense actually lands in (see logExpense),
   * so it's never silently hardcoded to today - see defaultEntryDateFor. */
  onConfirmPayment?: (pounds: number, entryDate: string) => void;
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
  const [confirmDate, setConfirmDate] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const checkboxAnchorRef = useRef<HTMLSpanElement>(null);
  const paidButtonAnchorRef = useRef<HTMLButtonElement>(null);

  // `value` starts from amountPence at mount, but a plain useState
  // initializer never re-runs after that - without this, a successful
  // commit left the box showing whatever raw text was typed ("10") forever
  // instead of settling on the canonical "10.00" once the amountPence prop
  // came back around through the server round-trip.
  useEffect(() => {
    setValue(amountPence !== undefined ? (amountPence / 100).toFixed(2) : "");
  }, [amountPence]);

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
    setConfirmDate(year !== undefined && month !== undefined ? defaultEntryDateFor(year, month) : "");
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
    if (!confirmDate) {
      setConfirmError("Pick a date.");
      return;
    }
    setConfirming(false);
    startTransition(() => onConfirmPayment?.(pounds, confirmDate));
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
          <span ref={checkboxAnchorRef} className="inline-flex shrink-0">
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
            />
          </span>
        )}
      </div>
      {/* Portal-based (not a hand-rolled `absolute` div) specifically so this
          never gets clipped by the grid table's own scroll container - an
          absolutely-positioned popup inside an `overflow-x-auto` ancestor is
          cropped to that ancestor's bounds regardless of z-index, which was
          a real bug: the date field (and anything else) could render fully
          off-screen within the clipped region, forcing a scroll to see it. */}
      <Popover open={confirming} onOpenChange={setConfirming}>
        <PopoverPortal>
          <PopoverPositioner anchor={checkboxAnchorRef} align="end" sideOffset={4}>
            <PopoverPopup className="w-auto">
              <form onSubmit={submitConfirm} className="flex flex-col gap-1.5">
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
                <input
                  type="date"
                  value={confirmDate}
                  onChange={(e) => {
                    setConfirmDate(e.target.value);
                    setConfirmError(null);
                  }}
                  className="w-full max-w-full appearance-none rounded-md border border-input bg-background px-1.5 py-1 text-xs tabular-nums outline-none"
                />
                {confirmError && (
                  <span className="text-xs text-status-critical">{confirmError}</span>
                )}
              </form>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
      {spentPence > 0 && (
        canViewEntries ? (
          <button
            ref={paidButtonAnchorRef}
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
          anchorRef={paidButtonAnchorRef}
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
