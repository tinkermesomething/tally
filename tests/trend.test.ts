import { describe, expect, it } from "vitest";
import type { GridCategory } from "@/lib/db/grid";
import { buildTrendTree, foldSeries, monthsWithData, nodesAt, trendStats } from "@/lib/trend";

function cat(id: number, name: string, groupName: string | null, spent: number[], children: GridCategory[] = []): GridCategory {
  const months: GridCategory["months"] = {};
  spent.forEach((v, i) => {
    months[i + 1] = { amountPence: v * 2, paid: false, spentPence: v, computed: false, overdue: false };
  });
  return {
    id, name, groupName, isAnnual: false, annualMonth: null, dueDay: null, months,
    yearTotalPence: 0, monthlyAveragePence: 0,
    actualByMonth: [...spent, ...Array(12 - spent.length).fill(0)],
    children,
  };
}

const colors = new Map([["Housing", "var(--chart-1)"], ["Fun", "var(--chart-2)"]]);
const subs = [cat(11, "Gas", null, [10, 10, 40]), cat(12, "Water", null, [5, 5, 5])];
const tree = buildTrendTree(
  [cat(1, "Utilities", "Housing", [15, 15, 45], subs), cat(2, "Rent", "Housing", [100, 100, 100]), cat(3, "Cinema", "Fun", [0, 20, 0])],
  colors
);

describe("trend tree", () => {
  it("rolls categories up into groups, both metrics", () => {
    const housing = tree.find((n) => n.label === "Housing")!;
    expect(housing.spent.slice(0, 3)).toEqual([115, 115, 145]);
    expect(housing.budgeted.slice(0, 3)).toEqual([230, 230, 290]);
    expect(housing.color).toBe("var(--chart-1)");
    expect(housing.children.map((c) => c.label)).toEqual(["Utilities", "Rent"]);
  });

  it("drills down and stops at a leaf or unknown id", () => {
    expect(nodesAt(tree, []).nodes).toHaveLength(2);
    const level2 = nodesAt(tree, ["g:Housing"]);
    expect(level2.crumbs.map((c) => c.label)).toEqual(["Housing"]);
    expect(nodesAt(tree, ["g:Housing", "c:1"]).nodes.map((n) => n.label)).toEqual(["Gas", "Water"]);
    expect(nodesAt(tree, ["g:Housing", "c:2"]).nodes.map((n) => n.label)).toEqual(["Utilities", "Rent"]);
    expect(nodesAt(tree, ["g:Nope"]).nodes).toBe(tree);
  });

  it("finds the last month with data", () => {
    expect(monthsWithData(tree, "spent")).toBe(3);
    expect(monthsWithData([], "spent")).toBe(0);
  });

  it("folds extra series into one Other line, keeping the biggest", () => {
    const many = Array.from({ length: 10 }, (_, i) => cat(100 + i, `C${i}`, "Housing", [i + 1]));
    const nodes = buildTrendTree(many, colors)[0].children;
    const folded = foldSeries(nodes, "spent");
    expect(folded).toHaveLength(8);
    expect(folded[7].id).toBe("other");
    expect(folded[7].spent[0]).toBe(1 + 2 + 3); // the three smallest
    expect(foldSeries(nodes.slice(0, 8), "spent")).toHaveLength(8);
  });

  it("computes stats", () => {
    const stats = trendStats(tree, "spent", 3)!;
    expect(stats.averagePence).toBe(Math.round((115 + 135 + 145) / 3));
    expect(stats.peak.month).toBe(2);
    expect(stats.low.month).toBe(0);
    expect(stats.latest).toMatchObject({ month: 2, pence: 145, earlierAveragePence: 125, changePct: 16 });
    expect(stats.riser?.label).toBe("Housing");
    expect(trendStats(tree, "spent", 0)).toBeNull();
    expect(trendStats(tree, "spent", 1)!.latest).toBeNull();
  });
});
