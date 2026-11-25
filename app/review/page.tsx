import {
  getPendingTransactions,
  getPossibleDuplicateDetails,
  getPossibleIncomeDuplicateDetails,
  getBankAccounts,
  getPendingPreview,
  getImportedDuplicateDetails,
} from "@/lib/db/bank-sync";
import { getAvailableYears, getCategoryTree, getEntriesForMonth, getIncomeSourceList } from "@/lib/db/queries";
import { resolvePeriodForDate } from "@/lib/db/pay-period";
import { getPeopleWithBalances } from "@/lib/db/debt";
import { getAppSettings } from "@/lib/db/settings";
import { getBuckets } from "@/lib/db/savings";
import { ReviewList } from "@/components/review/review-list";
import { EntriesTable } from "@/components/entries/entries-table";
import { ActivityTabs, type ActivityTab } from "@/components/review/activity-tabs";
import { HelpTip } from "@/components/help-tip";
import { YearSwitcher } from "@/components/grid/year-switcher";
import { MonthSelect } from "@/components/reports/month-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPence } from "@/lib/money";
import { accountLabels } from "@/lib/accounts";
import { formatDate } from "@/lib/date-format";
import type { ReviewRow } from "@/components/review/review-transaction-row";
import { PencilInButton } from "@/components/review/pencil-in-button";
import { PencilInIncomeButton } from "@/components/review/pencil-in-income-button";
import { ImportCsvDialog } from "@/components/review/import-csv-dialog";
import { toCsvAccounts } from "@/lib/csv-accounts";
import { CSV_PROVIDER } from "@/lib/db/bank-sync";
import { formatSyncTime, nextSyncSlot } from "@/lib/sync-schedule";
import { withCurrentUser } from "@/lib/db/current-user";
import { getTranslations } from "next-intl/server";
import { isDesktopMode } from "@/lib/desktop/mode";

export const dynamic = "force-dynamic";

/** Review and Entries merged into one page, "To review" / "Logged" tabs
 * kept in ?tab= (see ActivityTabs) - one nav item instead of two, with the
 * pending badge that used to sit on /review's nav link now on this one.
 * Each tab keeps its own filters (from/to vs year/month): switching tabs
 * doesn't carry them over, they mean different things on each side. */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; year?: string; month?: string }>;
}) {
  return withCurrentUser(async () => {
  const desktop = isDesktopMode();
  const { tab: tabParam, from, to, year: yearParam, month: monthParam } = await searchParams;

  // Unfiltered, regardless of tab - this is "is there anything waiting at
  // all", used for the tab badge and the smart default below, not the
  // from/to-scoped count the pending tab itself renders.
  const pendingCount = (await getPendingTransactions()).length;
  const tab: ActivityTab = tabParam === "logged" ? "logged" : tabParam === "pending" ? "pending" : pendingCount > 0 ? "pending" : "logged";

  // Awaited directly here, not rendered as `<PendingTab />`/`<LoggedTab />`
  // JSX - withCurrentUser's DB context (an AsyncLocalStorage) only stays
  // active for the lifetime of THIS callback's own promise. A JSX element
  // referencing an async component isn't invoked until React later walks
  // the returned tree, by which point this promise has already resolved
  // and the context is gone ("No user database is active for this
  // request" - hit this the hard way). Calling and awaiting the body here
  // keeps every DB read inside the context window.
  const body = tab === "pending" ? await renderPendingTab({ from, to }) : await renderLoggedTab({ yearParam, monthParam });

  // Desktop has no bank sync, so a CSV is the only way in: the button sits in
  // the header (both tabs), because a new budget has nothing pending and opens
  // on "Logged". The web app keeps it in the "To review" tab.
  const title = desktop ? (await getTranslations("nav"))("importReview") : "Review";
  const csvAccounts = desktop ? toCsvAccounts(await getBankAccounts()) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <div className="flex flex-wrap items-center gap-3">
          {desktop && <ImportCsvDialog accounts={csvAccounts} />}
          <span className="inline-flex items-center gap-1">
            <ActivityTabs tab={tab} pendingCount={pendingCount} />
            <HelpTip id="review.tabs" />
          </span>
        </div>
      </div>
      {body}
    </div>
  );
  });
}

