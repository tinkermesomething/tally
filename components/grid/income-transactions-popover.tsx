"use client";

import { parsePounds } from "@/lib/money-input";
import { useEffect, useState, useTransition, type RefObject } from "react";
import { Trash2 } from "lucide-react";
import { editIncomeTransaction, listIncomeTransactions, removeIncomeTransaction } from "@/app/grid/actions";
import { formatDate } from "@/lib/date-format";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { Popover, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";
import type { IncomeTransactionRow } from "@/lib/db/queries";

/** The breakdown behind a grid cell's "Received £X" total - individually
 * editable/deletable, mirrors ExpenseEntriesPopover exactly (same portal
 * reasoning - never clipped by the grid's own scroll container), minus the
 * tags control: income has no retro-tags system to show here. */
export function IncomeTransactionsPopover({
  anchorRef,
  incomeSourceId,
  year,
  month,
  onClose,
  onChanged,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  incomeSourceId: number;
  year: number;
  month: number;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { dateFormat } = useAppSettings();
  const [entries, setEntries] = useState<IncomeTransactionRow[] | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    listIncomeTransactions(incomeSourceId, year, month).then(setEntries);
  }, [incomeSourceId, year, month]);

  function refresh() {
    listIncomeTransactions(incomeSourceId, year, month).then(setEntries);
    onChanged?.();
  }

  /** Returns the canonical "10.00"-formatted value to redisplay on a valid
   * edit, or null on invalid input (meaning: revert instead). The input is
   * uncontrolled, so without this it would keep showing whatever raw text
   * was typed forever instead of settling on the formatted amount. */
  function commitAmount(id: number, raw: string): string | null {
    const pounds = (parsePounds(raw) ?? NaN);
    if (Number.isNaN(pounds) || pounds <= 0) return null;
    startTransition(async () => {
      await editIncomeTransaction(id, { pounds });
      refresh();
    });
    return pounds.toFixed(2);
  }

  function commitNote(id: number, note: string) {
    startTransition(async () => {
      await editIncomeTransaction(id, { note });
      refresh();
    });
  }

  function remove(id: number) {
    startTransition(async () => {
      await removeIncomeTransaction(id);
      refresh();
    });
  }

  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose(); }}>
      <PopoverPortal>
        <PopoverPositioner anchor={anchorRef} align="end" sideOffset={4}>
          <PopoverPopup>
            <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">Logged entries</p>
            {entries === null && <p className="px-1 py-2 text-xs text-muted-foreground">Loading…</p>}
            {entries?.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">Nothing received this month.</p>
            )}
            <div className="space-y-1.5">
              {entries?.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-1.5 row-card rounded-md p-1.5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[0.7rem] text-muted-foreground">
                        {formatDate(entry.entryDate, dateFormat)}
                        {entry.provisional && " · pencilled in"}
                      </span>
                      <input
                        defaultValue={(entry.amountPence / 100).toFixed(2)}
                        inputMode="decimal"
                        onBlur={(e) => {
                          e.target.value = commitAmount(entry.id, e.target.value) ?? (entry.amountPence / 100).toFixed(2);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        className="w-16 rounded border border-transparent bg-transparent px-1 text-right text-xs tabular-nums hover:border-input focus:border-input focus:bg-background focus:outline-none"
                      />
                    </div>
                    <input
                      defaultValue={entry.note ?? ""}
                      placeholder="Add a note…"
                      onBlur={(e) => commitNote(entry.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      className="w-full rounded border border-transparent bg-transparent px-1 text-xs text-muted-foreground hover:border-input focus:border-input focus:bg-background focus:text-foreground focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(entry.id)}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-status-critical/10 hover:text-status-critical"
                    title="Delete this entry"
                  >
                    <Trash2 className="size-3.5 text-status-critical" />
                  </button>
                </div>
              ))}
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}
