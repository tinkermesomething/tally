import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { getHouseholdGrid, getHouseholdIncomeGrid, getHouseholdYears, isHouseholdEnabled, reconcileHouseholdDataForUser } from "@/lib/db/household";
import { getAppSettings } from "@/lib/db/settings";
import { getGroupStyles } from "@/lib/db/groups";
import { formatPence } from "@/lib/money";
import { StatCard } from "@/components/grid/stat-card";
import { CategoryPieChart, type GroupSlice } from "@/components/reports/category-pie-chart";
import { VarianceChart } from "@/components/reports/variance-chart";
import { MonthSelect } from "@/components/reports/month-select";
import { buildVarianceRows } from "@/lib/report-view";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { YearSwitcher } from "@/components/grid/year-switcher";
import { GridWidthToggle } from "@/components/grid/grid-width-toggle";
import { HouseholdExportButton } from "@/components/household/household-export-button";
import { HouseholdDesktopTables } from "@/components/household/household-desktop-tables";
import { HOUSEHOLD_CSV_VIEWS, householdGridToCsv, type HouseholdCsvView } from "@/lib/household-csv";
import { buildGroupColorMap, GROUP_PALETTE } from "@/lib/group-colors";
import { MONTH_NAMES } from "@/lib/months";
import { withCurrentUser } from "@/lib/db/current-user";
import type { HouseholdGridRow } from "@/lib/db/household";

export const dynamic = "force-dynamic";

export default async function HouseholdPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  return withCurrentUser(async (user) => {
    if (!(await isHouseholdEnabled())) redirect("/grid");

    // Every other mutation path (logging/editing an expense, changing a
    // budgeted figure) only reaches the household tables via the 15-minute
    // scheduled-sync tick - fine as a backstop, but it means opening this
    // page right after editing your own shared numbers can show them as
    // stale for up to 15 minutes. Reconciling the VIEWER's own data here
    // closes that gap for the one person actually looking at the page;
    // reconcileHouseholdDataForUser is already a cheap full-rebuild (see
    // lib/db/household.ts), the same operation the scheduled tick runs.
    await reconcileHouseholdDataForUser(user.id);

    const { year: yearParam, month: monthParam } = await searchParams;
    const years = await getHouseholdYears();
    const year = yearParam ? parseInt(yearParam, 10) : years[0];
    const month = monthParam ?? "all"; // "all" | "1".."12" - same convention as Reports' MonthSelect

    const [grid, incomeGrid, { currency }, groupStyles] = await Promise.all([
      getHouseholdGrid(year),
      getHouseholdIncomeGrid(year),
      getAppSettings(),
      getGroupStyles(),
    ]);
    const groupColors = buildGroupColorMap(grid, groupStyles);

    const yearBudgetedPence = grid.reduce((s, r) => s + r.yearBudgetedPence, 0);
    const yearSpentPence = grid.reduce((s, r) => s + r.yearSpentPence, 0);
    const yearIncomePence = incomeGrid.reduce((s, r) => s + r.yearTotalPence, 0);

    // Both chart views need the SAME month scoping (a whole-year pie is
    // too coarse to mean much - see MonthSelect below) - "all" reads the
    // row's own year total, otherwise just that one month's cell. Colour
    // is assigned once per category, from the full (unfiltered) list, so a
    // category keeps the same colour whether it ends up in the budgeted
    // slice, the spent slice, both, or neither this month - a per-filtered-
    // list index would reassign colours every time the month changes.
    const field = (r: HouseholdGridRow, key: "budgetedPence" | "spentPence") =>
      month === "all" ? r[key === "budgetedPence" ? "yearBudgetedPence" : "yearSpentPence"] : r.months[parseInt(month, 10)][key];
    const categoryColor = new Map(grid.map((r, i) => [r.categoryName, GROUP_PALETTE[i % GROUP_PALETTE.length]]));
    const budgetedSlices: GroupSlice[] = grid
      .filter((r) => field(r, "budgetedPence") > 0)
      .map((r) => ({ group: r.categoryName, amountPence: field(r, "budgetedPence"), color: categoryColor.get(r.categoryName)!, categories: [] }));
    const spentSlices: GroupSlice[] = grid
      .filter((r) => field(r, "spentPence") > 0)
      .map((r) => ({ group: r.categoryName, amountPence: field(r, "spentPence"), color: categoryColor.get(r.categoryName)!, categories: [] }));
    const varianceRows = buildVarianceRows(budgetedSlices, spentSlices);
    const periodLabel = month === "all" ? `${year}, full year` : `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;

    // No pay-period anchor here (that's a per-user concept, this is a
    // cross-user aggregate) - just the plain calendar month, same as what
    // "now" means to a wall clock.
    const now = new Date();
    const currentMonthIndex = now.getFullYear() === year ? now.getMonth() : 0;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Household</h1>
              <p className="text-sm text-muted-foreground">
                What each person has shared, combined - a copy of the Budget page&apos;s own shape. Editing happens on the
                sharing person&apos;s own Grid, Entries or Income page, not here.
              </p>
            </div>
            <YearSwitcher year={year} years={years} basePath="/household" extraParams={{ month }} />
            <MonthSelect year={year} month={month} basePath="/household" />
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <StatCard label="Shared budgeted" value={formatPence(yearBudgetedPence, currency)} icon={Wallet} tone="neutral" />
            <StatCard label="Shared spent" value={formatPence(yearSpentPence, currency)} icon={Wallet} tone="critical" />
            <StatCard label="Shared income" value={formatPence(yearIncomePence, currency)} icon={Wallet} tone="good" />
          </div>
          <div className="flex items-center gap-2">
            <GridWidthToggle target="household budget" iconOnly />
            <HouseholdExportButton
              year={year}
              csv={Object.fromEntries(HOUSEHOLD_CSV_VIEWS.map((v) => [v.id, householdGridToCsv(grid, incomeGrid, year, v.id, currency)])) as Record<HouseholdCsvView, string>}
            />
          </div>
        </div>

        {(budgetedSlices.length > 0 || spentSlices.length > 0) && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <Tabs defaultValue="category">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="category">Shared spending by category</TabsTrigger>
                  <TabsTrigger value="variance">Spent vs budgeted</TabsTrigger>
                </TabsList>
                <span className="text-xs text-muted-foreground">{periodLabel}</span>
              </div>
              <TabsContent value="category">
                {spentSlices.length > 1 ? (
                  <CategoryPieChart slices={spentSlices} compact />
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">Not enough spending in this period for a breakdown.</p>
                )}
              </TabsContent>
              <TabsContent value="variance">
                <VarianceChart rows={varianceRows} />
              </TabsContent>
            </Tabs>
          </div>
        )}

        <HouseholdDesktopTables grid={grid} incomeGrid={incomeGrid} year={year} groupColors={groupColors} currentMonthIndex={currentMonthIndex} />
      </div>
    );
  });
}
