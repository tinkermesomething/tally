"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Zap, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RuleConditionsEditor, newEditorCondition, type EditorCondition } from "@/components/rules/rule-conditions-editor";
import { NEW_PERSON, PersonPickerField, usePersonSelection } from "@/components/grid/person-picker";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { previewRule, saveRule } from "@/app/review/rule-actions";
import { parseConditionInputs } from "@/lib/rules";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import type { RulePreview, CreateRuleAndApplyResult } from "@/lib/db/bank-sync";

const PREVIEW_DEBOUNCE_MS = 250;

/** The Review row's "Rule" button + window: build a rule from this
 * transaction, see every pending transaction it would catch, and either
 * save the rule for future imports or save it AND categorize the ticked
 * matches right now. */
export function RuleDialog({
  transaction,
  isIncome,
  categories,
  incomeSources,
  people,
  initialCategoryId,
  initialIncomeSourceId,
}: {
  transaction: { payeeRaw: string; payeeClean: string | null };
  isIncome: boolean;
  categories: { id: number; name: string }[];
  incomeSources: { id: number; name: string }[];
  people: { id: number; name: string }[];
  initialCategoryId: string;
  initialIncomeSourceId: string;
}) {
  const { currency, dateFormat } = useAppSettings();
  const [open, setOpen] = useState(false);
  const [conditions, setConditions] = useState<EditorCondition[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [incomeSourceId, setIncomeSourceId] = useState("");
  const [tagDebt, setTagDebt] = useState(false);
  const { personId, setPersonId, newPersonName, setNewPersonName, resolvePersonId } = usePersonSelection();
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Explicit tick/untick choices; anything not in here uses its default
  // (ticked, except possible-duplicates which start unticked).
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateRuleAndApplyResult | null>(null);
  const [saving, startSaving] = useTransition();
  const requestId = useRef(0);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    // Fresh each time it opens: starts from THIS transaction, with
    // whatever target the row already had selected.
    const seed = (transaction.payeeClean ?? transaction.payeeRaw).replace(/\s+/g, " ").trim();
    setConditions([newEditorCondition("payee", "contains", seed)]);
    setCategoryId(initialCategoryId);
    setIncomeSourceId(initialIncomeSourceId);
    setTagDebt(false);
    setPreview(null);
    setPreviewError(null);
    setOverrides(new Map());
    setError(null);
    setResult(null);
  }

  const parsed = parseConditionInputs(conditions);
  const conditionsKey = JSON.stringify(parsed.ok ? parsed.conditions : null);

  // Live preview - debounced, and a stale response never overwrites a
  // newer one (typing fast fires several requests).
  useEffect(() => {
    if (!open) return;
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
      const res = await previewRule({ conditions: parsed.conditions, direction: isIncome ? "income" : "expense" });
      if (id !== requestId.current) return;
      setLoading(false);
      if (res.ok) setPreview(res.preview);
      else setPreviewError(res.error);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // conditionsKey captures every change to the parsed conditions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conditionsKey, isIncome]);

  const rows = preview?.rows ?? [];
  const isTicked = (row: RulePreview["rows"][number]) =>
    row.blocked === "pencilled-match" ? false : (overrides.get(row.id) ?? row.blocked === null);
  const tickedIds = rows.filter(isTicked).map((r) => r.id);
  const selectableRows = rows.filter((r) => r.blocked !== "pencilled-match");

  function toggle(id: number, checked: boolean) {
    setOverrides((prev) => new Map(prev).set(id, checked));
  }
  function setAll(checked: boolean) {
    setOverrides(new Map(selectableRows.map((r) => [r.id, checked])));
  }

  const hasTarget = isIncome ? !!incomeSourceId : !!categoryId;

  function submit(apply: boolean) {
    if (!parsed.ok) return setError(parsed.error);
    if (!hasTarget) return setError(isIncome ? "Pick an income source." : "Pick a category.");
    if (!isIncome && tagDebt && !personId) return setError("Pick who this repayment is to, or turn off the debt tag.");
    if (!isIncome && tagDebt && personId === NEW_PERSON && !newPersonName.trim()) return setError("Enter the new person's name.");
    setError(null);
    startSaving(async () => {
      try {
        const debtPersonId = !isIncome && tagDebt ? await resolvePersonId() : undefined;
        const target = isIncome
          ? ({ targetType: "income", incomeSourceId: parseInt(incomeSourceId, 10) } as const)
          : ({ targetType: "expense", categoryId: parseInt(categoryId, 10), debtPersonId } as const);
        const res = await saveRule({ conditions: parsed.conditions, target, applyToIds: apply ? tickedIds : [] });
        if (res.ok) setResult(res.result);
        else setError(res.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save this rule.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="xs" variant="outline" title="Create a rule from this transaction">
            <Zap className="size-3" />
            Rule
          </Button>
        }
      />
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        {result ? (
          <div className="space-y-3" data-testid="rule-result">
            <DialogHeader>
              <DialogTitle>Rule created</DialogTitle>
              <DialogDescription>
                {result.categorized > 0
                  ? `Categorized ${result.categorized} transaction${result.categorized === 1 ? "" : "s"}. `
                  : ""}
                It will also apply to future imports.
              </DialogDescription>
            </DialogHeader>
            {result.skipped.length > 0 && (
              <div className="space-y-1 rounded-lg border border-border bg-secondary p-2 text-sm">
                <p className="font-medium">{result.skipped.length} not applied:</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {result.skipped.slice(0, 5).map((s) => (
                    <li key={s.id}>{s.reason}</li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>New auto-categorization rule</DialogTitle>
              <DialogDescription>
                Built from this {isIncome ? "payment received" : "payment"}. See what it would catch, then apply it.
              </DialogDescription>
            </DialogHeader>

            <RuleConditionsEditor conditions={conditions} onChange={setConditions} />

            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">Then categorize as</p>
              {isIncome ? (
                <Select value={incomeSourceId} onValueChange={(v) => setIncomeSourceId(v ?? "")}>
                  <SelectTrigger className="w-64" aria-label="Income source">
                    <SelectValue>
                      {(v: string) => (v ? (incomeSources.find((s) => String(s.id) === v)?.name ?? v) : "Choose an income source")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {incomeSources.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <>
                  <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                    <SelectTrigger className="w-64" aria-label="Category">
                      <SelectValue>
                        {(v: string) => (v ? (categories.find((c) => String(c.id) === v)?.name ?? v) : "Choose a category")}
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
                  <div className="flex items-center gap-2">
                    <Checkbox checked={tagDebt} onCheckedChange={(c) => setTagDebt(c === true)} />
                    <Label className="font-normal">Also tag as a debt repayment</Label>
                  </div>
                  {tagDebt && (
                    <PersonPickerField
                      idPrefix="rule-dialog"
                      label="Paying back"
                      placeholder="Choose who"
                      people={people}
                      personId={personId}
                      onPersonIdChange={setPersonId}
                      newPersonName={newPersonName}
                      onNewPersonNameChange={setNewPersonName}
                    />
                  )}
                </>
              )}
            </div>

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
                  Showing the newest {rows.length} of {preview.total}. The rule itself covers all of them on future
                  imports.
                </p>
              )}
              {preview && preview.alreadyCoveredByEarlierRule > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  {preview.alreadyCoveredByEarlierRule} of these would already be claimed by an earlier rule on import
                  (first match wins).
                </p>
              )}
              {rows.length > 0 && (
                <div className={`max-h-64 overflow-y-auto rounded-lg border border-border ${loading ? "opacity-60" : ""}`}>
                  <table className="w-full text-sm">
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className="border-b border-border last:border-0" data-testid="preview-row">
                          <td className="w-8 px-2 py-1.5">
                            <Checkbox
                              checked={isTicked(row)}
                              disabled={row.blocked === "pencilled-match"}
                              onCheckedChange={(c) => toggle(row.id, c === true)}
                              aria-label={`Include ${row.payeeClean ?? row.payeeRaw}`}
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">
                            {formatDate(row.bookingDate, dateFormat)}
                          </td>
                          <td className="max-w-xs truncate px-2 py-1.5">
                            {row.payeeClean ?? row.payeeRaw}
                            {row.blocked === "pencilled-match" && (
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                (pencilled-in match - confirm or discard it on its own row)
                              </span>
                            )}
                            {row.blocked === "possible-duplicate" && (
                              <span className="ml-1.5 text-xs text-status-critical">(might already be logged)</span>
                            )}
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
            </div>

            {error && <p className="text-sm text-status-critical">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving || !parsed.ok} onClick={() => submit(false)}>
                Create rule
              </Button>
              <Button type="button" disabled={saving || !parsed.ok || tickedIds.length === 0} onClick={() => submit(true)}>
                {saving ? "Saving…" : `Create rule & categorize ${tickedIds.length}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
