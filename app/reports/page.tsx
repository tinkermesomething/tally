import { getAvailableYears, getGridData, getReportPanels, MAX_REPORT_PANELS, type ReportPanel } from "@/lib/db/queries";
import { formatPence } from "@/lib/money";
import { MonthSelect } from "@/components/reports/month-select";
import { YearSwitcher } from "@/components/grid/year-switcher";
import {
  CategoryPieChart,
  type GroupSlice,
  type CategoryBreakdown,
} from "@/components/reports/category-pie-chart";
import { AddReportPanelButton } from "@/components/reports/report-panel-dialog";
import { ReportPanelCard } from "@/components/reports/report-panel-card";
import { buildGroupColorMap, GROUP_PALETTE, UNGROUPED } from "@/lib/group-colors";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { year: yearParam, month: monthParam } = await searchParams;
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  const month = monthParam ?? "all";
  const [data, panels, years] = await Promise.all([getGridData(year), getReportPanels(), getAvailableYears()]);

  // Stable group -> color assignment, derived from the full category list
  // (not the filtered view), shared with the /grid tags so a group is
  // always the same color everywhere.
  const colorByGroup = buildGroupColorMap(data.categories);
  const groupOrder = Array.from(colorByGroup.keys());
  const existingGroups = groupOrder.filter((g) => g !== UNGROUPED);

  const flatCategories = data.categories.flatMap((c) => [
    { id: c.id, name: c.name },
    ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
  ]);

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

  function findCategoryById(id: number) {
    for (const top of data.categories) {
      if (top.id === id) return { category: top, parentGroup: top.groupName ?? UNGROUPED };
      const child = top.children.find((c) => c.id === id);
      if (child) return { category: child, parentGroup: top.groupName ?? UNGROUPED };
    }
    return null;
  }

  function resolvePanelSlices(panel: ReportPanel): GroupSlice[] {
    // Each pick is its own slice here, regardless of which underlying group
    // a category belongs to - colorByGroup would give two picks from the
    // same group the same color (e.g. picking both Rent and Council Tax,
    // both under Housing), making a panel with several picks unreadable.
    // A panel gets its own independent categorical color assignment instead.
    const resolved: GroupSlice[] = [];
    let colorIndex = 0;
    for (const pick of panel.selection) {
      const color = GROUP_PALETTE[colorIndex % GROUP_PALETTE.length];
      colorIndex++;
      if (pick.type === "group") {
        const group = pick.value;
        resolved.push({
          group,
          amountPence: totalsByGroup.get(group) ?? 0,
          color,
          categories: categoriesByGroup.get(group) ?? [],
        });
      } else {
        const found = findCategoryById(pick.value);
        if (!found) continue;
        const { category } = found;
        const amount = amountFor(category);
        resolved.push({
          group: category.name,
          amountPence: amount,
          color,
          categories: [
            {
              name: category.name,
              amountPence: amount,
              children: category.children
                .map((child) => ({ name: child.name, amountPence: amountFor(child) }))
                .filter((c) => c.amountPence > 0),
            },
          ],
        });
      }
    }
    return resolved.sort((a, b) => b.amountPence - a.amountPence);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <div className="flex items-center gap-2">
          <YearSwitcher year={year} years={years} basePath="/reports" extraParams={{ month }} />
          <MonthSelect year={year} month={month} />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="mb-2 text-sm text-muted-foreground">
          Where {formatPence(total)} is allocated, by broad category.
        </p>
        <CategoryPieChart slices={slices} />
      </div>

      {panels.length < MAX_REPORT_PANELS && (
        <div className="flex justify-end pt-2">
          <AddReportPanelButton existingGroups={existingGroups} categories={flatCategories} />
        </div>
      )}

      {panels.map((panel) => (
        <ReportPanelCard
          key={panel.id}
          panel={panel}
          slices={resolvePanelSlices(panel)}
          existingGroups={existingGroups}
          categories={flatCategories}
        />
      ))}
    </div>
  );
}
