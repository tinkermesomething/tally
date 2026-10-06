"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
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
import { findLoansSourceId } from "@/lib/loans";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import type { RulePreview, CreateRuleAndApplyResult } from "@/lib/db/bank-sync";

const PREVIEW_DEBOUNCE_MS = 250;

/** What a row hands over when its "Rule" button is pressed. */
export type RuleContext = {
  /** Changes on every open, so the window always starts fresh. */
  openId: number;
  transaction: { payeeRaw: string; payeeClean: string | null };
  isIncome: boolean;
  initialCategoryId: string;
  initialIncomeSourceId: string;
  /** The row's own person tag, carried over (an existing person only). */
  initialTagDebt: boolean;
  initialPersonId: string;
};

type Lists = {
  accounts?: { id: number; name: string }[];
  categories: { id: number; name: string }[];
  incomeSources: { id: number; name: string }[];
  people: { id: number; name: string }[];
};

/** ONE Rule window for the whole Review list (not one per row): it must
 * outlive the row it was opened from - applying a rule categorizes that
 * row, which then drops out of the list, and a window living inside it
 * would vanish with it. `onClose(applied)` tells the list whether anything
 * was saved, so it refreshes only once the window is gone. */
export function RuleDialog({
  context,
  onClose,
  ...lists
}: { context: RuleContext | null; onClose: (applied: boolean) => void } & Lists) {
  const applied = useRef(false);
  const lastContext = useRef<RuleContext | null>(null);
  if (context) lastContext.current = context;
  const shown = context ?? lastContext.current; // keeps the body mounted while the close animation plays

  useEffect(() => {
    applied.current = false;
  }, [context?.openId]);

  return (
    <Dialog open={context !== null} onOpenChange={(next) => !next && onClose(applied.current)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        {shown && (
          <RuleDialogBody
            key={shown.openId}
            context={shown}
            {...lists}
            onApplied={() => {
              applied.current = true;
            }}
            onDone={() => onClose(applied.current)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RuleDialogBody({
  context,
  categories,
  incomeSources,
  people,
  accounts = [],
  onApplied,
  onDone,
}: { context: RuleContext; onApplied: () => void; onDone: () => void } & Lists) {
  const { transaction, isIncome } = context;
  const { currency, dateFormat } = useAppSettings();
  // Starts from THIS transaction, with whatever target the row already had.
  const [conditions, setConditions] = useState<EditorCondition[]>(() => [
    newEditorCondition("payee", "contains", (transaction.payeeClean ?? transaction.payeeRaw).replace(/\s+/g, " ").trim()),
  ]);
  // Categorize routes matches to a category/source; Ignore drops them from
  // Review (own-account transfers) and matches money in AND out.
  const [action, setAction] = useState<"categorize" | "ignore">("categorize");
  const ignoring = action === "ignore";
  const direction = ignoring ? "ignore" : isIncome ? "income" : "expense";
  const [categoryId, setCategoryId] = useState(context.initialCategoryId);
  const [incomeSourceId, setIncomeSourceId] = useState(context.initialIncomeSourceId);
  const [tagDebt, setTagDebt] = useState(context.initialTagDebt);
  const { personId, setPersonId, newPersonName, setNewPersonName, resolvePersonId } = usePersonSelection();
  useEffect(() => {
    if (context.initialTagDebt && context.initialPersonId) setPersonId(context.initialPersonId);
    // once, on open - the body remounts for every open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleTagDebtChange(next: boolean) {
    setTagDebt(next);
    // A loan suggests the loans income source - only when none is chosen.
    if (next && isIncome && !incomeSourceId) {
      const loansId = findLoansSourceId(incomeSources);
      if (loansId) setIncomeSourceId(loansId);
    }
  }
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

  const parsed = parseConditionInputs(conditions);
  const conditionsKey = JSON.stringify(parsed.ok ? parsed.conditions : null);

  // Live preview - debounced, and a stale response never overwrites a
  // newer one (typing fast fires several requests).
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
      const res = await previewRule({ conditions: parsed.conditions, direction });
      if (id !== requestId.current) return;
      setLoading(false);
      if (res.ok) setPreview(res.preview);
      else setPreviewError(res.error);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // conditionsKey captures every change to the parsed conditions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionsKey, direction]);

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

  const hasTarget = ignoring || (isIncome ? !!incomeSourceId : !!categoryId);

  function submit(apply: boolean) {
    if (!parsed.ok) return setError(parsed.error);
    if (!hasTarget) return setError(isIncome ? "Pick an income source." : "Pick a category.");
    if (!ignoring && tagDebt && !personId) {
      return setError(isIncome ? "Pick who you borrowed this from, or turn off the loan tag." : "Pick who this repayment is to, or turn off the debt tag.");
    }
    if (!ignoring && tagDebt && personId === NEW_PERSON && !newPersonName.trim()) return setError("Enter the new lender's name.");
    setError(null);
    startSaving(async () => {
      try {
        const debtPersonId = !ignoring && tagDebt ? await resolvePersonId() : undefined;
        const target = ignoring
          ? ({ targetType: "ignore" } as const)
          : isIncome
            ? ({ targetType: "income", incomeSourceId: parseInt(incomeSourceId, 10), debtPersonId } as const)
            : ({ targetType: "expense", categoryId: parseInt(categoryId, 10), debtPersonId } as const);
        const res = await saveRule({ conditions: parsed.conditions, target, applyToIds: apply ? tickedIds : [] });
        if (res.ok) {
          setResult(res.result);
          onApplied();
        }
        else setError(res.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save this rule.");
      }
    });
  }

  return (
    <>
    {result ? (
      <div className="space-y-3" data-testid="rule-result">
        <DialogHeader>
          <DialogTitle>Rule created</DialogTitle>
          <DialogDescription>
            {result.categorized > 0
              ? `${ignoring ? "Ignored" : "Categorized"} ${result.categorized} transaction${result.categorized === 1 ? "" : "s"}. `
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
          <Button onClick={onDone}>Done</Button>
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

        <RuleConditionsEditor conditions={conditions} onChange={setConditions} accounts={accounts} />

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-muted-foreground">Then</p>
            <Select value={action} onValueChange={(v) => setAction(v === "ignore" ? "ignore" : "categorize")}>
              <SelectTrigger className="w-40" aria-label="Rule action">
                <SelectValue>{(v: string) => (v === "ignore" ? "Ignore" : "Categorize as…")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="categorize">Categorize as…</SelectItem>
                <SelectItem value="ignore">Ignore</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {ignoring ? (
            <p className="text-xs text-muted-foreground">
              Matching transactions leave Review, money in or out - so both halves of a transfer between your
              own accounts clear. They can be restored later.
            </p>
          ) : isIncome ? (
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
          )}
          {!ignoring && (
          <div className="flex items-center gap-2">
            <Checkbox checked={tagDebt} onCheckedChange={(c) => handleTagDebtChange(c === true)} />
            <Label className="font-normal">
              {isIncome ? "Also record as a loan (add to Debt)" : "Also tag as a debt repayment"}
            </Label>
          </div>
          )}
          {!ignoring && tagDebt && (
            <PersonPickerField
              idPrefix="rule-dialog"
              label={isIncome ? "Borrowed from" : "Paying back"}
              placeholder="Choose who"
              people={people}
              personId={personId}
              onPersonIdChange={setPersonId}
              newPersonName={newPersonName}
              onNewPersonNameChange={setNewPersonName}
            />
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
                    <tr key={row.id} className="row-line border-b border-border last:border-0" data-testid="preview-row">
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
            {saving ? "Saving…" : `Create rule & ${ignoring ? "ignore" : "categorize"} ${tickedIds.length}`}
          </Button>
        </DialogFooter>
      </div>
    )}
    </>
  );
}
