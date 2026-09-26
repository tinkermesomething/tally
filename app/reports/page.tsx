import { getGridData } from "@/lib/db/queries";
import { formatPence } from "@/lib/money";
import { MonthSelect } from "@/components/reports/month-select";
import { CategoryPieChart, type GroupSlice } from "@/components/reports/category-pie-chart";
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

  const totalsByGroup = new Map<string, number>();
  for (const category of data.categories) {
    const group = category.groupName ?? UNGROUPED;
    const amount =
      month === "all"
        ? category.yearTotalPence
        : (category.months[parseInt(month, 10)]?.amountPence ?? 0);
    totalsByGroup.set(group, (totalsByGroup.get(group) ?? 0) + amount);
  }

  const slices: GroupSlice[] = groupOrder
    .map((group) => ({
      group,
      amountPence: totalsByGroup.get(group) ?? 0,
      color: colorByGroup.get(group)!,
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
