"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPence } from "@/lib/money";
import { parsePounds } from "@/lib/money-input";
import { useAppSettings } from "@/components/providers/app-settings-provider";

export type SplitPartDraft = { categoryId: string; pounds: string; note: string };

export const emptyPart = (): SplitPartDraft => ({ categoryId: "", pounds: "", note: "" });

/** Drafts -> real parts, or null if any row is incomplete/invalid - doesn't
 * check the sum, the caller shows that separately (SplitPartsEditor's own
 * remaining-amount line) before ever calling this. */
export function resolveSplitParts(parts: SplitPartDraft[]): { categoryId: number; pounds: number; note?: string }[] | null {
  const resolved: { categoryId: number; pounds: number; note?: string }[] = [];
  for (const p of parts) {
    const categoryId = parseInt(p.categoryId, 10);
    const pounds = parsePounds(p.pounds);
    if (!p.categoryId || Number.isNaN(categoryId) || pounds === null || pounds <= 0) return null;
    resolved.push({ categoryId, pounds, note: p.note.trim() || undefined });
  }
  return resolved;
}

/** The rows a split redistributes an entry's total into - at least 2, each
 * a category + amount (+ optional note). Shows the running total against
 * the original so it's obvious when it's short or over before submitting. */
export function SplitPartsEditor({
  categories,
  totalPence,
  parts,
  onChange,
}: {
  categories: { id: number; name: string }[];
  totalPence: number;
  parts: SplitPartDraft[];
  onChange: (next: SplitPartDraft[]) => void;
}) {
  const { currency } = useAppSettings();

  function update(i: number, patch: Partial<SplitPartDraft>) {
    onChange(parts.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  const enteredPence = parts.reduce((s, p) => s + Math.round((parsePounds(p.pounds) ?? 0) * 100), 0);
  const remainingPence = totalPence - enteredPence;

  return (
    <div className="space-y-2">
      {parts.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Select value={p.categoryId} onValueChange={(v) => update(i, { categoryId: v ?? "" })}>
            <SelectTrigger className="w-40" aria-label={`Category for part ${i + 1}`}>
              <SelectValue>
                {(v: string) => (v ? (categories.find((c) => String(c.id) === v)?.name ?? v) : "Category")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={p.pounds}
            onChange={(e) => update(i, { pounds: e.target.value })}
            className="w-24 text-right"
            aria-label={`Amount for part ${i + 1}`}
          />
          <Input
            placeholder="Note (optional)"
            value={p.note}
            onChange={(e) => update(i, { note: e.target.value })}
            className="flex-1"
            aria-label={`Note for part ${i + 1}`}
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={parts.length <= 2}
            onClick={() => onChange(parts.filter((_, idx) => idx !== i))}
            title="Remove this part"
          >
            <Trash2 className="size-3.5 text-status-critical" />
          </Button>
        </div>
      ))}
      <Button type="button" size="xs" variant="outline" onClick={() => onChange([...parts, emptyPart()])}>
        <Plus className="size-3" />
        Add category
      </Button>
      <p className={`text-xs ${remainingPence === 0 ? "text-muted-foreground" : "text-status-critical"}`}>
        {remainingPence === 0
          ? `Adds up to ${formatPence(totalPence, currency)}.`
          : remainingPence > 0
            ? `${formatPence(remainingPence, currency)} left to assign.`
            : `${formatPence(-remainingPence, currency)} over the original amount.`}
      </p>
    </div>
  );
}
