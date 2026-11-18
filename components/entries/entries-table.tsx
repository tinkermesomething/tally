"use client";

import { parsePounds } from "@/lib/money-input";
import { useMemo, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { editExpenseEntry, removeExpenseEntry, editIncomeTransaction, removeIncomeTransaction } from "@/app/grid/actions";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import type { EntryRow } from "@/lib/db/queries";
import { amountText, fuzzyScore } from "@/lib/fuzzy";
import { FIELD_COLOR } from "@/lib/field-colors";
import { EntryTagsControl } from "@/components/entries/entry-tags-control";
import { cn } from "@/lib/utils";

type Filter = "all" | "income" | "expense";

export function EntriesTable({ entries }: { entries: EntryRow[] }) {
  const { currency, dateFormat } = useAppSettings();
  const [rows, setRows] = useState(entries);
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => (filter === "all" ? rows : rows.filter((r) => r.kind === filter)), [rows, filter]);

  // Best matches first while searching; original order when not. Only this
  // period's loaded entries are searched.
  const shown = useMemo(() => {
    if (query.trim() === "") return filtered;
    return filtered
      .map((r, i) => ({ r, i, s: fuzzyScore(query, [r.label, r.note, amountText(r.amountPence), r.entryDate]) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.r);
  }, [filtered, query]);

  /** Returns the canonical "10.00"-formatted value to redisplay on a valid
   * edit, or null on invalid input - the input is uncontrolled (defaultValue
   * only applies once, at mount), so without this the box would keep
   * showing whatever raw text was typed ("10") forever instead of settling
   * on the formatted amount. Null tells the caller to revert instead. */
  function commitAmount(entry: EntryRow, raw: string): string | null {
    const pounds = (parsePounds(raw) ?? NaN);
    if (Number.isNaN(pounds) || pounds <= 0) return null;
    const signed = entry.kind === "income" ? Math.round(pounds * 100) : -Math.round(pounds * 100);
    setRows((rs) => rs.map((r) => (r.id === entry.id && r.kind === entry.kind ? { ...r, amountPence: signed } : r)));
    startTransition(async () => {
      if (entry.kind === "income") await editIncomeTransaction(entry.id, { pounds });
      else await editExpenseEntry(entry.id, { pounds });
    });
    return pounds.toFixed(2);
  }

  function commitNote(entry: EntryRow, note: string) {
    setRows((rs) => rs.map((r) => (r.id === entry.id && r.kind === entry.kind ? { ...r, note: note || null } : r)));
    startTransition(async () => {
      if (entry.kind === "income") await editIncomeTransaction(entry.id, { note });
      else await editExpenseEntry(entry.id, { note });
    });
  }

  function remove(entry: EntryRow) {
    setRows((rs) => rs.filter((r) => !(r.id === entry.id && r.kind === entry.kind)));
    startTransition(async () => {
      if (entry.kind === "income") await removeIncomeTransaction(entry.id);
      else await removeExpenseEntry(entry.id);
    });
  }

  const filterLabel: Record<Filter, string> = { all: "All", income: "Incoming", expense: "Outgoing" };

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Nothing logged for this period.
      </p>
    );
  }

  return (
    <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search category, note, amount…"
        aria-label="Search entries"
        className="h-8 w-64 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
      />
      <div className="flex items-center gap-1" role="group" aria-label="Filter by direction">
        {(["all", "income", "expense"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs",
              filter === f ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {filterLabel[f]}
          </button>
        ))}
      </div>
      {(query.trim() !== "" || filter !== "all") && (
        <span className="text-xs text-muted-foreground" data-testid="entries-filter-count">
          Showing {shown.length} of {rows.length}
        </span>
      )}
    </div>
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted text-left">
            <th className={`px-3 py-2 font-medium ${FIELD_COLOR.date}`}>Date</th>
            <th className={`px-3 py-2 font-medium ${FIELD_COLOR.category}`}>Category / Source</th>
            <th className={`px-3 py-2 text-right font-medium ${FIELD_COLOR.amount}`}>Amount</th>
            <th className={`px-3 py-2 font-medium ${FIELD_COLOR.note}`}>Note</th>
            <th className="px-3 py-2 font-medium">Counts towards</th>
            <th className="w-8 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                No entries match.
              </td>
            </tr>
          )}
          {shown.map((entry) => (
            <tr key={`${entry.kind}-${entry.id}`} className={`row-line border-t border-border ${entry.provisional ? "bg-muted/40" : ""}`}>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDate(entry.entryDate, dateFormat)}</td>
              <td className="px-3 py-2 font-medium">
                {entry.label}
                {entry.provisional && (
                  <span
                    className="ml-1.5 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[0.65rem] font-normal text-muted-foreground"
                    title="Pencilled in from a pending bank transaction - not yet confirmed"
                  >
                    pencilled in
                  </span>
                )}
              </td>
              <td className={cn("px-3 py-2 text-right", entry.kind === "income" && "text-status-good")}>
                <input
                  defaultValue={(Math.abs(entry.amountPence) / 100).toFixed(2)}
                  inputMode="decimal"
                  onBlur={(e) => {
                    e.target.value = commitAmount(entry, e.target.value) ?? (Math.abs(entry.amountPence) / 100).toFixed(2);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="w-20 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-right tabular-nums hover:border-input focus:border-input focus:bg-background focus:outline-none"
                  aria-label={`Amount for ${entry.label} on ${entry.entryDate}`}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  defaultValue={entry.note ?? ""}
                  placeholder="Add a note…"
                  onBlur={(e) => commitNote(entry, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-muted-foreground hover:border-input focus:border-input focus:bg-background focus:text-foreground focus:outline-none"
                  aria-label={`Note for ${entry.label} on ${entry.entryDate}`}
                />
              </td>
              <td className="px-3 py-2">
                <EntryTagsControl
                  entryId={entry.id}
                  kind={entry.kind}
                  requiresDebtPerson={entry.requiresDebtPerson}
                  label={`${entry.label} on ${entry.entryDate}`}
                  tags={entry}
                  onChanged={(next) => setRows((rs) => rs.map((r) => (r.id === entry.id && r.kind === entry.kind ? { ...r, ...next } : r)))}
                />
              </td>
              <td className="px-2 py-2 text-right">
                <button
                  type="button"
                  onClick={() => remove(entry)}
                  className="rounded p-1 text-muted-foreground hover:bg-status-critical/10 hover:text-status-critical"
                  title="Delete this entry"
                >
                  <Trash2 className="size-3.5 text-status-critical" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-secondary font-medium">
            <td className="px-3 py-2" colSpan={2}>
              {filter === "all" ? "Net" : "Total"}
              {shown.length !== rows.length ? ` (${shown.length} of ${rows.length} shown)` : ""}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatPence(shown.reduce((sum, r) => sum + r.amountPence, 0), currency)}
            </td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
    </div>
  );
}
