"use client";

import { useMemo, useState } from "react";
import { ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GridWidthToggle } from "@/components/grid/grid-width-toggle";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { formatPence } from "@/lib/money";
import { MONTH_ABBREVIATIONS, MONTH_NAMES } from "@/lib/months";
import { cn } from "@/lib/utils";
import { foldSeries, monthsWithData, nodesAt, trendStats, yearTotal, type TrendMetric, type TrendNode } from "@/lib/trend";

type Mode = "stacked" | "lines";

const W = 1000;
const H = 300;

/** Round the axis top up to 1, 2, 2.5, 5 x 10^n so ticks land on tidy figures. */
function niceMax(pence: number) {
  if (pence <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(pence));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= pence)!;
  return step * pow;
}

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

/** Year trend per group, category or sub-category: a stacked-area (or line)
 * chart you can scrub, with a heat table under it sharing the same hover. */
export function TrendReport({ tree, year }: { tree: TrendNode[]; year: number }) {
  const { currency } = useAppSettings();
  const money = (p: number) => formatPence(p, currency);
  const [metric, setMetric] = useState<TrendMetric>("spent");
  const [mode, setMode] = useState<Mode>("stacked");
  const [path, setPath] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const { crumbs, nodes } = useMemo(() => nodesAt(tree, path), [tree, path]);
  const through = monthsWithData(tree, metric);
  const series = useMemo(() => foldSeries(nodes, metric).filter((n) => yearTotal(n, metric) !== 0), [nodes, metric]);
  const visible = series.filter((n) => !hidden.has(n.id));
  const stats = trendStats(visible, metric, through);

  const pristine = path.length === 0 && hidden.size === 0 && metric === "spent" && mode === "stacked";
  function reset() {
    setMetric("spent");
    setMode("stacked");
    go([]);
  }
  function go(next: string[]) {
    setPath(next);
    setHidden(new Set());
    setHover(null);
    setFocus(null);
  }
  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Stacked tops per month, bottom series first.
  const totals = Array.from({ length: through }, (_, m) => visible.reduce((s, n) => s + n[metric][m], 0));
  const top = niceMax(mode === "stacked" ? Math.max(0, ...totals) : Math.max(0, ...visible.flatMap((n) => n[metric].slice(0, through))));
  const x = (m: number) => (m / 11) * W;
  const y = (v: number) => H - (v / top) * H;

  const areas = useMemo(() => {
    const base = Array<number>(through).fill(0);
    return visible.map((n) => {
      const lower = [...base];
      const upper = base.map((b, m) => b + n[metric][m]);
      upper.forEach((v, m) => (base[m] = v));
      return { node: n, lower, upper };
    });
  }, [visible, metric, through]);

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(through - 1, Math.round(f * 11))));
  }

  const dim = (id: string) => (focus && focus !== id ? 0.22 : 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);

  if (through === 0) {
    return (
      <div className="report-panel rounded-2xl border border-border bg-card p-6 shadow-sm" data-testid="trend-report">
        <MetricToggle metric={metric} onChange={setMetric} />
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing {metric === "spent" ? "spent" : "budgeted"} in {year} yet.
        </p>
      </div>
    );
  }

  const hoverRows =
    hover === null
      ? []
      : visible
          .map((n) => ({ n, v: n[metric][hover], prev: hover > 0 ? n[metric][hover - 1] : null }))
          .sort((a, b) => b.v - a.v);

  return (
    <div className="report-panel space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6" data-testid="trend-report">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">Trend · {year}</h2>
          <nav aria-label="Trend scope" className="flex flex-wrap items-center gap-0.5 text-sm text-muted-foreground">
            <button type="button" onClick={() => go([])} className={cn("rounded px-1 hover:text-foreground", crumbs.length === 0 && "text-foreground")}>
              All groups
            </button>
            {crumbs.map((c, i) => (
              <span key={c.id} className="flex items-center gap-0.5">
                <ChevronRight className="size-3.5" aria-hidden />
                <button type="button" onClick={() => go(path.slice(0, i + 1))} className={cn("rounded px-1 hover:text-foreground", i === crumbs.length - 1 && "text-foreground")}>
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <MetricToggle metric={metric} onChange={setMetric} />
          <div role="group" aria-label="Chart style" className="inline-flex rounded-lg border border-input bg-muted/40 p-0.5">
            {(["stacked", "lines"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("rounded-md border border-transparent px-3 py-1 text-sm capitalize", mode === m ? "accent-outline font-medium" : "text-muted-foreground hover:text-foreground")}>
                {m}
              </button>
            ))}
          </div>
          <GridWidthToggle target="trend" />
        </div>
      </div>

      {stats && (
        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="trend-stats">
          <Stat label="Average a month" value={money(stats.averagePence)} note={`over ${stats.through} month${stats.through === 1 ? "" : "s"}`} />
          <Stat label="Highest month" value={money(stats.peak.pence)} note={MONTH_NAMES[stats.peak.month]} />
          <Stat label="Lowest month" value={money(stats.low.pence)} note={MONTH_NAMES[stats.low.month]} />
          {stats.latest ? (
            <Stat
              label={`${MONTH_NAMES[stats.latest.month]} vs earlier`}
              value={stats.latest.changePct === null ? "—" : `${sign(stats.latest.changePct)}${Math.abs(stats.latest.changePct)}%`}
              note={stats.riser ? `Most up: ${stats.riser.label} (+${money(stats.riser.risePence)})` : `Earlier avg ${money(stats.latest.earlierAveragePence)}`}
            />
          ) : (
            <Stat label="Latest" value={money(stats.peak.pence)} note="First month with data" />
          )}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Series">
        {series.map((n) => {
          const off = hidden.has(n.id);
          return (
            <button
              key={n.id}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(n.id)}
              onPointerEnter={() => setFocus(n.id)}
              onPointerLeave={() => setFocus(null)}
              className={cn("flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs transition-opacity", off && "opacity-40")}
              title={off ? "Show this series" : "Hide this series"}
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: n.color }} aria-hidden />
              <span className={cn(off && "line-through")}>{n.label}</span>
            </button>
          );
        })}
        <Button type="button" size="xs" variant="ghost" className="ml-auto print:hidden" disabled={pristine} onClick={reset} title="Back to all groups, every series shown, Spent, Stacked">
          <RotateCcw className="size-3.5" />
          Reset view
        </Button>
      </div>

      <div className="flex gap-2">
        <div className="relative h-72 w-12 shrink-0 text-right text-[0.7rem] tabular-nums text-muted-foreground sm:w-14" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / top) * 100}%` }}>
              {money(Math.round(t)).replace(/\.00$/, "")}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="relative h-72 touch-pan-y select-none"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
            data-testid="trend-plot"
          >
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" role="img" aria-label={`Monthly ${metric} trend for ${year}`}>
              {ticks.map((t) => (
                <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray={t === 0 ? undefined : "3 4"} />
              ))}
              {mode === "stacked"
                ? areas.map(({ node, lower, upper }) => {
                    const pts = (arr: number[]) => arr.map((v, m) => `${x(m)},${y(v)}`);
                    const d = through === 1 ? "" : `M${pts(upper).join("L")}L${pts(lower).reverse().join("L")}Z`;
                    return (
                      <g key={node.id} style={{ opacity: dim(node.id), transition: "opacity 120ms" }}>
                        <path d={d} fill={node.color} fillOpacity={0.78} stroke="var(--card)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                      </g>
                    );
                  })
                : visible.map((n) => (
                    <polyline
                      key={n.id}
                      points={n[metric].slice(0, through).map((v, m) => `${x(m)},${y(v)}`).join(" ")}
                      fill="none"
                      stroke={n.color}
                      strokeWidth={2.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      style={{ opacity: dim(n.id), transition: "opacity 120ms" }}
                    />
                  ))}
            </svg>

            {hover !== null && (
              <>
                <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${(hover / 11) * 100}%` }} aria-hidden />
                {(mode === "stacked" ? areas.map((a) => ({ node: a.node, v: a.upper[hover] })) : visible.map((n) => ({ node: n, v: n[metric][hover] }))).map(({ node, v }) => (
                  <span
                    key={node.id}
                    className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card"
                    style={{ left: `${(hover / 11) * 100}%`, top: `${(1 - v / top) * 100}%`, backgroundColor: node.color }}
                    aria-hidden
                  />
                ))}
                <div
                  className="pointer-events-none absolute top-1 z-10 w-56 rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-md"
                  style={hover > 6 ? { right: `${(1 - hover / 11) * 100 + 2}%` } : { left: `${(hover / 11) * 100 + 2}%` }}
                  data-testid="trend-tooltip"
                >
                  <p className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="font-medium">{MONTH_NAMES[hover]}</span>
                    <span className="tabular-nums font-medium">{money(totals[hover])}</span>
                  </p>
                  <ul className="space-y-1">
                    {hoverRows.map(({ n, v, prev }) => {
                      const delta = prev === null ? null : v - prev;
                      return (
                        <li key={n.id} className="flex items-center gap-1.5">
                          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: n.color }} aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{n.label}</span>
                          <span className="tabular-nums">{money(v)}</span>
                          <span className="w-14 text-right tabular-nums text-muted-foreground">
                            {delta === null || delta === 0 ? "" : `${delta > 0 ? "▲" : "▼"} ${money(Math.abs(delta))}`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {hover > 0 && <p className="mt-1.5 border-t border-border pt-1 text-muted-foreground">▲▼ change vs {MONTH_NAMES[hover - 1]}</p>}
                </div>
              </>
            )}
          </div>
          <div className="mt-1 grid grid-cols-12 text-center text-[0.7rem] text-muted-foreground" aria-hidden>
            {MONTH_ABBREVIATIONS.map((m, i) => (
              <span key={m} className={cn(hover === i && "font-medium text-foreground", i >= through && "opacity-40")}>
                {m}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto" data-testid="trend-table">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card py-1 pr-2 text-left font-medium text-muted-foreground">{crumbs.length ? crumbs[crumbs.length - 1].label : "Group"}</th>
              {MONTH_ABBREVIATIONS.map((m, i) => (
                <th key={m} className={cn("px-1 py-1 text-right font-medium text-muted-foreground", hover === i && "text-foreground")}>{m}</th>
              ))}
              <th className="py-1 pl-2 text-right font-medium text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {series.map((n) => {
              const max = Math.max(1, ...n[metric].slice(0, through));
              const drill = nodes.find((x) => x.id === n.id)?.children.length;
              return (
                <tr key={n.id} onPointerEnter={() => setFocus(n.id)} onPointerLeave={() => setFocus(null)} className={cn(hidden.has(n.id) && "opacity-40")}>
                  <th className="sticky left-0 z-10 bg-card py-0.5 pr-2 text-left font-normal">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: n.color }} aria-hidden />
                      {drill ? (
                        <button type="button" onClick={() => go([...path.slice(0, crumbs.length), n.id])} className="truncate underline-offset-2 hover:underline" title={`Break ${n.label} down`}>
                          {n.label}
                        </button>
                      ) : (
                        <span className="truncate">{n.label}</span>
                      )}
                    </span>
                  </th>
                  {n[metric].map((v, m) => {
                    // An inline "data bar" (Excel's term for this exact
                    // pattern) instead of a flat background tint - a hard
                    // edge at the value's own share of the row's max reads
                    // at a glance, where a uniform-opacity tint only ever
                    // showed up as a vague intensity difference between
                    // cells. Added alongside the area/line chart above,
                    // not instead of it - this is about the table.
                    const barPct = Math.round((v / max) * 100);
                    return (
                      <td
                        key={m}
                        onPointerEnter={() => setHover(m < through ? m : null)}
                        className={cn("px-1 py-0.5 text-right tabular-nums", hover === m && "outline outline-1 -outline-offset-1 outline-foreground/50", m >= through && "text-muted-foreground/50")}
                        style={
                          m < through && v > 0
                            ? { background: `linear-gradient(to right, color-mix(in srgb, ${n.color} 45%, transparent) ${barPct}%, transparent ${barPct}%)` }
                            : undefined
                        }
                      >
                        {m >= through ? "—" : v === 0 ? "·" : money(v).replace(/\.00$/, "")}
                      </td>
                    );
                  })}
                  <td className="py-0.5 pl-2 text-right font-medium tabular-nums">{money(yearTotal(n, metric))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <th className="sticky left-0 bg-card border-t border-border pt-1 pr-2 text-left">Total</th>
              {Array.from({ length: 12 }, (_, m) => (
                <td key={m} className="border-t border-border px-1 pt-1 text-right tabular-nums">
                  {m < through ? money(totals[m]).replace(/\.00$/, "") : "—"}
                </td>
              ))}
              <td className="border-t border-border pt-1 pl-2 text-right tabular-nums">{money(totals.reduce((s, v) => s + v, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground print:hidden">Move over the chart or table to read a month. Click a name in the table to break it down; click a chip to hide it.</p>
    </div>
  );
}

function MetricToggle({ metric, onChange }: { metric: TrendMetric; onChange: (m: TrendMetric) => void }) {
  return (
    <div role="group" aria-label="Measure" className="inline-flex rounded-lg border border-input bg-muted/40 p-0.5">
      {(["spent", "budgeted"] as const).map((m) => (
        <button key={m} type="button" aria-pressed={metric === m} onClick={() => onChange(m)} className={cn("rounded-md border border-transparent px-3 py-1 text-sm capitalize", metric === m ? "accent-outline font-medium" : "text-muted-foreground hover:text-foreground")}>
          {m}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border/70 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums leading-tight">{value}</dd>
      <dd className="truncate text-xs text-muted-foreground" title={note}>{note}</dd>
    </div>
  );
}
