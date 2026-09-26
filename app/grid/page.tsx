import { Wallet, Banknote, PiggyBank, ReceiptText } from "lucide-react";
import { getAvailableYears, getGridData } from "@/lib/db/queries";
import { formatPence } from "@/lib/money";
import { CategoryRow } from "@/components/grid/category-row";
import { StatCard } from "@/components/grid/stat-card";
import { LogExpenseDialog } from "@/components/grid/log-expense-dialog";
import { AddCategoryDialog } from "@/components/grid/add-category-dialog";
import { IncomeTable } from "@/components/grid/income-table";
import { YearSwitcher } from "@/components/grid/year-switcher";
import { ScrollFade } from "@/components/scroll-fade";
import { buildGroupColorMap, UNGROUPED } from "@/lib/group-colors";
import { cn, FLOATING_PANEL_EDGE, floatingPanelFill } from "@/lib/utils";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// table-layout: fixed + an explicit <colgroup> makes every column's width
// deterministic (content can never renegotiate it), which is what makes the
// two sticky trailing columns' `right` offsets line up exactly instead of
// drifting apart based on guessed widths.
const CATEGORY_COL_WIDTH = 168;
const MONTH_COL_WIDTH = 130;
const SUMMARY_COL_WIDTH = 132;
const TABLE_WIDTH =
  CATEGORY_COL_WIDTH + MONTH_COL_WIDTH * 12 + SUMMARY_COL_WIDTH * 2;

export default async function GridPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  const [data, years] = await Promise.all([getGridData(year), getAvailableYears()]);
  const groupColors = buildGroupColorMap(data.categories);
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

  const footerRows: {
    label: string;
    values: number[];
    total: number;
    showAverage: boolean;
  }[] = [
    { label: "SUBTOTAL", values: data.subtotalByMonth, total: data.yearTotal.subtotal, showAverage: true },
    { label: "WAGES", values: data.wagesByMonth, total: data.yearTotal.wages, showAverage: true },
    { label: "AVAILABLE", values: data.availableByMonth, total: data.yearTotal.available, showAverage: true },
    {
      label: "Remaining this month",
      values: data.remainingByMonth,
      total: data.remainingByMonth.reduce((a, b) => a + b, 0),
      showAverage: false,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Budget</h1>
          <YearSwitcher year={year} years={years} />
        </div>
        <div className="flex items-center gap-2">
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

      <ScrollFade
        className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm"
        leftInset={CATEGORY_COL_WIDTH}
        rightInset={SUMMARY_COL_WIDTH * 2}
      >
        <table
          className="border-collapse text-sm"
          style={{ tableLayout: "fixed", width: TABLE_WIDTH }}
        >
          <colgroup>
            <col style={{ width: CATEGORY_COL_WIDTH }} />
            {MONTHS.map((m) => (
              <col key={m} style={{ width: MONTH_COL_WIDTH }} />
            ))}
            <col style={{ width: SUMMARY_COL_WIDTH }} />
            <col style={{ width: SUMMARY_COL_WIDTH }} />
          </colgroup>
          <thead>
            <tr className="bg-muted">
              <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">
                Category
              </th>
              {MONTHS.map((m) => (
                <th key={m} className="px-3 py-2 text-right font-medium">
                  {m}
                </th>
              ))}
              <th
                style={{ right: SUMMARY_COL_WIDTH, backgroundColor: floatingPanelFill("--muted") }}
                className={cn("sticky z-10 px-3 py-2 text-right font-medium", FLOATING_PANEL_EDGE)}
              >
                Year Total
              </th>
              <th
                style={{ right: 0, backgroundColor: floatingPanelFill("--muted") }}
                className="sticky z-10 px-3 py-2 text-right font-medium"
              >
                Monthly avg
              </th>
            </tr>
          </thead>
          <tbody>
            {data.categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                year={year}
                summaryColWidth={SUMMARY_COL_WIDTH}
                groupColor={groupColors.get(category.groupName ?? UNGROUPED)!}
                existingGroups={existingGroups}
              />
            ))}
          </tbody>
          <tfoot>
            {footerRows.map((row) => (
              <tr key={row.label} className="border-t border-border bg-secondary font-medium">
                <td className="sticky left-0 z-10 bg-secondary px-3 py-2">{row.label}</td>
                {row.values.map((value, i) => (
                  <td
                    key={i}
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      row.label === "AVAILABLE" &&
                        (value < 0 ? "text-status-critical" : "text-status-good")
                    )}
                  >
                    {formatPence(value)}
                  </td>
                ))}
                <td
                  style={{ right: SUMMARY_COL_WIDTH, backgroundColor: floatingPanelFill("--secondary") }}
                  className={cn("sticky z-10 px-3 py-2 text-right font-bold tabular-nums", FLOATING_PANEL_EDGE)}
                >
                  {formatPence(row.total)}
                </td>
                <td
                  style={{ right: 0, backgroundColor: floatingPanelFill("--secondary") }}
                  className="sticky z-10 px-3 py-2 text-right font-bold tabular-nums"
                >
                  {row.showAverage ? formatPence(Math.round(row.total / 12)) : "—"}
                </td>
              </tr>
            ))}
          </tfoot>
        </table>
      </ScrollFade>

      <IncomeTable
        sources={data.incomeSources}
        year={year}
        totalByMonth={data.wagesByMonth}
        categoryColWidth={CATEGORY_COL_WIDTH}
        monthColWidth={MONTH_COL_WIDTH}
        summaryColWidth={SUMMARY_COL_WIDTH}
      />
    </div>
  );
}
