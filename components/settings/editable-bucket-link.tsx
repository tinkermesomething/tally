"use client";

import { useState, useTransition } from "react";
import { PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { runAction } from "@/lib/action-result";
import { linkCategory } from "@/app/savings/actions";

const NONE = "none";

/** Links a category to a savings bucket: every expense in it then pays into
 * the bucket. Choosing a bucket asks (optionally) for a date to back-fill
 * the category's past expenses from; unlinking is immediate and keeps the
 * deposits already made. */
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
  const [target, setTarget] = useState<number | null>(null); // bucket being linked, awaiting the back-fill choice
  const [from, setFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const current = buckets.find((b) => b.id === linkedBucketId);
  const targetBucket = buckets.find((b) => b.id === target);

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
    setFrom("");
    setError(null);
    setAdded(null);
    setTarget(next);
  }

  function confirm() {
    if (target === null) return;
    startTransition(async () => {
      let count = 0;
      const failure = await runAction(async () => {
        const res = await linkCategory(categoryId, target, from || undefined);
        if (res.ok && res.added) count = res.added;
        return res;
      });
      if (failure) return setError(failure);
      if (from && count > 0) {
        setAdded(count); // show how many were added before closing
      } else {
        setTarget(null);
      }
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

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Pay {categoryName} into {targetBucket?.name}
            </DialogTitle>
            <DialogDescription>
              From now on, every expense in this category also pays into the bucket. Add its past expenses too if you like.
            </DialogDescription>
          </DialogHeader>
          {added === null ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor={`backfill-${categoryId}`}>Include past expenses from (optional)</Label>
                <Input id={`backfill-${categoryId}`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <p className="text-xs text-muted-foreground">Leave empty to start from now. Each expense is only ever counted once.</p>
              </div>
              {error && <p className="text-sm text-status-critical">{error}</p>}
              <DialogFooter>
                <Button disabled={pending} onClick={confirm}>
                  {pending ? "Linking…" : "Link"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4" data-testid="backfill-result">
              <p className="text-sm">
                Linked. Added {added} past {added === 1 ? "expense" : "expenses"} to the bucket.
              </p>
              <DialogFooter>
                <Button onClick={() => setTarget(null)}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
