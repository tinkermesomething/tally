import Link from "next/link";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BucketDialog } from "@/components/savings/bucket-dialog";
import { EntryDialog } from "@/components/savings/entry-dialog";
import { ArchiveBucketButton } from "@/components/savings/bucket-actions";
import { BucketSummaryBlock } from "@/components/savings/bucket-summary";
import { bucketPaint } from "@/lib/savings-math";
import { cn } from "@/lib/utils";
import type { DateFormat } from "@/lib/date-format";
import type { BucketSummary } from "@/lib/db/savings";

export function BucketCard({
  bucket,
  currency,
  dateFormat,
  today,
}: {
  bucket: BucketSummary;
  currency: string;
  dateFormat: DateFormat;
  today: string;
}) {
  const paint = bucketPaint(bucket);
  return (
    <div
      data-testid="bucket-card"
      className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm"
      style={{ borderColor: `color-mix(in srgb, ${paint.accent} 55%, var(--border))` }}
    >
      <div className={cn("h-1.5", paint.animated && "bucket-rgb")} style={paint.fill} data-testid="bucket-stripe" aria-hidden />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/savings/${bucket.id}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
            <span className={cn("size-2.5 shrink-0 rounded-full", paint.animated && "bucket-rgb")} style={paint.fill} aria-hidden />
            <span className="truncate">{bucket.name}</span>
          </Link>
          <div className="flex shrink-0 items-center">
            <BucketDialog
              bucket={bucket}
              trigger={
                <Button size="icon-xs" variant="ghost" title="Edit bucket" aria-label="Edit bucket">
                  <Pencil className="size-3.5 text-chart-1" />
                </Button>
              }
            />
            <ArchiveBucketButton bucketId={bucket.id} />
          </div>
        </div>

        <BucketSummaryBlock bucket={bucket} paint={paint} currency={currency} dateFormat={dateFormat} today={today} />

        {bucket.note && <p className="text-xs text-muted-foreground">{bucket.note}</p>}

        <p className="text-xs text-muted-foreground" data-testid="linked-categories">
          {bucket.linkedCategories.length > 0
            ? `Pays in from: ${bucket.linkedCategories.map((c) => c.name).join(", ")}`
            : "No category linked. Link one in Settings → Categories to pay in automatically."}
        </p>

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <EntryDialog bucketId={bucket.id} bucketName={bucket.name} direction="deposit" />
          <EntryDialog bucketId={bucket.id} bucketName={bucket.name} direction="withdrawal" />
        </div>
      </div>
    </div>
  );
}