async function renderPendingTab({ from, to }: { from?: string; to?: string }) {
  const [pending, categoryTree, incomeSources, people, bankAccounts, pendingPreview, appSettings, savingsBuckets] = await Promise.all([
    getPendingTransactions({ dateFrom: from, dateTo: to }),
    getCategoryTree(),
    getIncomeSourceList(),
    getPeopleWithBalances(),
    getBankAccounts(),
    // Returns [] naturally if there are no linked accounts - no need to
    // gate this on bankAccounts.length, which also isn't available yet
    // here (it's resolved from this SAME Promise.all).
    getPendingPreview(),
    getAppSettings(),
    getBuckets(),
  ]);

  const flatCategories = categoryTree.flatMap((c) => [
    { id: c.id, name: c.name },
    ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
  ]);

  // Newest sync across the linked (non-CSV) accounts.
  const syncTimes = bankAccounts.filter((a) => a.provider !== CSV_PROVIDER && a.lastSyncedAt).map((a) => a.lastSyncedAt!.getTime());
  const lastSync = syncTimes.length > 0 ? Math.max(...syncTimes) : null;
  const hasLinked = bankAccounts.some((a) => a.provider !== CSV_PROVIDER);

  const accounts = accountLabels(bankAccounts);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  const importedDuplicates = await getImportedDuplicateDetails(
    pending.map((t) => t.possibleDuplicateImportedId).filter((id): id is number => id !== null)
  );
  const transactions: ReviewRow[] = await Promise.all(
    pending.map(async (t) => ({
      id: t.id,
      amountPence: t.amountPence,
      bookingDate: t.bookingDate,
      payeeRaw: t.payeeRaw,
      payeeClean: t.payeeClean,
      note: t.note,
      accountId: t.bankAccountId,
      accountName: accountName.get(t.bankAccountId) ?? "Unknown account",
      importedDuplicate: t.possibleDuplicateImportedId !== null ? (importedDuplicates.get(t.possibleDuplicateImportedId) ?? null) : null,
      duplicateOf:
        t.possibleDuplicateExpenseEntryId !== null
          ? await getPossibleDuplicateDetails(t.possibleDuplicateExpenseEntryId)
          : null,
      incomeDuplicateOf:
        t.possibleDuplicateIncomeTransactionId !== null
          ? await getPossibleIncomeDuplicateDetails(t.possibleDuplicateIncomeTransactionId)
          : null,
    }))
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Imported bank transactions waiting for a category.</p>
          {hasLinked && (
            <p className="text-xs text-muted-foreground" data-testid="last-sync">
              {lastSync ? `Last synced ${formatSyncTime(lastSync)}` : "Not synced yet"}
              {appSettings.bankSyncEnabled
                ? ` · next ${formatSyncTime(nextSyncSlot(Date.now(), appSettings.bankSyncFrequencyHours))}`
                : " · automatic sync is off"}
            </p>
          )}
        </div>
        {/* Desktop shows this in the page header instead (see ReviewPage). */}
        {!isDesktopMode() && (
          <div className="flex items-center gap-3">
            {bankAccounts.length === 0 && (
              <p className="text-xs text-muted-foreground">No bank accounts linked yet.</p>
            )}
            <ImportCsvDialog accounts={toCsvAccounts(bankAccounts)} />
          </div>
        )}
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="tab" value="pending" />
        <div className="space-y-1.5">
          <Label htmlFor="review-from">From</Label>
          <Input id="review-from" name="from" type="date" defaultValue={from ?? ""} className="w-full max-w-full appearance-none" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="review-to">To</Label>
          <Input id="review-to" name="to" type="date" defaultValue={to ?? ""} className="w-full max-w-full appearance-none" />
        </div>
        <button
          type="submit"
          className="h-8 rounded-lg border border-input px-3 text-sm text-muted-foreground hover:bg-accent"
        >
          Filter
        </button>
        {(from || to) && (
          <a href="/review?tab=pending" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Clear
          </a>
        )}
      </form>

      {pendingPreview.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-dashed border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Pending at the bank - not yet settled, so not categorizable yet. Either direction can be
            pencilled in ahead of settling.
          </p>
          <div className="space-y-1">
            {pendingPreview.map((t, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span className="truncate">
                  {t.date ? formatDate(t.date, appSettings.dateFormat) : "Date pending"} ·{" "}
                  {t.payeeRaw} · {t.bankAccountName}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums">
                    {t.amountPence > 0 ? "+" : "−"}
                    {formatPence(Math.abs(t.amountPence), appSettings.currency)}
                  </span>
                  {t.pencilled && <span className="text-xs">Pencilled in</span>}
                  {t.amountPence < 0 && !t.pencilled && (
                    <PencilInButton amountPence={t.amountPence} date={t.date} payeeRaw={t.payeeRaw} categories={flatCategories} ruleMatch={t.ruleMatch} />
                  )}
                  {t.amountPence > 0 && !t.pencilled && (
                    <PencilInIncomeButton
                      amountPence={t.amountPence}
                      date={t.date}
                      payeeRaw={t.payeeRaw}
                      incomeSources={incomeSources}
                      people={people.map((p) => ({ id: p.id, name: p.name }))}
                      ruleMatch={t.incomeRuleMatch}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ReviewList
        transactions={transactions}
        accounts={accounts}
        categories={flatCategories}
        incomeSources={incomeSources}
        people={people.map((p) => ({ id: p.id, name: p.name }))}
        buckets={savingsBuckets.map((b) => ({ id: b.id, name: b.name }))}
      />
    </>
  );
}

async function renderLoggedTab({ yearParam, monthParam }: { yearParam?: string; monthParam?: string }) {
  const now = new Date();
  // Same pay-anchor-aware "current period" /grid and the old /entries used -
  // not just the raw calendar month/year, or this would default to the
  // outgoing period right after logging an anchor entry that moves you into
  // the next one (including across a year boundary).
  const nowPeriod = await resolvePeriodForDate(now.toISOString().slice(0, 10));
  const year = yearParam ? parseInt(yearParam, 10) : nowPeriod.year;
  const month = monthParam ?? String(nowPeriod.month);

  const [entries, years, categoryTree] = await Promise.all([
    getEntriesForMonth(year, month === "all" ? undefined : parseInt(month, 10)),
    getAvailableYears(),
    getCategoryTree(),
  ]);
  const categories = categoryTree.flatMap((c) => [
    { id: c.id, name: c.name },
    ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
  ]);

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <YearSwitcher year={year} years={years} basePath="/review" extraParams={{ tab: "logged", month }} />
        <MonthSelect year={year} month={month} basePath="/review" extraParams={{ tab: "logged" }} />
      </div>
      {/* keyed by period: EntriesTable keeps its rows in state (for instant
          edits/deletes), which only reads the prop once - without the key,
          switching month/year updated the dropdown but left the old rows. */}
      <EntriesTable key={`${year}-${month}`} entries={entries} categories={categories} />
    </>
  );
}
