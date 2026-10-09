import { getAvailableYears, getExpenseEntriesForMonth } from "@/lib/db/queries";
import { resolvePeriodForDate } from "@/lib/db/pay-period";
import { YearSwitcher } from "@/components/grid/year-switcher";
import { MonthSelect } from "@/components/reports/month-select";
import { EntriesTable } from "@/components/entries/entries-table";
import { withCurrentUser } from "@/lib/db/current-user";

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  return withCurrentUser(async () => {
  const { year: yearParam, month: monthParam } = await searchParams;
  const now = new Date();
  // Unlike Reports (defaults to "all"), this defaults to the current month -
  // a ledger of logged expenses is naturally read a month at a time. "Current"
  // follows the pay anchor (lib/db/pay-period.ts), same as /grid's stat
  // cards - not just the raw calendar month/year, or this would default to
  // the outgoing period right after logging an anchor entry that moves you
  // into the next one (including across a year boundary, e.g. a Dec 30
  // entry anchored to next January).
  const nowPeriod = await resolvePeriodForDate(now.toISOString().slice(0, 10));
  const year = yearParam ? parseInt(yearParam, 10) : nowPeriod.year;
  const month = monthParam ?? String(nowPeriod.month);

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
      {/* keyed by period: EntriesTable keeps its rows in state (for instant
          edits/deletes), which only reads the prop once - without the key,
          switching month/year updated the dropdown but left the old rows. */}
      <EntriesTable key={`${year}-${month}`} entries={entries} />
    </div>
  );
  });
}
