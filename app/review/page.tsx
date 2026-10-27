import {
  getPendingTransactions,
  getPossibleDuplicateDetails,
  getPossibleIncomeDuplicateDetails,
  getBankAccounts,
  getPendingPreview,
  getImportedDuplicateDetails,
} from "@/lib/db/bank-sync";
import { getCategoryTree, getIncomeSourceList } from "@/lib/db/queries";
import { getPeopleWithBalances } from "@/lib/db/debt";
import { getAppSettings } from "@/lib/db/settings";
import { getBuckets } from "@/lib/db/savings";
import { ReviewList } from "@/components/review/review-list";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPence } from "@/lib/money";
import { accountDisplayName, accountLabels } from "@/lib/accounts";
import { formatDate } from "@/lib/date-format";
import type { ReviewRow } from "@/components/review/review-transaction-row";
import { PencilInButton } from "@/components/review/pencil-in-button";
import { PencilInIncomeButton } from "@/components/review/pencil-in-income-button";
import { ImportCsvDialog } from "@/components/review/import-csv-dialog";
import { CSV_PROVIDER } from "@/lib/db/bank-sync";
import { isCsvMapping } from "@/lib/csv-import";
import { formatSyncTime, nextSyncSlot } from "@/lib/sync-schedule";
import { withCurrentUser } from "@/lib/db/current-user";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  return withCurrentUser(async () => {
  const { from, to } = await searchParams;

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Review</h1>
          <p className="text-sm text-muted-foreground">
            Imported bank transactions waiting for a category.
          </p>
          {hasLinked && (
            <p className="text-xs text-muted-foreground" data-testid="last-sync">
              {lastSync ? `Last synced ${formatSyncTime(lastSync)}` : "Not synced yet"}
              {appSettings.bankSyncEnabled
                ? ` · next ${formatSyncTime(nextSyncSlot(Date.now(), appSettings.bankSyncFrequencyHours))}`
                : " · automatic sync is off"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {bankAccounts.length === 0 && (
            <p className="text-xs text-muted-foreground">No bank accounts linked yet.</p>
          )}
          <ImportCsvDialog
            accounts={bankAccounts.map((a) => {
              let mapping = null;
              try {
                const parsed = a.csvMapping ? JSON.parse(a.csvMapping) : null;
                mapping = isCsvMapping(parsed) ? parsed : null;
              } catch {
                // a damaged saved mapping is ignored: the file is mapped fresh
              }
              return { id: a.id, name: accountName.get(a.id) ?? accountDisplayName(a), csvOnly: a.provider === CSV_PROVIDER, mapping };
            })}
          />
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
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
          <a href="/review" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
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
                      incomeSources={incomeSources.map((s) => ({ id: s.id, name: s.name }))}
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
        incomeSources={incomeSources.map((s) => ({ id: s.id, name: s.name }))}
        people={people.map((p) => ({ id: p.id, name: p.name }))}
        buckets={savingsBuckets.map((b) => ({ id: b.id, name: b.name }))}
      />
    </div>
  );
  });
}
