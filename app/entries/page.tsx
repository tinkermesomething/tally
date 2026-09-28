import { getAvailableYears, getExpenseEntriesForMonth } from "@/lib/db/queries";
import { YearSwitcher } from "@/components/grid/year-switcher";
import { MonthSelect } from "@/components/reports/month-select";
import { EntriesTable } from "@/components/entries/entries-table";

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { year: yearParam, month: monthParam } = await searchParams;
  const now = new Date();
  const year = yearParam ? parseInt(yearParam, 10) : now.getFullYear();
  // Unlike Reports (defaults to "all"), this defaults to the current month -
  // a ledger of logged expenses is naturally read a month at a time.
  const month = monthParam ?? String(now.getMonth() + 1);

  const [entries, years] = await Promise.all([
    getExpenseEntriesForMonth(year, month === "all" ? undefined : parseInt(month, 10)),
    getAvailableYears(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Logged entries</h1>
        <div className="flex items-center gap-2">
          <YearSwitcher year={year} years={years} basePath="/entries" extraParams={{ month }} />
          <MonthSelect year={year} month={month} basePath="/entries" />
        </div>
      </div>
      <EntriesTable entries={entries} />
    </div>
  );
}
