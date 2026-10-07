"use client";

import { useState, useTransition } from "react";
import { PiggyBank } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { runAction } from "@/lib/action-result";
import { linkCategory } from "@/app/savings/actions";
import { linkCategoryTagging, previewCategoryTags } from "@/app/grid/actions";
import { LinkTaggingDialog, type LinkTarget } from "@/components/settings/link-tagging-dialog";

const NONE = "none";

/** Links a category to a savings bucket: every expense in it then pays into
 * the bucket. If the category already has expenses that would count, they are
 * offered as a ticked list so the past ones can be added at the same time;
 * unlinking is immediate and keeps the deposits already made. */
export function EditableBucketLink({
  categoryId,
  categoryName,
  linkedBucketId,
  buckets,
}: {
  categoryId: number;
  categoryName: string;
  linkedBucketId: number | null;
  buckets: { id: number; name: string; color: string }[];
}) {
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const current = buckets.find((b) => b.id === linkedBucketId);

  function handleChange(value: string | null) {
    if (!value || value === NONE) {
      if (linkedBucketId === null) return;
      startTransition(async () => {
        await runAction(() => linkCategory(categoryId, null));
      });
      return;
    }
    const next = parseInt(value, 10);
    if (next === linkedBucketId) return;
    setError(null);
    startTransition(async () => {
      const link = { savingsBucketId: next };
      const preview = await previewCategoryTags(categoryId, link);
      if (!preview.ok) return setError(preview.error);
      if (preview.total === 0) {
        const res = await linkCategoryTagging(categoryId, link, []);
        if (!res.ok) setError(res.error);
        return;
      }
      setTarget({ link, name: buckets.find((b) => b.id === next)?.name ?? "this bucket", kind: "savings", rows: preview.rows, total: preview.total });
    });
  }

  return (
    <>
      <Select value={current ? String(current.id) : NONE} onValueChange={handleChange}>
        <SelectTrigger
          size="sm"
          aria-label={`Savings bucket for ${categoryName}`}
          className={cn(
            "h-auto w-auto gap-1 rounded-full border-0 bg-transparent px-1.5 py-0.5 text-[0.65rem]",
            current
              ? "text-muted-foreground hover:bg-accent"
              : "border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-muted-foreground"
          )}
        >
          <SelectValue>
            {(value: string) =>
              value === NONE ? (
                "+ pay into savings bucket"
              ) : (
                <span className="inline-flex items-center gap-1">
                  <PiggyBank className="size-3" style={{ color: current?.color }} />
                  {buckets.find((b) => String(b.id) === value)?.name ?? "Unknown"}
                </span>
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not linked to a bucket</SelectItem>
          {buckets.map((b) => (
            <SelectItem key={b.id} value={String(b.id)}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error && (
        <span role="alert" className="text-[0.65rem] text-status-critical">
          {error}
        </span>
      )}
      <LinkTaggingDialog categoryId={categoryId} categoryName={categoryName} target={target} onClose={() => setTarget(null)} />
    </>
  );
}
