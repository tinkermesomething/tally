import type { GridCategory } from "@/lib/db/grid";
import { GROUP_PALETTE, UNGROUPED } from "@/lib/group-colors";

export type TrendMetric = "spent" | "budgeted";

/** One line on the trend chart: a group, a category or a sub-category.
 * Both metrics are kept so the metric toggle needs no round trip. */
export type TrendNode = {
  /** "g:<group name>" or "c:<category id>" - unique across the tree. */
  id: string;
  label: string;
  color: string;
  /** Pence per month, index 0 = January. */
  spent: number[];
  budgeted: number[];
  children: TrendNode[];
};

export const OTHER_ID = "other";
export const OTHER_COLOR = "var(--muted-foreground)";

const zeros = () => Array<number>(12).fill(0);

function categoryNode(category: GridCategory, color: string): TrendNode {
  return {
    id: `c:${category.id}`,
    label: category.name,
    color,
    spent: Array.from({ length: 12 }, (_, i) => category.actualByMonth[i] ?? 0),
    budgeted: Array.from({ length: 12 }, (_, i) => category.months[i + 1]?.amountPence ?? 0),
    children: category.children.map((child, i) => categoryNode(child, GROUP_PALETTE[i % GROUP_PALETTE.length])),
  };
}

/** groups -> categories -> sub-categories. A group's colour is the one the
 * rest of the app uses; deeper levels take the fixed palette order, so a
 * series keeps its colour however the view is filtered. */
export function buildTrendTree(categories: GridCategory[], colorByGroup: Map<string, string>): TrendNode[] {
  const groups = new Map<string, TrendNode>();
  for (const category of categories) {
    const name = category.groupName ?? UNGROUPED;
    let group = groups.get(name);
    if (!group) {
      group = {
        id: `g:${name}`,
        label: name,
        color: colorByGroup.get(name) ?? GROUP_PALETTE[0],
        spent: zeros(),
        budgeted: zeros(),
        children: [],
      };
      groups.set(name, group);
    }
    const node = categoryNode(category, GROUP_PALETTE[group.children.length % GROUP_PALETTE.length]);
    group.children.push(node);
    for (let m = 0; m < 12; m++) {
      group.spent[m] += node.spent[m];
      group.budgeted[m] += node.budgeted[m];
    }
  }
  return [...groups.values()];
}

/** The series shown at a drill-down path, plus the crumbs that lead there.
 * A stale or unknown id stops the walk at the last valid level. */
export function nodesAt(tree: TrendNode[], path: string[]): { crumbs: { id: string; label: string }[]; nodes: TrendNode[] } {
  let nodes = tree;
  const crumbs: { id: string; label: string }[] = [];
  for (const id of path) {
    const hit = nodes.find((n) => n.id === id);
    if (!hit || hit.children.length === 0) break;
    crumbs.push({ id: hit.id, label: hit.label });
    nodes = hit.children;
  }
  return { crumbs, nodes };
}

/** Index after the last month with any money in it (0 = nothing at all), so
 * future months are left off the chart instead of drawn as a drop to zero. */
export function monthsWithData(tree: TrendNode[], metric: TrendMetric): number {
  let through = 0;
  for (const node of tree) {
    for (let m = 11; m >= through; m--) {
      if (node[metric][m] !== 0) {
        through = m + 1;
        break;
      }
    }
  }
  return through;
}

export const yearTotal = (node: Pick<TrendNode, "spent" | "budgeted">, metric: TrendMetric) =>
  node[metric].reduce((s, v) => s + v, 0);

/** At most `max` series (the palette has 8 colours and a 9th is never
 * invented): the biggest ones stay, the rest fold into one "Other" line. */
export function foldSeries(nodes: TrendNode[], metric: TrendMetric, max = 8): TrendNode[] {
  if (nodes.length <= max) return nodes;
  const ranked = [...nodes].sort((a, b) => yearTotal(b, metric) - yearTotal(a, metric));
  const keep = new Set(ranked.slice(0, max - 1).map((n) => n.id));
  const rest = nodes.filter((n) => !keep.has(n.id));
  const other: TrendNode = {
    id: OTHER_ID,
    label: `Other (${rest.length})`,
    color: OTHER_COLOR,
    spent: zeros(),
    budgeted: zeros(),
    children: [],
  };
  for (const n of rest) for (let m = 0; m < 12; m++) {
    other.spent[m] += n.spent[m];
    other.budgeted[m] += n.budgeted[m];
  }
  return [...nodes.filter((n) => keep.has(n.id)), other];
}

export type TrendStats = {
  through: number;
  averagePence: number;
  peak: { month: number; pence: number };
  low: { month: number; pence: number };
  /** Latest month vs the average of the months before it; null with < 2 months. */
  latest: { month: number; pence: number; earlierAveragePence: number; changePct: number | null } | null;
  /** The series whose latest month rose most above its own earlier average. */
  riser: { label: string; risePence: number } | null;
};

export function trendStats(series: TrendNode[], metric: TrendMetric, through: number): TrendStats | null {
  if (through < 1) return null;
  const totals = Array.from({ length: through }, (_, m) => series.reduce((s, n) => s + n[metric][m], 0));
  let peak = 0;
  let low = 0;
  totals.forEach((v, m) => {
    if (v > totals[peak]) peak = m;
    if (v < totals[low]) low = m;
  });
  const sum = totals.reduce((s, v) => s + v, 0);
  let latest: TrendStats["latest"] = null;
  let riser: TrendStats["riser"] = null;
  if (through >= 2) {
    const earlier = (vals: number[]) => vals.slice(0, through - 1).reduce((s, v) => s + v, 0) / (through - 1);
    const earlierAverage = earlier(totals);
    latest = {
      month: through - 1,
      pence: totals[through - 1],
      earlierAveragePence: Math.round(earlierAverage),
      changePct: earlierAverage > 0 ? Math.round(((totals[through - 1] - earlierAverage) / earlierAverage) * 100) : null,
    };
    for (const n of series) {
      const rise = Math.round(n[metric][through - 1] - earlier(n[metric]));
      if (rise > 0 && (!riser || rise > riser.risePence)) riser = { label: n.label, risePence: rise };
    }
  }
  return {
    through,
    averagePence: Math.round(sum / through),
    peak: { month: peak, pence: totals[peak] },
    low: { month: low, pence: totals[low] },
    latest,
    riser,
  };
}
