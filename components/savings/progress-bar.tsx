import { cn } from "@/lib/utils";
import type { BucketPaint } from "@/lib/savings-math";

/** A thin goal bar in the bucket's own colour(s). role=progressbar so it is
 * announced, and the percentage is always printed beside it (never colour
 * alone). */
export function ProgressBar({ percent, paint, label }: { percent: number; paint: BucketPaint; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full transition-[width]", paint.animated && "bucket-rgb")}
        style={{ width: `${percent}%`, ...paint.fill }}
      />
    </div>
  );
}
