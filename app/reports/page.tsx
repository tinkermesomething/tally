import { getAvailableYears, getGridData, getReportPanels, MAX_REPORT_PANELS, type ReportPanel } from "@/lib/db/queries";
import { getAppSettings } from "@/lib/db/settings";
import { formatPence } from "@/lib/money";
import { MonthSelect } from "@/components/reports/month-select";
import { ReportViewToggle } from "@/components/reports/view-toggle";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import { parseReportView, VIEW_PREFIX } from "@/lib/report-view";
import { MONTH_NAMES } from "@/lib/months";
import { YearSwitcher } from "@/components/grid/year-switcher";
import { type GroupSlice, type CategoryBreakdown } from "@/components/reports/category-pie-chart";
import { AddReportPanelButton } from "@/components/reports/report-panel-dialog";
import { ReportPanelCard, ReportBody } from "@/components/reports/report-panel-card";
import { TrendReport } from "@/components/reports/trend-report";
import { buildTrendTree } from "@/lib/trend";
import { buildGroupColorMap, GROUP_PALETTE, UNGROUPED } from "@/lib/group-colors";
import { withCurrentUser } from "@/lib/db/current-user";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; view?: string }>;
}) {
  return withCurrentUser(async () => {
  const { year: yearParam, month: monthParam, view: viewParam } = await searchParams;
  const view = parseReportView(viewParam);
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  const month = monthParam ?? "all";
  const [data, panels, years, { currency }] = await Promise.all([
    getGridData(year),
    getReportPanels(),
    getAvailableYears(),
    getAppSettings(),
  ]);

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

  type Mode = "budgeted" | "spent";

  /** One category's amount for the chosen month (or the whole year): the
   * plan, or what was actually spent. */
  function amountFor(
    entry: { yearTotalPence: number; months: Record<number, { amountPence?: number }>; actualByMonth: number[] },
    mode: Mode
  ) {
    if (mode === "budgeted") {
      return month === "all" ? entry.yearTotalPence : (entry.months[parseInt(month, 10)]?.amountPence ?? 0);
    }
    return month === "all"
      ? entry.actualByMonth.reduce((sum, v) => sum + v, 0)
      : (entry.actualByMonth[parseInt(month, 10) - 1] ?? 0);
  }

  function findCategoryById(id: number) {
    for (const top of data.categories) {
      if (top.id === id) return { category: top, parentGroup: top.groupName ?? UNGROUPED };
      const child = top.children.find((c) => c.id === id);
      if (child) return { category: child, parentGroup: top.groupName ?? UNGROUPED };
    }
    return null;
  }

  /** Everything the charts need, computed for one mode. Both modes run
   * through the same code so a "Compare" can never disagree with either
   * single view. */
  function aggregate(mode: Mode) {
    const totalsByGroup = new Map<string, number>();
    const categoriesByGroup = new Map<string, CategoryBreakdown[]>();
    for (const category of data.categories) {
      const group = category.groupName ?? UNGROUPED;
      const amount = amountFor(category, mode);
      totalsByGroup.set(group, (totalsByGroup.get(group) ?? 0) + amount);

      const children = category.children
        .map((child) => ({ name: child.name, amountPence: amountFor(child, mode) }))
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
        categories: (categoriesByGroup.get(group) ?? []).sort((a, b) => b.amountPence - a.amountPence),
      }))
      .filter((s) => s.amountPence > 0)
      .sort((a, b) => b.amountPence - a.amountPence);

    function resolvePanelSlices(panel: ReportPanel): GroupSlice[] {
      // Each pick is its own slice here, regardless of which underlying group
      // a category belongs to - colorByGroup would give two picks from the
      // same group the same color (e.g. picking both Rent and Council Tax,
      // both under Housing), making a panel with several picks unreadable.
      // A panel gets its own independent categorical color assignment instead
      // (by pick order, so the same pick has the same color in every mode).
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
          const amount = amountFor(category, mode);
          resolved.push({
            group: category.name,
            amountPence: amount,
            color,
            categories: [
              {
                name: category.name,
                amountPence: amount,
                children: category.children
                  .map((child) => ({ name: child.name, amountPence: amountFor(child, mode) }))
                  .filter((c) => c.amountPence > 0),
              },
            ],
          });
        }
      }
      return resolved.sort((a, b) => b.amountPence - a.amountPence);
    }

    return { slices, resolvePanelSlices };
  }

  const budgeted = aggregate("budgeted");
  const spent = aggregate("spent");
  const periodLabel = view === "trend" || month === "all" ? `${year}, full year` : `${MONTH_NAMES[parseInt(month, 10) - 1] ?? month} ${year}`;
  const exportedOn = new Date().toISOString().slice(0, 10);
  const budgetedTotal = budgeted.slices.reduce((sum, s) => sum + s.amountPence, 0);
  const spentTotal = spent.slices.reduce((sum, s) => sum + s.amountPence, 0);

  const header = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <ReportViewToggle view={view} year={year} month={month} />
          <YearSwitcher year={year} years={years} basePath="/reports" extraParams={{ month, view }} />
          {view !== "trend" && <MonthSelect year={year} month={month} extraParams={{ view }} />}
          <ExportPdfButton title={`Tally report - ${VIEW_PREFIX[view]} - ${periodLabel}`} />
        </div>
        {/* On paper the controls are gone; this says what the page shows. */}
        <p className="hidden text-sm text-muted-foreground print:block">
          {VIEW_PREFIX[view]} · {periodLabel} · exported {exportedOn}
        </p>
      </div>
  );

  if (view === "trend") {
    return (
      <div className="space-y-4">
        {header}
        <TrendReport tree={buildTrendTree(data.categories, colorByGroup)} year={year} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      <div className="report-panel rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-medium">{VIEW_PREFIX[view]}</h2>
        <p className="mb-2 text-sm text-muted-foreground">
          {view === "budgeted"
            ? `Where ${formatPence(budgetedTotal, currency)} is budgeted, by broad category.`
            : view === "spent"
              ? `Where ${formatPence(spentTotal, currency)} was actually spent, by broad category.`
              : `${formatPence(budgetedTotal, currency)} budgeted, ${formatPence(spentTotal, currency)} spent, by broad category.`}
        </p>
        <ReportBody view={view} budgeted={budgeted.slices} spent={spent.slices} />
      </div>

      {panels.length < MAX_REPORT_PANELS && (
        <div className="flex justify-end pt-2 print:hidden">
          <AddReportPanelButton existingGroups={existingGroups} categories={flatCategories} />
        </div>
      )}

      {panels.map((panel) => (
        <ReportPanelCard
          key={panel.id}
          panel={panel}
          view={view}
          budgeted={budgeted.resolvePanelSlices(panel)}
          spent={spent.resolvePanelSlices(panel)}
          existingGroups={existingGroups}
          categories={flatCategories}
          periodLabel={periodLabel}
        />
      ))}
    </div>
  );
  });
}
