"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { NEW_BUCKET, SavingsTagField, useBucketSelection } from "@/components/rules/savings-tag-field";
import { saveRule } from "@/app/review/rule-actions";
import { RulePreviewPanel, useRulePreview } from "@/components/rules/rule-preview-panel";
import { findLoansSourceId } from "@/lib/loans";
import type { CreateRuleAndApplyResult } from "@/lib/db/bank-sync";

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
  /** Savings buckets an expense rule can also pay into. */
  buckets?: { id: number; name: string }[];
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
  buckets = [],
  accounts = [],
  onApplied,
  onDone,
}: { context: RuleContext; onApplied: () => void; onDone: () => void } & Lists) {
  const { transaction, isIncome } = context;
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
  const [toSavings, setToSavings] = useState(false);
  const { bucketId, setBucketId, newBucketName, setNewBucketName, resolveBucketId } = useBucketSelection();
  const { personId, setPersonId, newPersonName, setNewPersonName, resolvePersonId } = usePersonSelection();
  useEffect(() => {
    if (context.initialTagDebt && context.initialPersonId) setPersonId(context.initialPersonId);
    // once, on open - the body remounts for every open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleTagDebtChange(next: boolean) {
    setTagDebt(next);
    // no lenders yet: go straight to naming the first one
    if (next && people.length === 0 && !personId) setPersonId(NEW_PERSON);
    // A loan suggests the loans income source - only when none is chosen.
    if (next && isIncome && !incomeSourceId) {
      const loansId = findLoansSourceId(incomeSources);
      if (loansId) setIncomeSourceId(loansId);
    }
  }
  const [error, setError] = useState<string | null>(null);
  // The message sits at the bottom of a long dialog: bring it into view so a problem is never silent.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [error]);
  const [result, setResult] = useState<CreateRuleAndApplyResult | null>(null);
  const [saving, startSaving] = useTransition();
  // Also finds PAST expenses in the chosen category that would gain the debt / savings tag.
  const previewTags =
    !ignoring && !isIncome && categoryId
      ? {
          categoryId: parseInt(categoryId, 10),
          // a lender / bucket still to be created counts as chosen (-1): the list only needs to know a tag is coming
          debtPersonId: tagDebt && personId ? (personId === NEW_PERSON ? -1 : parseInt(personId, 10)) : undefined,
          savingsBucketId: toSavings && bucketId ? (bucketId === NEW_BUCKET ? -1 : parseInt(bucketId, 10)) : undefined,
        }
      : undefined;
  const { parsed, tickedIds, retroTickedIds, ...previewState } = useRulePreview(conditions, direction, undefined, previewTags);
  const pv = { parsed, tickedIds, retroTickedIds, ...previewState };
  const applyCount = tickedIds.length + retroTickedIds.length;

  const hasTarget = ignoring || (isIncome ? !!incomeSourceId : !!categoryId);

  function submit(apply: boolean) {
    if (!parsed.ok) return setError(parsed.error);
    if (!hasTarget) return setError(isIncome ? "Pick an income source." : "Pick a category.");
    if (!ignoring && tagDebt && !personId) {
      return setError(isIncome ? "Pick who you borrowed this from, or turn off the loan tag." : "Pick who this repayment is to, or turn off the debt tag.");
    }
    if (!ignoring && tagDebt && personId === NEW_PERSON && !newPersonName.trim()) return setError("Enter the new lender's name.");
    if (!ignoring && !isIncome && toSavings && !bucketId) return setError("Pick a savings bucket (or create one), or untick \"Tag as savings\".");
    if (!ignoring && !isIncome && toSavings && bucketId === NEW_BUCKET && !newBucketName.trim()) return setError("Enter a name for the new savings bucket.");
    setError(null);
    startSaving(async () => {
      try {
        const debtPersonId = !ignoring && tagDebt ? await resolvePersonId() : undefined;
        const target = ignoring
          ? ({ targetType: "ignore" } as const)
          : isIncome
            ? ({ targetType: "income", incomeSourceId: parseInt(incomeSourceId, 10), debtPersonId } as const)
            : ({
                targetType: "expense",
                categoryId: parseInt(categoryId, 10),
                debtPersonId,
                savingsBucketId: toSavings && bucketId ? await resolveBucketId() : undefined,
              } as const);
        const res = await saveRule({ conditions: parsed.conditions, target, applyToIds: apply ? tickedIds : [], tagExpenseIds: apply ? retroTickedIds : [] });
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
            {result.tagged > 0 ? `Tagged ${result.tagged} past transaction${result.tagged === 1 ? "" : "s"}. ` : ""}
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
            <Checkbox aria-label={isIncome ? "Tag as a loan" : "Tag as a debt repayment"} checked={tagDebt} onCheckedChange={(c) => handleTagDebtChange(c === true)} />
            <Label className="font-normal">
              {isIncome ? "Tag as a loan (add to Debt)" : "Tag as a debt repayment"}
            </Label>
          </div>
          )}
          {!ignoring && !isIncome && (
            <SavingsTagField buckets={buckets} checked={toSavings} onCheckedChange={setToSavings} bucketId={bucketId} onBucketIdChange={setBucketId} newBucketName={newBucketName} onNewBucketNameChange={setNewBucketName} />
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

        <RulePreviewPanel state={pv} />

        {error && (
          <p role="alert" ref={errorRef} className="text-sm text-status-critical">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving || !parsed.ok} onClick={() => submit(false)}>
            Create rule
          </Button>
          <Button type="button" disabled={saving || !parsed.ok || applyCount === 0} onClick={() => submit(true)}>
            {saving ? "Saving…" : `Create rule & apply to ${applyCount}`}
          </Button>
        </DialogFooter>
      </div>
    )}
    </>
  );
}
