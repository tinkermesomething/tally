import { Wallet, Banknote, PiggyBank, ReceiptText } from "lucide-react";
import { getAvailableYears, getGridData } from "@/lib/db/queries";
import { formatPence } from "@/lib/money";
import { StatCard } from "@/components/grid/stat-card";
import { LogExpenseDialog } from "@/components/grid/log-expense-dialog";
import { AddCategoryDialog } from "@/components/grid/add-category-dialog";
import { AddIncomeSourceDialog } from "@/components/grid/add-income-source-dialog";
import { CopyPreviousMonthButton } from "@/components/grid/copy-previous-month-button";
import { DesktopGridTables } from "@/components/grid/desktop-grid-tables";
import { YearSwitcher } from "@/components/grid/year-switcher";
import { MonthPager } from "@/components/grid/month-pager";
import { MobileCategoryCard } from "@/components/grid/mobile-category-card";
import { MobileIncomeCard } from "@/components/grid/mobile-income-card";
import { MobileSummaryBar } from "@/components/grid/mobile-summary-bar";
import { buildGroupColorMap, UNGROUPED } from "@/lib/group-colors";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default async function GridPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { year: yearParam, month: monthParam } = await searchParams;
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  const [data, years] = await Promise.all([getGridData(year), getAvailableYears()]);
  const groupColors = buildGroupColorMap(data.categories);
  const groupColorsObj = Object.fromEntries(groupColors);
  const existingGroups = Array.from(
    new Set(data.categories.map((c) => c.groupName).filter((g): g is string => !!g))
  );

  const now = new Date();
  const currentMonthIndex = now.getFullYear() === year ? now.getMonth() : 0;
  const monthLabel = MONTHS[currentMonthIndex];
  const subtotalNow = data.subtotalByMonth[currentMonthIndex];
  const wagesNow = data.wagesByMonth[currentMonthIndex];
  const availableNow = data.availableByMonth[currentMonthIndex];
  const remainingNow = data.remainingByMonth[currentMonthIndex];

  // Mobile month pager - independent of the "now" stat cards above, since
  // browsing a different month on a phone shouldn't move those.
  const selectedMonth = monthParam
    ? parseInt(monthParam, 10)
    : currentMonthIndex + 1;
  const selectedMonthIndex = selectedMonth - 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Budget</h1>
          <YearSwitcher year={year} years={years} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddCategoryDialog
            topLevelCategories={data.categories.map((c) => ({ id: c.id, name: c.name }))}
            existingGroups={existingGroups}
          />
          <LogExpenseDialog
            categories={data.categories.flatMap((c) => [
              { id: c.id, name: c.name },
              ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
            ])}
          />
          <AddIncomeSourceDialog />
          <CopyPreviousMonthButton year={year} month={currentMonthIndex + 1} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <StatCard label={`Spent (${monthLabel})`} value={formatPence(subtotalNow)} icon={ReceiptText} tone="neutral" />
        <StatCard label={`Income (${monthLabel})`} value={formatPence(wagesNow)} icon={Banknote} tone="neutral" />
        <StatCard
          label="Available"
          value={formatPence(availableNow)}
          icon={PiggyBank}
          tone={availableNow < 0 ? "critical" : "good"}
        />
        <StatCard
          label="Remaining to pay"
          value={formatPence(remainingNow)}
          icon={Wallet}
          tone={remainingNow > 0 ? "critical" : "good"}
        />
      </div>

      <DesktopGridTables
        categories={data.categories}
        year={year}
        groupColors={groupColorsObj}
        existingGroups={existingGroups}
        subtotalByMonth={data.subtotalByMonth}
        yearTotalSubtotal={data.yearTotal.subtotal}
        wagesByMonth={data.wagesByMonth}
        availableByMonth={data.availableByMonth}
        remainingByMonth={data.remainingByMonth}
        yearTotalWages={data.yearTotal.wages}
        yearTotalAvailable={data.yearTotal.available}
        incomeSources={data.incomeSources}
        currentMonthIndex={currentMonthIndex}
      />

      <div className="space-y-3 pb-4 md:hidden">
        <div className="flex justify-center">
          <MonthPager year={year} month={selectedMonth} />
        </div>

        <div className="space-y-2">
          {data.categories.map((category) => (
            <MobileCategoryCard
              key={category.id}
              category={category}
              year={year}
              month={selectedMonth}
              groupColor={groupColors.get(category.groupName ?? UNGROUPED)!}
              existingGroups={existingGroups}
            />
          ))}
        </div>

        <div className="space-y-2 pt-2">
          <h2 className="text-sm font-medium text-muted-foreground">Income</h2>
          {data.incomeSources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No income sources yet.</p>
          ) : (
            data.incomeSources.map((source) => (
              <MobileIncomeCard key={source.id} source={source} year={year} month={selectedMonth} />
            ))
          )}
        </div>

        <MobileSummaryBar
          subtotal={data.subtotalByMonth[selectedMonthIndex]}
          wages={data.wagesByMonth[selectedMonthIndex]}
          available={data.availableByMonth[selectedMonthIndex]}
          remaining={data.remainingByMonth[selectedMonthIndex]}
        />
      </div>
    </div>
  );
}
