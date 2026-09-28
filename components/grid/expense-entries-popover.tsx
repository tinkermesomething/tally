"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { editExpenseEntry, listExpenseEntries, removeExpenseEntry } from "@/app/grid/actions";
import type { ExpenseEntryRow } from "@/lib/db/queries";

/** The breakdown behind a grid cell's "Paid £X" total - individually
 * editable/deletable, since that total can be the sum of several logged
 * expenses, not always just one. */
export function ExpenseEntriesPopover({
  categoryId,
  year,
  month,
  onClose,
  onChanged,
}: {
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
  const [entries, setEntries] = useState<ExpenseEntryRow[] | null>(null);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listExpenseEntries(categoryId, year, month).then(setEntries);
  }, [categoryId, year, month]);

  useEffect(() => {
    // "click" (not "pointerdown"/"mousedown") - those fire before the
    // browser blurs whatever's currently focused, so closing on them raced
    // an in-progress edit's blur-triggered save right out from under it.
    // By the time "click" fires, blur has already happened and committed.
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onClose]);

  function refresh() {
    listExpenseEntries(categoryId, year, month).then(setEntries);
    onChanged?.();
  }

  /** Returns whether the edit was accepted, so the input can be snapped back
   * to its last known-good value on invalid input instead of silently
   * keeping whatever bad text the user typed. */
  function commitAmount(id: number, raw: string): boolean {
    const pounds = parseFloat(raw);
    if (Number.isNaN(pounds) || pounds <= 0) return false;
    startTransition(async () => {
      await editExpenseEntry(id, { pounds });
      refresh();
    });
    return true;
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
    <div
      ref={ref}
      className="absolute top-full right-0 z-30 mt-1 w-72 rounded-lg border border-border bg-card p-2 shadow-md"
    >
      <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">Logged entries</p>
      {entries === null && <p className="px-1 py-2 text-xs text-muted-foreground">Loading…</p>}
      {entries?.length === 0 && (
        <p className="px-1 py-2 text-xs text-muted-foreground">Nothing logged this month.</p>
      )}
      <div className="space-y-1.5">
        {entries?.map((entry) => (
          <div
            key={entry.id}
            className="flex items-start gap-1.5 rounded-md border border-border/60 p-1.5"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[0.7rem] text-muted-foreground">{entry.entryDate}</span>
                <input
                  defaultValue={(entry.amountPence / 100).toFixed(2)}
                  inputMode="decimal"
                  onBlur={(e) => {
                    if (!commitAmount(entry.id, e.target.value)) {
                      e.target.value = (entry.amountPence / 100).toFixed(2);
                    }
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
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
