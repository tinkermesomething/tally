"use client";

import { formatPence } from "@/lib/money";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import type { VarianceRow } from "@/lib/report-view";

// Polarity is the job here (over vs under a target), so it uses a diverging
// pair - warm for over, cool for under - from the chart tokens, never the
// group colors. Every bar also carries a signed number and a word, so the
// meaning never rests on colour alone.
const OVER = "var(--chart-8)";
const UNDER = "var(--chart-1)";

// Column widths live in .variance-row (globals.css): the same template for the
// header, every row and the total, so they line up. The figure columns are wide
// enough for "+£1,234.56 over" and never wrap.

/** Budgeted vs spent per group: a table whose bars diverge from a centre
 * line - right = over budget, left = under. The rows are the data table. */
export function VarianceChart({ rows }: { rows: VarianceRow[] }) {
  const { currency } = useAppSettings();
  if (rows.length === 0) return null;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.diffPence)));
  const totalBudgeted = rows.reduce((s, r) => s + r.budgetedPence, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spentPence, 0);

  return (
    <div className="space-y-2" data-testid="variance-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Spent vs budgeted</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: OVER }} aria-hidden />
            Over budget
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: UNDER }} aria-hidden />
            Under budget
          </span>
        </div>
      </div>

      <div className="variance-row hidden px-1 text-xs text-muted-foreground md:grid">
        <span>Group</span>
        <span className="text-right">Budgeted</span>
        <span className="text-right">Spent</span>
        <span className="text-center">Under ← → Over</span>
        <span className="text-right">Difference</span>
      </div>

      <ul className="space-y-1">
        {rows.map((r) => {
          const over = r.diffPence > 0;
          const width = (Math.abs(r.diffPence) / maxAbs) * 50; // % of the track, each side of centre
          const word = r.diffPence === 0 ? "on budget" : over ? "over" : "under";
          const signed = `${r.diffPence > 0 ? "+" : r.diffPence < 0 ? "−" : ""}${formatPence(Math.abs(r.diffPence), currency)}`;
          return (
            <li
              key={r.key}
              data-testid="variance-row"
              title={`${r.label}: budgeted ${formatPence(r.budgetedPence, currency)}, spent ${formatPence(r.spentPence, currency)} (${signed} ${word})`}
              className="variance-row rounded-md px-1 py-1 text-sm hover:bg-accent"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
                <span className="truncate">{r.label}</span>
              </span>
              <span className="hidden whitespace-nowrap text-right tabular-nums text-muted-foreground md:block">
                {formatPence(r.budgetedPence, currency)}
              </span>
              <span className="hidden whitespace-nowrap text-right tabular-nums md:block">{formatPence(r.spentPence, currency)}</span>
              <span
                className="relative order-last col-span-2 h-3 md:order-none md:col-span-1"
                role="img"
                aria-label={`${r.label}: ${signed} ${word}`}
              >
                <span className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden />
                {r.diffPence !== 0 && (
                  <span
                    className="absolute inset-y-0.5"
                    data-testid="variance-bar"
                    data-over={over}
                    style={{
                      backgroundColor: over ? OVER : UNDER,
                      width: `${width}%`,
                      ...(over
                        ? { left: "50%", borderRadius: "0 4px 4px 0" }
                        : { right: "50%", borderRadius: "4px 0 0 4px" }),
                    }}
                  />
                )}
              </span>
              <span className="whitespace-nowrap text-right font-medium tabular-nums">
                {signed}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{word}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="variance-row border-t border-border px-1 pt-2 text-sm font-medium">
        <span>Total</span>
        <span className="hidden whitespace-nowrap text-right tabular-nums md:block">{formatPence(totalBudgeted, currency)}</span>
        <span className="hidden whitespace-nowrap text-right tabular-nums md:block">{formatPence(totalSpent, currency)}</span>
        <span className="hidden md:block" />
        <span className="whitespace-nowrap text-right tabular-nums">
          {totalSpent - totalBudgeted > 0 ? "+" : totalSpent - totalBudgeted < 0 ? "−" : ""}
          {formatPence(Math.abs(totalSpent - totalBudgeted), currency)}
        </span>
      </div>
    </div>
  );
}
