"use client";

import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { previewRule } from "@/app/review/rule-actions";
import { parseConditionInputs } from "@/lib/rules";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import type { RulePreview, RuleTags } from "@/lib/db/bank-sync";
import type { EditorCondition } from "@/components/rules/rule-conditions-editor";

const PREVIEW_DEBOUNCE_MS = 250;

/** Live "what would this rule catch" state, shared by the Review Rule window
 * and Settings > Rules. Debounced, and a stale response never overwrites a
 * newer one (typing fast fires several requests). Ticks default to on, except
 * possible duplicates, which start off. */
export function useRulePreview(conditions: EditorCondition[], direction: "expense" | "income" | "ignore", editingRuleId?: number, tags?: RuleTags) {
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());
  const [retroOverrides, setRetroOverrides] = useState<Map<number, boolean>>(new Map());
  const requestId = useRef(0);

  const parsed = parseConditionInputs(conditions);
  const conditionsKey = JSON.stringify(parsed.ok ? parsed.conditions : null);
  const tagsKey = JSON.stringify(tags ?? null);

  useEffect(() => {
    if (!parsed.ok) {
      setPreview(null);
      setPreviewError(parsed.error);
      setLoading(false);
      return;
    }
    setPreviewError(null);
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const res = await previewRule({ conditions: parsed.conditions, direction, editingRuleId, tags });
      if (id !== requestId.current) return;
      setLoading(false);
      if (res.ok) setPreview(res.preview);
      else setPreviewError(res.error);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // conditionsKey captures every change to the parsed conditions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionsKey, direction, editingRuleId, tagsKey]);

  const rows = preview?.rows ?? [];
  const isTicked = (row: RulePreview["rows"][number]) =>
    row.blocked === "pencilled-match" ? false : (overrides.get(row.id) ?? row.blocked === null);
  const tickedIds = rows.filter(isTicked).map((r) => r.id);
  const selectableRows = rows.filter((r) => r.blocked !== "pencilled-match");

  // Past expenses the tag would be added to: ticked unless the user unticks them.
  const retroRows = preview?.retro?.rows ?? [];
  const isRetroTicked = (row: { expenseEntryId: number }) => retroOverrides.get(row.expenseEntryId) ?? true;
  const retroTickedIds = retroRows.filter(isRetroTicked).map((r) => r.expenseEntryId);

  return {
    parsed,
    retroRows,
    isRetroTicked,
    retroTickedIds,
    toggleRetro: (id: number, checked: boolean) => setRetroOverrides((prev) => new Map(prev).set(id, checked)),
    setAllRetro: (checked: boolean) => setRetroOverrides(new Map(retroRows.map((r) => [r.expenseEntryId, checked]))),
    preview,
    previewError,
    loading,
    rows,
    isTicked,
    tickedIds,
    selectableRows,
    toggle: (id: number, checked: boolean) => setOverrides((prev) => new Map(prev).set(id, checked)),
    setAll: (checked: boolean) => setOverrides(new Map(selectableRows.map((r) => [r.id, checked]))),
  };
}

export type RulePreviewState = ReturnType<typeof useRulePreview>;

/** The match list: count, select all/none, notes, and one ticked row per match. */
export function RulePreviewPanel({ state }: { state: RulePreviewState }) {
  const { currency, dateFormat } = useAppSettings();
  const { preview, previewError, loading, rows, isTicked, selectableRows, toggle, setAll } = state;
  return (
    <div className="space-y-2" data-testid="rule-preview">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {previewError
            ? "Preview"
            : loading && !preview
              ? "Looking for matches…"
              : `${preview?.total ?? 0} pending transaction${preview?.total === 1 ? "" : "s"} match`}
        </p>
        {selectableRows.length > 0 && (
          <div className="flex gap-1">
            <Button type="button" size="xs" variant="ghost" onClick={() => setAll(true)}>
              Select all
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setAll(false)}>
              Select none
            </Button>
          </div>
        )}
      </div>
      {previewError && <p className="text-sm text-muted-foreground">{previewError}</p>}
      {preview && preview.total > rows.length && (
        <p className="text-xs text-muted-foreground">
          Showing the newest {rows.length} of {preview.total}. The rule itself covers all of them on future imports.
        </p>
      )}
      {preview && preview.alreadyCoveredByEarlierRule > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="size-3.5 shrink-0" />
          {preview.alreadyCoveredByEarlierRule} of these would already be claimed by an earlier rule on import (first match wins).
        </p>
      )}
      {rows.length > 0 && (
        <div className={`max-h-64 overflow-y-auto rounded-lg border border-border ${loading ? "opacity-60" : ""}`}>
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="row-line border-b border-border last:border-0" data-testid="preview-row">
                  <td className="w-8 px-2 py-1.5">
                    <Checkbox
                      checked={isTicked(row)}
                      disabled={row.blocked === "pencilled-match"}
                      onCheckedChange={(c) => toggle(row.id, c === true)}
                      aria-label={`Include ${row.payeeClean ?? row.payeeRaw}`}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">{formatDate(row.bookingDate, dateFormat)}</td>
                  <td className="max-w-xs truncate px-2 py-1.5">
                    {row.payeeClean ?? row.payeeRaw}
                    {row.blocked === "pencilled-match" && (
                      <span className="ml-1.5 text-xs text-muted-foreground">(pencilled-in match - confirm or discard it on its own row)</span>
                    )}
                    {row.blocked === "possible-duplicate" && <span className="ml-1.5 text-xs text-status-critical">(might already be logged)</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {row.amountPence > 0 ? "+" : "−"}
                    {formatPence(Math.abs(row.amountPence), currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview?.retro && (preview.retro.total > 0 || preview.retro.otherCategory > 0) && (
        <div className="space-y-2 border-t border-border pt-2" data-testid="rule-retro">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {preview.retro.total} past transaction{preview.retro.total === 1 ? "" : "s"} already categorized will be tagged
            </p>
            {state.retroRows.length > 0 && (
              <div className="flex gap-1">
                <Button type="button" size="xs" variant="ghost" onClick={() => state.setAllRetro(true)}>
                  Select all
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => state.setAllRetro(false)}>
                  Select none
                </Button>
              </div>
            )}
          </div>
          {preview.retro.total > state.retroRows.length && (
            <p className="text-xs text-muted-foreground">
              Showing the newest {state.retroRows.length} of {preview.retro.total}.
            </p>
          )}
          {preview.retro.otherCategory > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="retro-other-category">
              <TriangleAlert className="size-3.5 shrink-0" />
              {preview.retro.otherCategory} more match{preview.retro.otherCategory === 1 ? "es" : ""} but {preview.retro.otherCategory === 1 ? "sits" : "sit"} in a different category, so{" "}
              {preview.retro.otherCategory === 1 ? "it is" : "they are"} left alone.
            </p>
          )}
          {state.retroRows.length > 0 && (
            <div className={`max-h-64 overflow-y-auto rounded-lg border border-border ${loading ? "opacity-60" : ""}`}>
              <table className="w-full text-sm">
                <tbody>
                  {state.retroRows.map((row) => (
                    <tr key={row.expenseEntryId} className="row-line border-b border-border last:border-0" data-testid="retro-row">
                      <td className="w-8 px-2 py-1.5">
                        <Checkbox
                          checked={state.isRetroTicked(row)}
                          onCheckedChange={(c) => state.toggleRetro(row.expenseEntryId, c === true)}
                          aria-label={`Tag ${row.payeeClean ?? row.payeeRaw}`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">{formatDate(row.bookingDate, dateFormat)}</td>
                      <td className="max-w-xs truncate px-2 py-1.5">
                        {row.payeeClean ?? row.payeeRaw}
                        {row.adds.debt && <span className="ml-1.5 rounded bg-chart-2/15 px-1 text-xs text-chart-2">+ debt repayment</span>}
                        {row.adds.savings && <span className="ml-1.5 rounded bg-chart-3/15 px-1 text-xs text-chart-3">+ savings</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                        −{formatPence(Math.abs(row.amountPence), currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
