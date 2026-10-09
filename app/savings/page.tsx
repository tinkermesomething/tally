import { PiggyBank, Wallet } from "lucide-react";
import { getArchivedBuckets, getBuckets } from "@/lib/db/savings";
import { getAppSettings } from "@/lib/db/settings";
import { formatPence } from "@/lib/money";
import { StatCard } from "@/components/grid/stat-card";
import { AddBucketButton } from "@/components/savings/bucket-dialog";
import { BucketCard } from "@/components/savings/bucket-card";
import { ArchivedList } from "@/components/settings/archived-list";
import { restoreBucket } from "@/app/savings/actions";
import { withCurrentUser } from "@/lib/db/current-user";

// Always live - never statically prerendered.
export const dynamic = "force-dynamic";

export default async function SavingsPage() {
  return withCurrentUser(async () => {
  const [buckets, archived, { currency, dateFormat }] = await Promise.all([getBuckets(), getArchivedBuckets(), getAppSettings()]);
  const total = buckets.reduce((sum, b) => sum + b.balancePence, 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Savings</h1>
        <AddBucketButton />
      </div>

      {buckets.length > 0 && <StatCard label="Saved across all buckets" value={formatPence(total, currency)} icon={Wallet} tone="good" />}

      {buckets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <PiggyBank className="size-6" />
          <p>No savings buckets yet. Create one for kids&apos; savings, a holiday, a Revolut pot…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {buckets.map((b) => (
            <BucketCard key={b.id} bucket={b} currency={currency} dateFormat={dateFormat} today={today} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="pt-2">
          <h2 className="pb-1 text-sm font-medium text-muted-foreground">Archived</h2>
          <ArchivedList items={archived} restoreAction={restoreBucket} emptyLabel="No archived buckets." />
        </div>
      )}
    </div>
  );
  });
}
