"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { editEntry, removeEntry } from "@/app/savings/actions";
import { formatPence } from "@/lib/money";
import { parsePounds } from "@/lib/money-input";
import { runAction } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { FIELD_COLOR } from "@/lib/field-colors";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import type { SavingsLedgerRow } from "@/lib/db/savings";

/** Every entry is editable in place. Like the Debt ledger, it re-renders from
 * the server after each edit instead of guessing, because every running
 * balance depends on all the rows above it. */
export function SavingsLedgerTable({
  bucketId,
  openingPence,
  entries,
}: {
  bucketId: number;
  openingPence: number;
  entries: SavingsLedgerRow[];
}) {
  const { currency } = useAppSettings();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Runs an edit and shows its error (if any) instead of dropping it. */
  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      setError(await runAction(fn));
    });
  const newestFirst = [...entries].reverse();

  function commitAmount(id: number, raw: string, current: number): string {
    const pounds = parsePounds(raw);
    if (pounds === null || pounds <= 0) return (current / 100).toFixed(2);
    run(() => editEntry(bucketId, id, { pounds }));
    return pounds.toFixed(2);
  }

  const inputClass =
    "rounded-md border border-transparent bg-transparent px-1 py-0.5 hover:border-input focus:border-input focus:bg-background focus:outline-none";

  return (
    <div className="space-y-2">
    {error && <p className="text-sm text-status-critical">{error}</p>}
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted text-left">
            <th className={cn("px-3 py-2 font-medium", FIELD_COLOR.date)}>Date</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className={cn("px-3 py-2 font-medium", FIELD_COLOR.note)}>Note</th>
            <th className={cn("px-3 py-2 text-right font-medium", FIELD_COLOR.amount)}>Amount</th>
            <th className="px-3 py-2 text-right font-medium">Balance</th>
            <th className="w-8 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {newestFirst.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                Nothing in this bucket yet.
              </td>
            </tr>
          )}
          {newestFirst.map((entry) => (
            <tr key={entry.id} className="row-line border-t border-border" data-testid="savings-row">
              <td className="px-3 py-2">
                <input
                  type="date"
                  defaultValue={entry.entryDate}
                  onBlur={(e) => {
                    if (!e.target.value) e.target.value = entry.entryDate;
                    else if (e.target.value !== entry.entryDate) run(() => editEntry(bucketId, entry.id, { entryDate: e.target.value }));
                  }}
                  className={inputClass}
                />
              </td>
              <td className="px-3 py-2">
                <select
                  defaultValue={entry.direction}
                  onChange={(e) => run(() => editEntry(bucketId, entry.id, { direction: e.target.value as "deposit" | "withdrawal" }))}
                  className={inputClass}
                >
                  <option value="deposit">Paid in</option>
                  <option value="withdrawal">Taken out</option>
                </select>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <input
                    defaultValue={entry.note ?? ""}
                    placeholder="Add a note…"
                    onBlur={(e) => {
                      if (e.target.value !== (entry.note ?? "")) run(() => editEntry(bucketId, entry.id, { note: e.target.value }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className={cn("w-full text-muted-foreground focus:text-foreground", inputClass)}
                  />
                  {entry.auto && (
                    <span
                      className="shrink-0 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground"
                      title="Added automatically from an expense in a linked category. Editing or deleting that expense updates this."
                    >
                      from expense
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <span className={entry.direction === "deposit" ? "text-status-good" : "text-chart-2"}>
                    {entry.direction === "deposit" ? "+" : "−"}
                  </span>
                  <input
                    defaultValue={(entry.amountPence / 100).toFixed(2)}
                    inputMode="decimal"
                    onBlur={(e) => {
                      e.target.value = commitAmount(entry.id, e.target.value, entry.amountPence);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className={cn("w-20 text-right tabular-nums", inputClass)}
                    aria-label={`Amount on ${entry.entryDate}`}
                  />
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatPence(entry.runningBalancePence, currency)}</td>
              <td className="px-2 py-2 text-right">
                <button
                  type="button"
                  onClick={() => run(() => removeEntry(bucketId, entry.id))}
                  className="rounded p-1 text-muted-foreground hover:bg-status-critical/10"
                  title="Delete this entry"
                >
                  <Trash2 className="size-3.5 text-status-critical" />
                </button>
              </td>
            </tr>
          ))}
          {openingPence > 0 && (
            <tr className="border-t border-border bg-muted/40 text-muted-foreground">
              <td className="px-3 py-2" colSpan={3}>
                Already saved when the bucket was created
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatPence(openingPence, currency)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatPence(openingPence, currency)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </div>
  );
}
