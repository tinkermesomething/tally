"use client";

import { formatPence } from "@/lib/money";
import { MONTH_ABBREVIATIONS as MONTHS } from "@/lib/months";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import type { HouseholdIncomeGridRow } from "@/lib/db/household";

/** Same shape as the real Grid's own Income table (components/grid/income-table.tsx) -
 * amount only, no budgeted/planned split (personal income already has no
 * separate "planned" figure in this app either). */
export function HouseholdIncomeTable({ rows, year }: { rows: HouseholdIncomeGridRow[]; year: number }) {
  const { currency } = useAppSettings();
  const monthTotals = Array.from({ length: 12 }, (_, i) => rows.reduce((sum, r) => sum + r.months[i + 1], 0));
  const yearTotal = rows.reduce((s, r) => s + r.yearTotalPence, 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm">
      <table className="w-full border-collapse text-sm" style={{ minWidth: 980 }}>
        <thead>
          <tr className="bg-muted">
            <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">Income</th>
            {MONTHS.map((m) => (
              <th key={m} className="px-2 py-2 text-right font-medium">
                {m}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Year total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={14} className="px-3 py-10 text-center text-muted-foreground">
                No income shared for {year} yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.sourceName} className="row-line border-b border-border/60">
                <td className="sticky left-0 z-10 bg-card px-3 py-2">{row.sourceName}</td>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <td key={month} className="px-2 py-2 text-right tabular-nums">
                    {row.months[month] > 0 ? formatPence(row.months[month], currency) : <span className="text-muted-foreground">—</span>}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatPence(row.yearTotalPence, currency)}</td>
              </tr>
            ))
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-border bg-secondary font-medium">
              <td className="sticky left-0 z-10 bg-secondary px-3 py-2">TOTAL</td>
              {monthTotals.map((t, i) => (
                <td key={i} className="px-2 py-2 text-right tabular-nums">
                  {formatPence(t, currency)}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-bold tabular-nums">{formatPence(yearTotal, currency)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
