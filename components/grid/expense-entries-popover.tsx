"use client";

import { parsePounds } from "@/lib/money-input";
import { useEffect, useState, useTransition, type RefObject } from "react";
import { Trash2 } from "lucide-react";
import { editExpenseEntry, listExpenseEntries, removeExpenseEntry } from "@/app/grid/actions";
import { formatDate } from "@/lib/date-format";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { Popover, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";
import type { ExpenseEntryRow } from "@/lib/db/queries";

/** The breakdown behind a grid cell's "Paid £X" total - individually
 * editable/deletable, since that total can be the sum of several logged
 * expenses, not always just one. Portal-based (not a hand-rolled `absolute`
 * div) so it never gets clipped by the grid table's own scroll container -
 * see the matching comment on GridCell's confirm-payment popup for why. */
export function ExpenseEntriesPopover({
  anchorRef,
  categoryId,
  year,
  month,
  onClose,
  onChanged,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  categoryId: number;
  year: number;
  month: number;
  onClose: () => void;
  /** Every edit/delete already calls revalidatePath("/grid"), which
   * refreshes the parent cell's own props (spentPence, paid) automatically -
   * this is only for a caller that needs an extra hook, e.g. the Logged
   * Entries page re-fetching its own separate list. */
  onChanged?: () => void;
}) {
  const { dateFormat } = useAppSettings();
  const [entries, setEntries] = useState<ExpenseEntryRow[] | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    listExpenseEntries(categoryId, year, month).then(setEntries);
  }, [categoryId, year, month]);

  function refresh() {
    listExpenseEntries(categoryId, year, month).then(setEntries);
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
      await editExpenseEntry(id, { pounds });
      refresh();
    });
    return pounds.toFixed(2);
  }

  function commitNote(id: number, note: string) {
    startTransition(async () => {
      await editExpenseEntry(id, { note });
      refresh();
    });
  }

  function remove(id: number) {
    startTransition(async () => {
      await removeExpenseEntry(id);
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
              <p className="px-1 py-2 text-xs text-muted-foreground">Nothing logged this month.</p>
            )}
            <div className="space-y-1.5">
              {entries?.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-1.5 row-card rounded-md p-1.5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[0.7rem] text-muted-foreground">{formatDate(entry.entryDate, dateFormat)}</span>
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
