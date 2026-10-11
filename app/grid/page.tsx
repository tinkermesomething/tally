import { Wallet, Banknote, PiggyBank, ReceiptText } from "lucide-react";
import { getAvailableYears, getGridData } from "@/lib/db/queries";
import { getPeopleWithBalances } from "@/lib/db/debt";
import { getAppSettings } from "@/lib/db/settings";
import { resolvePeriodForDate } from "@/lib/db/pay-period";
import { formatPence } from "@/lib/money";
import { StatCard } from "@/components/grid/stat-card";
import { LogExpenseDialog } from "@/components/grid/log-expense-dialog";
import { AddIncomeDialog } from "@/components/grid/add-income-dialog";
import { DesktopGridTables } from "@/components/grid/desktop-grid-tables";
import { YearSwitcher } from "@/components/grid/year-switcher";
import { GridWidthToggle } from "@/components/grid/grid-width-toggle";
import { ExportGridButton } from "@/components/grid/export-grid-button";
import { GRID_CSV_VIEWS, gridToCsv, type GridCsvView } from "@/lib/grid-csv";
import { MonthPager } from "@/components/grid/month-pager";
import { MobileCategoryCard } from "@/components/grid/mobile-category-card";
import { MobileIncomeCard } from "@/components/grid/mobile-income-card";
import { MobileSummaryBar } from "@/components/grid/mobile-summary-bar";
import { buildGroupColorMap, UNGROUPED } from "@/lib/group-colors";
import { MONTH_ABBREVIATIONS as MONTHS } from "@/lib/months";
import { withCurrentUser } from "@/lib/db/current-user";

export default async function GridPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  return withCurrentUser(async () => {
  const { year: yearParam, month: monthParam } = await searchParams;
  // "Now" is whatever budget period today's date resolves to through the
  // pay anchor (see lib/db/pay-period.ts) - not just the raw calendar
  // year/month. Once you log a pay-anchor entry that shifts the boundary
  // (e.g. October's wages received Sept 30, or a Dec 30 entry anchored
  // into next January), the default year and the stat cards both need to
  // follow that shift the same way every other logged entry already does,
  // or they'd keep showing the outgoing period after you've functionally
  // moved into the next one.
  const nowPeriod = await resolvePeriodForDate(new Date().toISOString().slice(0, 10));
  const year = yearParam ? parseInt(yearParam, 10) : nowPeriod.year;
  const [data, years, people, { currency }] = await Promise.all([
    getGridData(year),
    getAvailableYears(),
    getPeopleWithBalances(),
    getAppSettings(),
  ]);
  const groupColors = buildGroupColorMap(data.categories);
  const groupColorsObj = Object.fromEntries(groupColors);
  const existingGroups = Array.from(
    new Set(data.categories.map((c) => c.groupName).filter((g): g is string => !!g))
  );

  const currentMonthIndex = nowPeriod.year === year ? nowPeriod.month - 1 : 0;
  const monthLabel = MONTHS[currentMonthIndex];
  const plannedNow = data.plannedByMonth[currentMonthIndex];
  const wagesNow = data.wagesByMonth[currentMonthIndex];
  const availableNow = data.availableByMonth[currentMonthIndex];
  const leftToSpendNow = data.leftToSpendByMonth[currentMonthIndex];
  const carryOverNow = data.carryOverByMonth[currentMonthIndex];
  const prevMonthLabel = MONTHS[(currentMonthIndex + 11) % 12];

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
          <LogExpenseDialog
            categories={data.categories.flatMap((c) => [
              { id: c.id, name: c.name },
              ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
            ])}
            people={people.map((p) => ({ id: p.id, name: p.name }))}
          />
          <AddIncomeDialog
            incomeSources={data.incomeSources.map((s) => ({
              id: s.id,
              name: s.name,
              isPayAnchor: s.isPayAnchor,
            }))}
            people={people.map((p) => ({ id: p.id, name: p.name }))}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <StatCard
            label={`Budgeted (${monthLabel})`}
            value={formatPence(plannedNow, currency)}
            icon={ReceiptText}
            tone="neutral"
            className="w-full justify-center sm:w-auto sm:justify-start"
          />
          <StatCard
            label={`Income (${monthLabel})`}
            value={formatPence(wagesNow, currency)}
            icon={Banknote}
            tone="neutral"
            className="w-full justify-center sm:w-auto sm:justify-start"
          />
          <StatCard
            label="Available"
            value={formatPence(availableNow, currency)}
            icon={PiggyBank}
            tone={availableNow < 0 ? "critical" : "good"}
            className="w-full justify-center sm:w-auto sm:justify-start"
          />
          <StatCard
            label="Left to spend"
            value={formatPence(leftToSpendNow, currency)}
            icon={Wallet}
            tone={leftToSpendNow < 0 ? "critical" : "good"}
            className="w-full justify-center sm:w-auto sm:justify-start"
          />
        </div>
        <div className="flex items-center gap-2">
          <GridWidthToggle iconOnly />
          <ExportGridButton
            year={year}
            csv={Object.fromEntries(GRID_CSV_VIEWS.map((v) => [v.id, gridToCsv(data, v.id, currency)])) as Record<GridCsvView, string>}
          />
        </div>
      </div>

      {carryOverNow !== 0 && (
        <p className="text-xs text-muted-foreground">
          Left to spend {carryOverNow > 0 ? "includes" : "is reduced by"}{" "}
          <span className={carryOverNow > 0 ? "text-status-good" : "text-status-critical"}>
            {formatPence(Math.abs(carryOverNow), currency)}
          </span>{" "}
          carried over from {prevMonthLabel}.
        </p>
      )}

      <DesktopGridTables
        categories={data.categories}
        year={year}
        groupColors={groupColorsObj}
        existingGroups={existingGroups}
        topLevelCategories={data.categories.map((c) => ({ id: c.id, name: c.name }))}
        subtotalByMonth={data.subtotalByMonth}
        yearTotalSubtotal={data.yearTotal.subtotal}
        plannedByMonth={data.plannedByMonth}
        yearTotalPlanned={data.yearTotal.planned}
        wagesByMonth={data.wagesByMonth}
        availableByMonth={data.availableByMonth}
        actuallySpentByMonth={data.actuallySpentByMonth}
        leftToSpendByMonth={data.leftToSpendByMonth}
        yearTotalWages={data.yearTotal.wages}
        yearTotalAvailable={data.yearTotal.available}
        yearTotalActuallySpent={data.yearTotal.actuallySpent}
        yearTotalLeftToSpend={data.yearTotal.leftToSpend}
        incomeSources={data.incomeSources}
        currentMonthIndex={currentMonthIndex}
        highlightMonthIndex={nowPeriod.year === year ? nowPeriod.month - 1 : null}
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
          planned={data.plannedByMonth[selectedMonthIndex]}
          wages={data.wagesByMonth[selectedMonthIndex]}
          available={data.availableByMonth[selectedMonthIndex]}
          leftToSpend={data.leftToSpendByMonth[selectedMonthIndex]}
          currency={currency}
        />
      </div>
    </div>
  );
  });
}
