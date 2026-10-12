"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EditableDueDay } from "@/components/grid/editable-due-day";
import { EditableDebtLink } from "@/components/grid/editable-debt-link";
import { EditableBucketLink } from "@/components/settings/editable-bucket-link";
import { EditableHouseholdLink } from "@/components/grid/editable-household-link";
import { LinkTaggingDialog, type LinkTarget } from "@/components/settings/link-tagging-dialog";
import { linkCategoryToHouseholdAction, previewHouseholdShare } from "@/app/grid/actions";

type PendingAdd = "dueDay" | "debt" | "savings" | null;

/** Replaces always-rendering all 4 link controls (due day, debt, savings,
 * household) whether set or not - a category with nothing configured used
 * to show 3-4 empty-state "+ ..." pills by default, which is most of what
 * made Settings > Categories hard to read/manage. Only a SET link renders
 * as a pill; everything unset collapses into one "+" menu, which mounts
 * the real control (in its own auto-opened picker state) only once that
 * kind is actually picked. */
export function CategoryLinksRow({
  categoryId,
  categoryName,
  dueDay,
  linkedDebtPersonId,
  linkedBucketId,
  sharedToHousehold,
  people = [],
  buckets = [],
  householdEnabled = false,
}: {
  categoryId: number;
  categoryName: string;
  /** Always applicable - a parent/rollup category can carry its own due
   * day independent of its children (lib/db/grid.ts's applyOverdueFlags
   * runs on a top-level category's own direct months, same as any leaf). */
  dueDay: number | null;
  /** undefined = not offered at all (a parent/rollup row - debt/savings/
   * household links only ever make sense for a leaf category, same
   * leaf-only gating this always had); null = offered, currently unset;
   * a number/true = offered, currently set. */
  linkedDebtPersonId?: number | null;
  linkedBucketId?: number | null;
  sharedToHousehold?: boolean;
  people?: { id: number; name: string }[];
  buckets?: { id: number; name: string; color: string }[];
  householdEnabled?: boolean;
}) {
  const [pendingAdd, setPendingAdd] = useState<PendingAdd>(null);
  const [pending, startTransition] = useTransition();
  const [householdTarget, setHouseholdTarget] = useState<LinkTarget | null>(null);
  const [householdError, setHouseholdError] = useState<string | null>(null);

  const options: { key: PendingAdd | "household"; label: string }[] = [
    ...(dueDay === null ? [{ key: "dueDay" as const, label: "Due day" }] : []),
    ...(linkedDebtPersonId === null ? [{ key: "debt" as const, label: "Link to someone" }] : []),
    ...(linkedBucketId === null ? [{ key: "savings" as const, label: "Pay into savings bucket" }] : []),
    ...(householdEnabled && sharedToHousehold === false ? [{ key: "household" as const, label: "Share to household" }] : []),
  ];

  // Same preview-then-link flow as EditableHouseholdLink's own ON branch -
  // not reused directly because that component's toggle() also owns the
  // OFF branch and its own "set" pill rendering, neither of which applies
  // here (the "+" menu only ever offers this when it's currently unset).
  function activateHousehold() {
    setHouseholdError(null);
    startTransition(async () => {
      const preview = await previewHouseholdShare(categoryId);
      if (!preview.ok) return setHouseholdError(preview.error);
      if (preview.total === 0) {
        const res = await linkCategoryToHouseholdAction(categoryId, true, []);
        if (!res.ok) setHouseholdError(res.error);
        return;
      }
      setHouseholdTarget({ kind: "household", name: "the household", rows: preview.rows, total: preview.total });
    });
  }

  return (
    <>
      {dueDay !== null && <EditableDueDay categoryId={categoryId} dueDay={dueDay} />}
      {pendingAdd === "dueDay" && (
        <EditableDueDay categoryId={categoryId} dueDay={null} autoOpen onAutoOpenChange={(open) => !open && setPendingAdd(null)} />
      )}

      {typeof linkedDebtPersonId === "number" && (
        <EditableDebtLink categoryId={categoryId} categoryName={categoryName} linkedDebtPersonId={linkedDebtPersonId} people={people} />
      )}
      {pendingAdd === "debt" && (
        <EditableDebtLink
          categoryId={categoryId}
          categoryName={categoryName}
          linkedDebtPersonId={null}
          people={people}
          autoOpen
          onAutoOpenChange={(open) => !open && setPendingAdd(null)}
        />
      )}

      {typeof linkedBucketId === "number" && (
        <EditableBucketLink categoryId={categoryId} categoryName={categoryName} linkedBucketId={linkedBucketId} buckets={buckets} />
      )}
      {pendingAdd === "savings" && (
        <EditableBucketLink
          categoryId={categoryId}
          categoryName={categoryName}
          linkedBucketId={null}
          buckets={buckets}
          autoOpen
          onAutoOpenChange={(open) => !open && setPendingAdd(null)}
        />
      )}

      {householdEnabled && sharedToHousehold && (
        <EditableHouseholdLink categoryId={categoryId} categoryName={categoryName} sharedToHousehold={sharedToHousehold} />
      )}
      {householdError && (
        <span role="alert" className="text-[0.65rem] text-status-critical">
          {householdError}
        </span>
      )}
      <LinkTaggingDialog categoryId={categoryId} categoryName={categoryName} target={householdTarget} onClose={() => setHouseholdTarget(null)} />

      {options.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                disabled={pending}
                title="Add a link"
                className="rounded-full border border-dashed border-muted-foreground/40 p-1 text-muted-foreground hover:border-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3" />
              </button>
            }
          />
          <DropdownMenuContent align="start">
            {options.map((o) =>
              o.key === "household" ? (
                <DropdownMenuItem key={o.key} onClick={activateHousehold}>
                  {o.label}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={o.key} onClick={() => setPendingAdd(o.key as Exclude<typeof o.key, "household">)}>
                  {o.label}
                </DropdownMenuItem>
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
