import { CheckCircle2, CalendarClock } from "lucide-react";
import { formatPence } from "@/lib/money";
import { formatDate, type DateFormat } from "@/lib/date-format";
import { goalStatus, progressPercent, type BucketPaint } from "@/lib/savings-math";
import { ProgressBar } from "@/components/savings/progress-bar";
import type { BucketSummary } from "@/lib/db/savings";

/** Balance, goal progress and the goal-date line - shared by the list card
 * and the bucket's own page so they can never disagree. */
export function BucketSummaryBlock({
  bucket,
  paint,
  currency,
  dateFormat,
  today,
}: {
  bucket: BucketSummary;
  paint: BucketPaint;
  currency: string;
  dateFormat: DateFormat;
  today: string;
}) {
  const percent = progressPercent(bucket.balancePence, bucket.goalPence);
  const status = goalStatus(bucket, today);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tabular-nums" data-testid="bucket-balance">
          {formatPence(bucket.balancePence, currency)}
        </span>
        {bucket.goalPence && (
          <span className="text-sm text-muted-foreground">of {formatPence(bucket.goalPence, currency)}</span>
        )}
      </div>

      {percent !== null && (
        <div className="flex items-center gap-2">
          <ProgressBar percent={percent} paint={paint} label={`${bucket.name} progress`} />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{Math.round(percent)}%</span>
        </div>
      )}

      {status.kind === "reached" && (
        <p className="flex items-center gap-1.5 text-sm text-status-good">
          <CheckCircle2 className="size-4" />
          Goal reached
        </p>
      )}
      {status.kind === "on-the-way" && bucket.goalDate && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground" data-testid="goal-line">
          <CalendarClock className="size-4 shrink-0 text-chart-1" />
          {bucket.goalPence ? (
            <span>
              {formatPence(status.remainingPence, currency)} to go by {formatDate(bucket.goalDate, dateFormat)}
              {" · "}
              <span className="font-medium text-foreground">{formatPence(status.perMonthPence, currency)} a month</span>
            </span>
          ) : (
            <span>
              {status.daysLeft} {status.daysLeft === 1 ? "day" : "days"} to {formatDate(bucket.goalDate, dateFormat)}
            </span>
          )}
        </p>
      )}
      {status.kind === "overdue" && bucket.goalDate && (
        <p className="flex items-center gap-1.5 text-sm text-status-critical" data-testid="goal-line">
          <CalendarClock className="size-4 shrink-0" />
          Goal date {formatDate(bucket.goalDate, dateFormat)} passed {status.daysLate} {status.daysLate === 1 ? "day" : "days"} ago
          {bucket.goalPence ? ` · ${formatPence(status.remainingPence, currency)} still to go` : ""}
        </p>
      )}
      {status.kind === "none" && bucket.goalPence && bucket.balancePence < bucket.goalPence && (
        <p className="text-sm text-muted-foreground">{formatPence(bucket.goalPence - bucket.balancePence, currency)} to go</p>
      )}
      {status.kind === "none" && bucket.goalPence && bucket.balancePence >= bucket.goalPence && (
        <p className="flex items-center gap-1.5 text-sm text-status-good">
          <CheckCircle2 className="size-4" />
          Goal reached
        </p>
      )}
    </div>
  );
}
