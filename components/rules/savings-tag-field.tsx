"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createBucketNamed } from "@/app/savings/actions";

export const NEW_BUCKET = "__new_bucket__";

/** Which savings bucket a rule pays into, including "make a new one": mirrors
 * usePersonSelection (the lender picker) so both tags work the same way. */
export function useBucketSelection() {
  const [bucketId, setBucketId] = useState("");
  const [newBucketName, setNewBucketName] = useState("");

  function reset() {
    setBucketId("");
    setNewBucketName("");
  }

  /** The real bucket id, creating the new bucket first if that was chosen.
   * Callers check a choice (and a name, for a new one) was made first. */
  async function resolveBucketId(): Promise<number> {
    if (bucketId === NEW_BUCKET) {
      const res = await createBucketNamed(newBucketName);
      if (!res.ok) throw new Error(res.error);
      return res.id;
    }
    return parseInt(bucketId, 10);
  }

  return { bucketId, setBucketId, newBucketName, setNewBucketName, reset, resolveBucketId };
}

/** "Tag as savings" on an expense rule: the matched money also goes into the
 * chosen savings bucket, as a deposit - the same as a category linked to a
 * bucket. The bucket can be picked or created right here (with no buckets yet,
 * the new-bucket name box is shown straight away). Shared by Settings > Rules
 * and the Review Rule window. */
export function SavingsTagField({
  buckets,
  checked,
  onCheckedChange,
  bucketId,
  onBucketIdChange,
  newBucketName,
  onNewBucketNameChange,
}: {
  buckets: { id: number; name: string }[];
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  bucketId: string;
  onBucketIdChange: (next: string) => void;
  newBucketName: string;
  onNewBucketNameChange: (next: string) => void;
}) {
  const none = buckets.length === 0;
  const effective = checked && none && !bucketId ? NEW_BUCKET : bucketId;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={checked}
          onCheckedChange={(c) => {
            onCheckedChange(c === true);
            // nothing to pick from yet: go straight to making one
            if (c === true && none) onBucketIdChange(NEW_BUCKET);
          }}
          aria-label="Tag as savings"
        />
        <Label className="font-normal">Tag as savings</Label>
      </div>
      {checked && (
        <div className="space-y-2">
          {none ? (
            <p className="text-xs text-muted-foreground" data-testid="no-buckets">
              There are no savings buckets yet - name the first one here.
            </p>
          ) : (
            <Select value={effective} onValueChange={(v) => onBucketIdChange(v ?? "")}>
              <SelectTrigger className="w-64" aria-label="Savings bucket">
                <SelectValue>
                  {(v: string) => (!v ? "Choose a savings bucket" : v === NEW_BUCKET ? "+ New savings bucket…" : (buckets.find((b) => String(b.id) === v)?.name ?? v))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {buckets.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_BUCKET}>+ New savings bucket…</SelectItem>
              </SelectContent>
            </Select>
          )}
          {effective === NEW_BUCKET && (
            <Input
              placeholder="Name of the new savings bucket"
              aria-label="New savings bucket name"
              value={newBucketName}
              onChange={(e) => onNewBucketNameChange(e.target.value)}
              className="w-64"
              autoFocus
            />
          )}
        </div>
      )}
    </div>
  );
}
