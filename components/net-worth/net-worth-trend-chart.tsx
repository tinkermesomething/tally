"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";

/** Total asset value at each date any asset was (re)valued (lib/db/assets.ts's
 * getAssetValueTrend) - same AreaChart shape as SavingsProgressChart, no
 * goal reference line since net worth has no single target. Bank balances
 * and debt aren't part of this line: only assets have real history today
 * (a bank balance is a single current snapshot, debt already has its own
 * per-person ledger) - the stat card above states the full net worth
 * number, this shows how the asset side of it has moved. */
export function NetWorthTrendChart({ points, color }: { points: { entryDate: string; totalPence: number }[]; color: string }) {
  const { currency, dateFormat } = useAppSettings();
  const data = points.map((p) => ({ t: new Date(p.entryDate).getTime(), total: p.totalPence / 100 }));
  const config: ChartConfig = { total: { label: "Assets", color } };
  const tickDate = (t: number) => formatDate(new Date(t).toISOString().slice(0, 10), dateFormat);

  return (
    <div className="h-64 w-full" data-testid="net-worth-trend-chart">
      <ChartContainer config={config} className="h-full w-full">
        <AreaChart data={data} margin={{ left: 4, right: 12, top: 12, bottom: 0 }}>
          <defs>
            <linearGradient id="net-worth-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={tickDate}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
          />
          <YAxis
            tickFormatter={(v) => formatPence(Math.round(v * 100), currency).replace(/\.00$/, "")}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => tickDate(Number(value))}
                formatter={(value) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="text-muted-foreground">Assets</span>
                    <span className="font-mono font-medium tabular-nums">{formatPence(Math.round(Number(value) * 100), currency)}</span>
                  </div>
                )}
              />
            }
          />
          <Area type="monotone" dataKey="total" stroke={color} strokeWidth={2} fill="url(#net-worth-trend-fill)" />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
