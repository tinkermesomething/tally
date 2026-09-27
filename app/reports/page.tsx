import { getGridData } from "@/lib/db/queries";
import { formatPence } from "@/lib/money";
import { MonthSelect } from "@/components/reports/month-select";
import {
  CategoryPieChart,
  type GroupSlice,
  type CategoryBreakdown,
} from "@/components/reports/category-pie-chart";
import { buildGroupColorMap, UNGROUPED } from "@/lib/group-colors";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { year: yearParam, month: monthParam } = await searchParams;
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  const month = monthParam ?? "all";
  const data = await getGridData(year);

  // Stable group -> color assignment, derived from the full category list
  // (not the filtered view), shared with the /grid tags so a group is
  // always the same color everywhere.
  const colorByGroup = buildGroupColorMap(data.categories);
  const groupOrder = Array.from(colorByGroup.keys());

  function amountFor(entry: { yearTotalPence: number; months: Record<number, { amountPence?: number }> }) {
    return month === "all"
      ? entry.yearTotalPence
      : (entry.months[parseInt(month, 10)]?.amountPence ?? 0);
  }

  const totalsByGroup = new Map<string, number>();
  const categoriesByGroup = new Map<string, CategoryBreakdown[]>();
  for (const category of data.categories) {
    const group = category.groupName ?? UNGROUPED;
    const amount = amountFor(category);
    totalsByGroup.set(group, (totalsByGroup.get(group) ?? 0) + amount);

    const children = category.children
      .map((child) => ({ name: child.name, amountPence: amountFor(child) }))
      .filter((c) => c.amountPence > 0);
    if (amount > 0 || children.length > 0) {
      const list = categoriesByGroup.get(group) ?? [];
      list.push({ name: category.name, amountPence: amount, children });
      categoriesByGroup.set(group, list);
    }
  }

  const slices: GroupSlice[] = groupOrder
    .map((group) => ({
      group,
      amountPence: totalsByGroup.get(group) ?? 0,
      color: colorByGroup.get(group)!,
      categories: (categoriesByGroup.get(group) ?? []).sort(
        (a, b) => b.amountPence - a.amountPence
      ),
    }))
    .filter((s) => s.amountPence > 0)
    .sort((a, b) => b.amountPence - a.amountPence);

  const total = slices.reduce((sum, s) => sum + s.amountPence, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Where {formatPence(total)} is allocated, by broad category.
          </p>
        </div>
        <MonthSelect year={year} month={month} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <CategoryPieChart slices={slices} />
      </div>
    </div>
  );
}
