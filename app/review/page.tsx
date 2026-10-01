import { getPendingTransactions, getPossibleDuplicateDetails, getBankAccounts } from "@/lib/db/bank-sync";
import { getCategoryTree } from "@/lib/db/queries";
import { getPeopleWithBalances } from "@/lib/db/debt";
import { ReviewList } from "@/components/review/review-list";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReviewRow } from "@/components/review/review-transaction-row";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;

  const [pending, categoryTree, people, bankAccounts] = await Promise.all([
    getPendingTransactions({ dateFrom: from, dateTo: to }),
    getCategoryTree(),
    getPeopleWithBalances(),
    getBankAccounts(),
  ]);

  const flatCategories = categoryTree.flatMap((c) => [
    { id: c.id, name: c.name },
    ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
  ]);

  const transactions: ReviewRow[] = await Promise.all(
    pending.map(async (t) => ({
      id: t.id,
      amountPence: t.amountPence,
      bookingDate: t.bookingDate,
      payeeRaw: t.payeeRaw,
      payeeClean: t.payeeClean,
      duplicateOf:
        t.possibleDuplicateExpenseEntryId !== null
          ? await getPossibleDuplicateDetails(t.possibleDuplicateExpenseEntryId)
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
        </div>
        {bankAccounts.length === 0 && (
          <p className="text-xs text-muted-foreground">No bank accounts linked yet.</p>
        )}
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

      <ReviewList transactions={transactions} categories={flatCategories} people={people.map((p) => ({ id: p.id, name: p.name }))} />
    </div>
  );
}
