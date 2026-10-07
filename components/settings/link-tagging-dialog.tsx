"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { linkCategoryTagging } from "@/app/grid/actions";
import { formatDate } from "@/lib/date-format";
import { formatPence } from "@/lib/money";
import type { MissingTagRow } from "@/lib/db/retro-tags";

export type LinkTarget = {
  /** What the category is being linked to. */
  link: { debtPersonId?: number; savingsBucketId?: number };
  /** "Sam" or "Trip" */
  name: string;
  kind: "debt" | "savings";
  rows: MissingTagRow[];
  total: number;
};

/** Shown when linking a category to a lender or a savings bucket and it
 * already has expenses that would count towards it: the list is ticked, so the
 * old expenses can be tagged at the same time (or left out). Nothing changes
 * until a button is pressed. */
export function LinkTaggingDialog({
  categoryId,
  categoryName,
  target,
  onClose,
}: {
  categoryId: number;
  categoryName: string;
  target: LinkTarget | null;
  onClose: () => void;
}) {
  const { currency, dateFormat } = useAppSettings();
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tagged: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = target?.rows ?? [];
  const ticked = (id: number) => overrides.get(id) ?? true;
  const tickedIds = rows.filter((r) => ticked(r.expenseEntryId)).map((r) => r.expenseEntryId);
  const noun = target?.kind === "debt" ? "debt repayment" : "savings deposit";

  function close() {
    setOverrides(new Map());
    setError(null);
    setDone(null);
    onClose();
  }

  function link(ids: number[]) {
    if (!target) return;
    setError(null);
    startTransition(async () => {
      const res = await linkCategoryTagging(categoryId, target.link, ids);
      if (!res.ok) return setError(res.error);
      if (ids.length > 0) setDone({ tagged: res.tagged });
      else close();
    });
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !pending && close()}>
      <DialogContent className="sm:max-w-lg" data-testid="link-tagging">
        <DialogHeader>
          <DialogTitle>
            Link {categoryName} to {target?.name}
          </DialogTitle>
          <DialogDescription>
            From now on every expense in this category counts as a {noun}. These existing ones are not tagged yet - tick the ones to add.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-3" data-testid="link-tagging-result">
            <p className="text-sm">
              Linked. Added {done.tagged} past {done.tagged === 1 ? "expense" : "expenses"} as a {noun}.
            </p>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {target?.total} existing expense{target?.total === 1 ? "" : "s"} would be added
              </p>
              <div className="flex gap-1">
                <Button type="button" size="xs" variant="ghost" onClick={() => setOverrides(new Map(rows.map((r) => [r.expenseEntryId, true])))}>
                  Select all
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setOverrides(new Map(rows.map((r) => [r.expenseEntryId, false])))}>
                  Select none
                </Button>
              </div>
            </div>
            {target && target.total > rows.length && <p className="text-xs text-muted-foreground">Showing the newest {rows.length} of {target.total}.</p>}
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.expenseEntryId} className="row-line border-b border-border last:border-0" data-testid="link-row">
                      <td className="w-8 px-2 py-1.5">
                        <Checkbox
                          checked={ticked(row.expenseEntryId)}
                          onCheckedChange={(c) => setOverrides((prev) => new Map(prev).set(row.expenseEntryId, c === true))}
                          aria-label={`Include ${row.note ?? row.categoryName} on ${row.entryDate}`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">{formatDate(row.entryDate, dateFormat)}</td>
                      <td className="max-w-xs truncate px-2 py-1.5">{row.note ?? row.categoryName}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatPence(row.amountPence, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <p className="text-sm text-status-critical">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => link([])}>
                Link only
              </Button>
              <Button type="button" disabled={pending || tickedIds.length === 0} onClick={() => link(tickedIds)}>
                {pending ? "Linking…" : `Link & add ${tickedIds.length}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
