import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { getHouseholdGrid, getHouseholdIncomeGrid, getHouseholdYears, isHouseholdEnabled } from "@/lib/db/household";
import { getAppSettings } from "@/lib/db/settings";
import { formatPence } from "@/lib/money";
import { StatCard } from "@/components/grid/stat-card";
import { CategoryPieChart, type GroupSlice } from "@/components/reports/category-pie-chart";
import { YearSwitcher } from "@/components/grid/year-switcher";
import { HouseholdGridTable } from "@/components/household/household-grid-table";
import { HouseholdIncomeTable } from "@/components/household/household-income-table";
import { GROUP_PALETTE } from "@/lib/group-colors";
import { withCurrentUser } from "@/lib/db/current-user";

export const dynamic = "force-dynamic";

export default async function HouseholdPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  return withCurrentUser(async () => {
    if (!(await isHouseholdEnabled())) redirect("/grid");

    const { year: yearParam } = await searchParams;
    const years = await getHouseholdYears();
    const year = yearParam ? parseInt(yearParam, 10) : years[0];

    const [grid, incomeGrid, { currency }] = await Promise.all([getHouseholdGrid(year), getHouseholdIncomeGrid(year), getAppSettings()]);

    const yearBudgetedPence = grid.reduce((s, r) => s + r.yearBudgetedPence, 0);
    const yearSpentPence = grid.reduce((s, r) => s + r.yearSpentPence, 0);
    const yearIncomePence = incomeGrid.reduce((s, r) => s + r.yearTotalPence, 0);

    const slices: GroupSlice[] = grid
      .filter((r) => r.yearSpentPence > 0)
      .map((r, i) => ({ group: r.categoryName, amountPence: r.yearSpentPence, color: GROUP_PALETTE[i % GROUP_PALETTE.length], categories: [] }));

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Household</h1>
            <p className="text-sm text-muted-foreground">
              What each person has shared, combined - a copy of the Budget page&apos;s own shape. Editing happens on the
              sharing person&apos;s own Grid, Entries or Income page, not here.
            </p>
          </div>
          <YearSwitcher year={year} years={years} basePath="/household" />
        </div>

        <div className="flex flex-wrap gap-2">
          <StatCard label="Shared budgeted" value={formatPence(yearBudgetedPence, currency)} icon={Wallet} tone="neutral" />
          <StatCard label="Shared spent" value={formatPence(yearSpentPence, currency)} icon={Wallet} tone="critical" />
          <StatCard label="Shared income" value={formatPence(yearIncomePence, currency)} icon={Wallet} tone="good" />
        </div>

        {slices.length > 1 && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-1 font-medium">Shared spending by category</h2>
            <CategoryPieChart slices={slices} compact />
          </div>
        )}

        <HouseholdGridTable rows={grid} year={year} />
        <HouseholdIncomeTable rows={incomeGrid} year={year} />
      </div>
    );
  });
}
