"use client";

import { Cell, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatPence } from "@/lib/money";

export type GroupSlice = {
  group: string;
  amountPence: number;
  color: string;
};

export function CategoryPieChart({ slices }: { slices: GroupSlice[] }) {
  const total = slices.reduce((sum, s) => sum + s.amountPence, 0);

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
      <ChartContainer config={config} className="mx-auto aspect-square w-full max-h-80">
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
            innerRadius={64}
            outerRadius={110}
            strokeWidth={2}
          >
            {slices.map((s) => (
              <Cell key={s.group} fill={s.color} stroke="var(--card)" />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>

      <ul className="space-y-2">
        {slices.map((s) => {
          const pct = total > 0 ? (s.amountPence / total) * 100 : 0;
          return (
            <li key={s.group} className="flex items-center gap-2.5 text-sm">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="flex-1">{s.group}</span>
              <span className="tabular-nums text-muted-foreground">
                {pct.toFixed(0)}%
              </span>
              <span className="w-24 text-right tabular-nums font-medium">
                {formatPence(s.amountPence)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
