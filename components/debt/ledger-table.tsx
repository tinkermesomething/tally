"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { editLedgerEntry, removeLedgerEntry } from "@/app/debt/actions";
import { formatPence } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { LedgerRow } from "@/lib/db/debt";

/** Unlike the expense-entries table, this doesn't optimistically patch local
 * state - runningBalancePence depends on every row's amount/direction
 * together, so a local guess would flash a wrong number before the server's
 * real recomputed chain arrives. It just re-renders from the fresh `entries`
 * prop once each edit's revalidatePath completes. */
export function LedgerTable({ personId, entries }: { personId: number; entries: LedgerRow[] }) {
  const [, startTransition] = useTransition();

  /** Returns whether the edit was accepted, so the input can be snapped back
   * to its last known-good value on invalid input instead of silently
   * keeping whatever bad text the user typed. */
  function commitAmount(id: number, raw: string): boolean {
    const pounds = parseFloat(raw);
    if (Number.isNaN(pounds) || pounds <= 0) return false;
    startTransition(() => editLedgerEntry(personId, id, { pounds }));
    return true;
  }

  function commitDirection(id: number, direction: "loan" | "repayment") {
    startTransition(() => editLedgerEntry(personId, id, { direction }));
  }

  function commitDate(id: number, entryDate: string): boolean {
    if (!entryDate) return false;
    startTransition(() => editLedgerEntry(personId, id, { entryDate }));
    return true;
  }

  function commitNote(id: number, note: string) {
    startTransition(() => editLedgerEntry(personId, id, { note }));
  }

  function remove(id: number) {
    startTransition(() => removeLedgerEntry(personId, id));
  }

  const newestFirst = [...entries].reverse();

  if (newestFirst.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <p className="px-3 py-8 text-center text-muted-foreground">No entries yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted text-left">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Note</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-right font-medium">Balance</th>
            <th className="w-8 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {newestFirst.map((entry) => (
            <tr key={entry.id} className="border-t border-border">
              <td className="px-3 py-2">
                <input
                  type="date"
                  defaultValue={entry.entryDate}
                  onBlur={(e) => {
                    if (!commitDate(entry.id, e.target.value)) {
                      e.target.value = entry.entryDate;
                    }
                  }}
                  className="rounded-md border border-transparent bg-transparent px-1 py-0.5 hover:border-input focus:border-input focus:bg-background focus:outline-none"
                />
              </td>
              <td className="px-3 py-2">
                <select
                  defaultValue={entry.direction}
                  onChange={(e) => commitDirection(entry.id, e.target.value as "loan" | "repayment")}
                  className="rounded-md border border-transparent bg-transparent px-1 py-0.5 hover:border-input focus:border-input focus:bg-background focus:outline-none"
                >
                  <option value="loan">Borrowed</option>
                  <option value="repayment">Paid back</option>
                </select>
              </td>
              <td className="px-3 py-2">
                <input
                  defaultValue={entry.note ?? ""}
                  placeholder="Add a note…"
                  onBlur={(e) => commitNote(entry.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-muted-foreground hover:border-input focus:border-input focus:bg-background focus:text-foreground focus:outline-none"
                />
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <span
                    className={cn(
                      entry.direction === "loan" ? "text-status-critical" : "text-status-good"
                    )}
                  >
                    {entry.direction === "loan" ? "+" : "−"}
                  </span>
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
                    className="w-20 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-right tabular-nums hover:border-input focus:border-input focus:bg-background focus:outline-none"
                  />
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPence(entry.runningBalancePence)}
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
      </table>
    </div>
  );
}
