"use client";

import { useState, useTransition } from "react";
import { UserRound } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { linkCategoryTagging, previewCategoryTags, updateCategoryDebtLink } from "@/app/grid/actions";
import { LinkTaggingDialog, type LinkTarget } from "@/components/settings/link-tagging-dialog";

const NONE = "none";

/** Links a category permanently to a debt person - any expense logged
 * against it auto-creates a ledger repayment, no per-transaction checkbox
 * needed. For categories that only ever mean "pay this one person back". */
export function EditableDebtLink({
  categoryId,
  categoryName = "this category",
  linkedDebtPersonId,
  people,
  autoOpen = false,
  onAutoOpenChange,
}: {
  categoryId: number;
  categoryName?: string;
  linkedDebtPersonId: number | null;
  people: { id: number; name: string }[];
  autoOpen?: boolean;
  onAutoOpenChange?: (open: boolean) => void;
}) {
  const [, startTransition] = useTransition();
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleChange(value: string | null) {
    const next = !value || value === NONE ? null : parseInt(value, 10);
    if (next === linkedDebtPersonId) return;
    setError(null);
    if (next === null) {
      startTransition(() => updateCategoryDebtLink(categoryId, null));
      return;
    }
    // Existing expenses in the category that this link would also count?
    // Offer them as a list; with none, just link.
    startTransition(async () => {
      const link = { debtPersonId: next };
      const preview = await previewCategoryTags(categoryId, link);
      if (!preview.ok) return setError(preview.error);
      if (preview.total === 0) {
        const res = await linkCategoryTagging(categoryId, link, []);
        if (!res.ok) setError(res.error);
        return;
      }
      setTarget({ link, name: people.find((p) => p.id === next)?.name ?? "this one", kind: "debt", rows: preview.rows, total: preview.total });
    });
  }

  return (
    <>
    <Select
      value={linkedDebtPersonId !== null ? String(linkedDebtPersonId) : NONE}
      onValueChange={handleChange}
      {...(autoOpen ? { open: true, onOpenChange: (next: boolean) => onAutoOpenChange?.(next) } : {})}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          "h-auto w-auto gap-1 rounded-full border-0 bg-transparent px-1.5 py-0.5 text-[0.65rem]",
          linkedDebtPersonId === null
            ? "border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-muted-foreground"
            : "text-muted-foreground hover:bg-accent"
        )}
      >
        <SelectValue>
          {(value: string) =>
            value === NONE ? (
              "+ link to someone"
            ) : (
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3" />
                {people.find((p) => String(p.id) === value)?.name ?? "Unknown"}
              </span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Not linked</SelectItem>
        {people.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
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
