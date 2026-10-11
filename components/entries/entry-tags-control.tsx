"use client";

import { useEffect, useState, useTransition } from "react";
import { PiggyBank, UserRound } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getEntryTagOptions, setEntryTags } from "@/app/grid/actions";
import { runAction } from "@/lib/action-result";

const NONE = "none";

export type EntryTagState = { debtPersonId: number | null; debtPersonName: string | null; savingsBucketId: number | null; savingsBucketName: string | null };
type Options = { people: { id: number; name: string }[]; buckets: { id: number; name: string }[] };

// One fetch shared by every row on the page.
let optionsPromise: Promise<Options> | null = null;
function loadOptions() {
  optionsPromise ??= getEntryTagOptions().catch((err) => {
    optionsPromise = null;
    throw err;
  });
  return optionsPromise;
}

const pill = (set: boolean) =>
  cn(
    "h-auto w-auto gap-1 rounded-full border-0 bg-transparent px-1.5 py-0.5 text-[0.65rem]",
    set ? "text-muted-foreground hover:bg-accent" : "border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-muted-foreground"
  );

/** What ONE expense counts towards: a person (it is a repayment in the Debt
 * ledger) and/or a savings bucket (it is a deposit). Choosing adds it - even
 * to an old expense - changing moves it, and "None" takes it off again (the
 * ledger row / deposit it made goes with it). */
export function EntryTagsControl({
  entryId,
  label,
  tags,
  onChanged,
}: {
  entryId: number;
  /** For screen readers, e.g. "Rent on 3 Sep". */
  label: string;
  tags: EntryTagState;
  onChanged: (next: EntryTagState) => void;
}) {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    loadOptions().then((o) => live && setOptions(o)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  function change(kind: "debt" | "savings", value: string | null) {
    const id = !value || value === NONE ? null : parseInt(value, 10);
    const current = kind === "debt" ? tags.debtPersonId : tags.savingsBucketId;
    if (id === current) return;
    setError(null);
    const name = id === null ? null : ((kind === "debt" ? options?.people : options?.buckets)?.find((o) => o.id === id)?.name ?? null);
    const next: EntryTagState =
      kind === "debt" ? { ...tags, debtPersonId: id, debtPersonName: name } : { ...tags, savingsBucketId: id, savingsBucketName: name };
    startTransition(async () => {
      const failure = await runAction(() => setEntryTags(entryId, kind === "debt" ? { debtPersonId: id } : { savingsBucketId: id }));
      if (failure) return setError(failure);
      onChanged(next);
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="entry-tags">
      <Select value={tags.debtPersonId !== null ? String(tags.debtPersonId) : NONE} onValueChange={(v) => change("debt", v)}>
        <SelectTrigger size="sm" aria-label={`Debt repayment for ${label}`} className={pill(tags.debtPersonId !== null)}>
          <SelectValue>
            {(v: string) =>
              v === NONE ? (
                "+ debt repayment"
              ) : (
                <span className="inline-flex items-center gap-1">
                  <UserRound className="size-3" />
                  {tags.debtPersonName ?? options?.people.find((p) => String(p.id) === v)?.name ?? "Unknown"}
                </span>
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not a debt repayment</SelectItem>
          {(options?.people ?? []).map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={tags.savingsBucketId !== null ? String(tags.savingsBucketId) : NONE} onValueChange={(v) => change("savings", v)}>
        <SelectTrigger size="sm" aria-label={`Savings for ${label}`} className={pill(tags.savingsBucketId !== null)}>
          <SelectValue>
            {(v: string) =>
              v === NONE ? (
                "+ savings"
              ) : (
                <span className="inline-flex items-center gap-1">
                  <PiggyBank className="size-3" />
                  {tags.savingsBucketName ?? options?.buckets.find((b) => String(b.id) === v)?.name ?? "Bucket"}
                </span>
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not savings</SelectItem>
          {(options?.buckets ?? []).map((b) => (
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
    </span>
  );
}
