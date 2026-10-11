"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import type { SavingsLedgerRow } from "@/lib/db/savings";

/** Running balance over time, with a dashed reference line at the goal -
 * "how much" AND "is this on track", not just a single percentage. Uses
 * the real deposit/withdrawal history (runningBalancePence, already
 * computed by getBucketLedger) rather than collapsing it to one number,
 * so the actual shape of progress (steady vs. bursty saving) shows. Only
 * rendered by the caller once there are 2+ entries - one point has no
 * shape to show. */
export function SavingsProgressChart({
  entries,
  goalPence,
  color,
}: {
  entries: SavingsLedgerRow[];
  goalPence: number | null;
  color: string;
}) {
  const { currency, dateFormat } = useAppSettings();

  // Pounds, not pence, for recharts' own axis/tick math - same convention
  // CategoryPieChart already uses (dividing back out in every formatter
  // that touches real money is simpler than teaching recharts about pence).
  const data = entries.map((e) => ({ t: new Date(e.entryDate).getTime(), balance: e.runningBalancePence / 100 }));
  const config: ChartConfig = { balance: { label: "Balance", color } };
  const tickDate = (t: number) => formatDate(new Date(t).toISOString().slice(0, 10), dateFormat);

  return (
    <div className="h-64 w-full" data-testid="savings-progress-chart">
      <ChartContainer config={config} className="h-full w-full">
        <AreaChart data={data} margin={{ left: 4, right: 12, top: 12, bottom: 0 }}>
          <defs>
            <linearGradient id="savings-progress-fill" x1="0" y1="0" x2="0" y2="1">
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
                    <span className="text-muted-foreground">Balance</span>
                    <span className="font-mono font-medium tabular-nums">{formatPence(Math.round(Number(value) * 100), currency)}</span>
                  </div>
                )}
              />
            }
          />
          {goalPence !== null && (
            <ReferenceLine
              y={goalPence / 100}
              stroke={color}
              strokeDasharray="4 4"
              label={{ value: "Goal", position: "insideTopRight", fill: color, fontSize: 11 }}
            />
          )}
          <Area type="monotone" dataKey="balance" stroke={color} strokeWidth={2} fill="url(#savings-progress-fill)" />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
