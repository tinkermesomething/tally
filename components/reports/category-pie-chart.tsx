"use client";

import { useState } from "react";
import { Cell, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatPence } from "@/lib/money";

const PIE_INNER_RADIUS = 64;
const PIE_OUTER_RADIUS = 110;

export type CategoryBreakdown = {
  name: string;
  amountPence: number;
  children: { name: string; amountPence: number }[];
};

export type GroupSlice = {
  group: string;
  amountPence: number;
  color: string;
  categories: CategoryBreakdown[];
};

export function CategoryPieChart({ slices }: { slices: GroupSlice[] }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const total = slices.reduce((sum, s) => sum + s.amountPence, 0);
  const selected = slices.find((s) => s.group === openGroup) ?? null;

  const chartData = slices.map((s) => ({
    name: s.group,
    value: s.amountPence / 100,
  }));

  const config: ChartConfig = Object.fromEntries(
    slices.map((s) => [s.group, { label: s.group, color: s.color }])
  );

  if (total === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Nothing allocated for this period yet.
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 md:items-center">
      {/* A fixed height instead of aspect-square: Safari's ResizeObserver
          doesn't reliably report a height that comes purely from CSS
          aspect-ratio on first paint, so recharts' ResponsiveContainer would
          measure the wrong size and the chart would overflow its card
          (Chrome/Firefox happened to be fine). The pie's own radius is
          already a fixed pixel value below, so squareness here was only
          ever about whitespace, not the chart's actual size. */}
      <ChartContainer config={config} className="mx-auto h-80 w-full">
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="font-mono font-medium tabular-nums">
                      {formatPence(Math.round(Number(value) * 100))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius={PIE_INNER_RADIUS}
            outerRadius={PIE_OUTER_RADIUS}
            strokeWidth={2}
          >
            {slices.map((s) => (
              <Cell key={s.group} fill={s.color} stroke="var(--card)" />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>

      <ul className="space-y-1">
        {slices.map((s) => {
          const pct = total > 0 ? (s.amountPence / total) * 100 : 0;
          return (
            <li key={s.group}>
              <button
                type="button"
                onClick={() => setOpenGroup(s.group)}
                className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-sm transition-colors hover:bg-accent"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="flex-1 text-left">{s.group}</span>
                <span className="tabular-nums text-muted-foreground">
                  {pct.toFixed(0)}%
                </span>
                <span className="w-24 text-right tabular-nums font-medium">
                  {formatPence(s.amountPence)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setOpenGroup(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: selected.color }}
                    aria-hidden
                  />
                  {selected.group}
                </DialogTitle>
              </DialogHeader>
              <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
                {selected.categories.length === 0 ? (
                  <li className="text-muted-foreground">Nothing here for this period.</li>
                ) : (
                  selected.categories.map((c) => (
                    <li key={c.name}>
                      <div className="flex items-center justify-between gap-3 py-1">
                        <span className="font-medium uppercase">{c.name}</span>
                        <span className="tabular-nums">{formatPence(c.amountPence)}</span>
                      </div>
                      {c.children.length > 0 && (
                        <ul className="ml-3 space-y-0.5 border-l border-border pl-3">
                          {c.children.map((child) => (
                            <li
                              key={child.name}
                              className="flex items-center justify-between gap-3 py-0.5 text-muted-foreground"
                            >
                              <span className="uppercase">{child.name}</span>
                              <span className="tabular-nums">{formatPence(child.amountPence)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))
                )}
              </ul>
              <DialogFooter showCloseButton />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
