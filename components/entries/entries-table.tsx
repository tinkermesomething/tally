"use client";

import { parsePounds } from "@/lib/money-input";
import { useMemo, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { editExpenseEntry, removeExpenseEntry } from "@/app/grid/actions";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import type { ExpenseEntryRow } from "@/lib/db/queries";
import { amountText, fuzzyScore } from "@/lib/fuzzy";

export function EntriesTable({ entries }: { entries: ExpenseEntryRow[] }) {
  const { currency, dateFormat } = useAppSettings();
  const [rows, setRows] = useState(entries);
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");

  // Best matches first while searching; original order when not. Only this
  // period's loaded entries are searched.
  const shown = useMemo(() => {
    if (query.trim() === "") return rows;
    return rows
      .map((r, i) => ({ r, i, s: fuzzyScore(query, [r.categoryName, r.note, amountText(r.amountPence), r.entryDate]) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.r);
  }, [rows, query]);

  /** Returns the canonical "10.00"-formatted value to redisplay on a valid
   * edit, or null on invalid input - the input is uncontrolled (defaultValue
   * only applies once, at mount), so without this the box would keep
   * showing whatever raw text was typed ("10") forever instead of settling
   * on the formatted amount. Null tells the caller to revert instead. */
  function commitAmount(id: number, raw: string): string | null {
    const pounds = (parsePounds(raw) ?? NaN);
    if (Number.isNaN(pounds) || pounds <= 0) return null;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, amountPence: Math.round(pounds * 100) } : r)));
    startTransition(async () => {
      await editExpenseEntry(id, { pounds });
    });
    return pounds.toFixed(2);
  }

  function commitNote(id: number, note: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, note: note || null } : r)));
    startTransition(async () => {
      await editExpenseEntry(id, { note });
    });
  }

  function remove(id: number) {
    setRows((rs) => rs.filter((r) => r.id !== id));
    startTransition(async () => {
      await removeExpenseEntry(id);
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No expenses logged for this period.
      </p>
    );
  }

  return (
    <div className="space-y-2">
    <div className="flex items-center gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search category, note, amount…"
        aria-label="Search entries"
        className="h-8 w-64 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
      />
      {query.trim() !== "" && (
        <span className="text-xs text-muted-foreground" data-testid="entries-filter-count">
          Showing {shown.length} of {rows.length}
        </span>
      )}
    </div>
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted text-left">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Note</th>
            <th className="w-8 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                No entries match.
              </td>
            </tr>
          )}
          {shown.map((entry) => (
            <tr key={entry.id} className={`border-t border-border ${entry.provisional ? "bg-muted/40" : ""}`}>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDate(entry.entryDate, dateFormat)}</td>
              <td className="px-3 py-2 font-medium">
                {entry.categoryName}
                {entry.provisional && (
                  <span
                    className="ml-1.5 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[0.65rem] font-normal text-muted-foreground"
                    title="Pencilled in from a pending bank transaction - not yet confirmed"
                  >
                    pencilled in
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <input
                  defaultValue={(entry.amountPence / 100).toFixed(2)}
                  inputMode="decimal"
                  onBlur={(e) => {
                    e.target.value = commitAmount(entry.id, e.target.value) ?? (entry.amountPence / 100).toFixed(2);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="w-20 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-right tabular-nums hover:border-input focus:border-input focus:bg-background focus:outline-none"
                  aria-label={`Amount for ${entry.categoryName} on ${entry.entryDate}`}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  defaultValue={entry.note ?? ""}
                  placeholder="Add a note…"
                  onBlur={(e) => commitNote(entry.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-muted-foreground hover:border-input focus:border-input focus:bg-background focus:text-foreground focus:outline-none"
                  aria-label={`Note for ${entry.categoryName} on ${entry.entryDate}`}
                />
              </td>
              <td className="px-2 py-2 text-right">
                <button
                  type="button"
                  onClick={() => remove(entry.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-status-critical/10 hover:text-status-critical"
                  title="Delete this entry"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-secondary font-medium">
            <td className="px-3 py-2" colSpan={2}>
              Total{shown.length !== rows.length ? ` (${shown.length} of ${rows.length} shown)` : ""}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatPence(shown.reduce((sum, r) => sum + r.amountPence, 0), currency)}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
    </div>
  );
}
