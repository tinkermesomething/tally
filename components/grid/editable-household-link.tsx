"use client";

import { useState, useTransition } from "react";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { linkCategoryToHouseholdAction, previewHouseholdShare } from "@/app/grid/actions";
import { LinkTaggingDialog, type LinkTarget } from "@/components/settings/link-tagging-dialog";

/** A plain on/off toggle, not a picker like EditableDebtLink/EditableBucketLink
 * - there's only one household, no "which" to choose. Turning it ON for a
 * category with existing expenses offers the same backfill dialog those two
 * use (LinkTaggingDialog, extended with a "household" kind); turning it OFF
 * just clears the category's own default, same "history stays, future
 * doesn't" rule as unlinking a debt/bucket link. */
export function EditableHouseholdLink({
  categoryId,
  categoryName = "this category",
  sharedToHousehold,
}: {
  categoryId: number;
  categoryName?: string;
  sharedToHousehold: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    if (sharedToHousehold) {
      startTransition(async () => {
        const res = await linkCategoryToHouseholdAction(categoryId, false, []);
        if (!res.ok) setError(res.error);
      });
      return;
    }
    startTransition(async () => {
      const preview = await previewHouseholdShare(categoryId);
      if (!preview.ok) return setError(preview.error);
      if (preview.total === 0) {
        const res = await linkCategoryToHouseholdAction(categoryId, true, []);
        if (!res.ok) setError(res.error);
        return;
      }
      setTarget({ kind: "household", name: "the household", rows: preview.rows, total: preview.total });
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        title={sharedToHousehold ? "Shared to the household tab - click to stop sharing new expenses" : "Share this category to the household tab"}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.65rem]",
          sharedToHousehold
            ? "bg-primary/10 text-primary"
            : "border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-muted-foreground"
        )}
      >
        <Home className="size-3" />
        {sharedToHousehold ? "Shared" : "Share to household"}
      </button>
      {error && (
        <span role="alert" className="text-[0.65rem] text-status-critical">
          {error}
        </span>
      )}
      <LinkTaggingDialog categoryId={categoryId} categoryName={categoryName} target={target} onClose={() => setTarget(null)} />
    </>
  );
}
