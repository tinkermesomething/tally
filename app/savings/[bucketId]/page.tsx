import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { getBucket, getBucketLedger } from "@/lib/db/savings";
import { getAppSettings } from "@/lib/db/settings";
import { Button } from "@/components/ui/button";
import { BucketDialog } from "@/components/savings/bucket-dialog";
import { EntryDialog } from "@/components/savings/entry-dialog";
import { ArchiveBucketButton } from "@/components/savings/bucket-actions";
import { BucketSummaryBlock } from "@/components/savings/bucket-summary";
import { SavingsLedgerTable } from "@/components/savings/ledger-table";
import { SavingsProgressChart } from "@/components/savings/progress-chart";
import { bucketPaint } from "@/lib/savings-math";
import { cn } from "@/lib/utils";
import { formatPence } from "@/lib/money";
import { withCurrentUser } from "@/lib/db/current-user";

export const dynamic = "force-dynamic";

export default async function BucketPage({ params }: { params: Promise<{ bucketId: string }> }) {
  return withCurrentUser(async () => {
  const { bucketId } = await params;
  const id = parseInt(bucketId, 10);
  if (!Number.isInteger(id)) notFound();
  const [bucket, { currency, dateFormat }] = await Promise.all([getBucket(id), getAppSettings()]);
  if (!bucket) notFound();
  const ledger = await getBucketLedger(id);
  const paint = bucketPaint(bucket);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <Link href="/savings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Savings
      </Link>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm" style={{ borderColor: `color-mix(in srgb, ${paint.accent} 55%, var(--border))` }}>
        <div className={cn("h-1.5", paint.animated && "bucket-rgb")} style={paint.fill} data-testid="bucket-stripe" aria-hidden />
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <span className={cn("size-3 rounded-full", paint.animated && "bucket-rgb")} style={paint.fill} aria-hidden />
              {bucket.name}
            </h1>
            <div className="flex items-center gap-2">
              <BucketDialog
                bucket={bucket}
                trigger={
                  <Button size="sm" variant="outline">
                    <Pencil className="size-4 text-chart-1" />
                    Edit
                  </Button>
                }
              />
              <EntryDialog bucketId={bucket.id} bucketName={bucket.name} direction="deposit" />
              <EntryDialog bucketId={bucket.id} bucketName={bucket.name} direction="withdrawal" />
              <ArchiveBucketButton bucketId={bucket.id} redirectHome />
            </div>
          </div>

          <BucketSummaryBlock bucket={bucket} paint={paint} currency={currency} dateFormat={dateFormat} today={today} />

          <p className="text-sm text-muted-foreground">
            {formatPence(bucket.depositedPence, currency)} paid in
            {bucket.withdrawnPence > 0 ? ` · ${formatPence(bucket.withdrawnPence, currency)} taken out` : ""}
            {bucket.openingPence > 0 ? ` · ${formatPence(bucket.openingPence, currency)} already saved at the start` : ""}
          </p>
          {bucket.note && <p className="text-sm text-muted-foreground">{bucket.note}</p>}
          <p className="text-xs text-muted-foreground">
            {bucket.linkedCategories.length > 0
              ? `Pays in from: ${bucket.linkedCategories.map((c) => c.name).join(", ")}`
              : "No category linked. Link one in Settings → Categories to pay in automatically."}
          </p>
        </div>
      </div>

      {ledger.entries.length > 1 && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-1 font-medium">Progress</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            {bucket.goalPence ? "Balance over time, against your goal." : "Balance over time."}
          </p>
          <SavingsProgressChart entries={ledger.entries} goalPence={bucket.goalPence} color={paint.accent} />
        </div>
      )}

      <SavingsLedgerTable bucketId={bucket.id} openingPence={ledger.openingPence} entries={ledger.entries} />
    </div>
  );
  });
}
