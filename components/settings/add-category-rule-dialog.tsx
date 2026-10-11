"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import { saveRule, saveRuleChanges } from "@/app/review/rule-actions";
import { RulePreviewPanel, useRulePreview } from "@/components/rules/rule-preview-panel";
import { NEW_BUCKET, SavingsTagField, useBucketSelection } from "@/components/rules/savings-tag-field";
import type { CreateRuleAndApplyResult } from "@/lib/db/bank-sync";
import { RuleConditionsEditor, newEditorCondition, type EditorCondition } from "@/components/rules/rule-conditions-editor";
import { parseConditionInputs } from "@/lib/rules";
import { NEW_PERSON, PersonPickerField, usePersonSelection } from "@/components/grid/person-picker";

type TargetType = "expense" | "income" | "ignore";

/** An existing rule, as the edit form starts: amounts in pounds, as typed. */
export type EditableRule = {
  id: number;
  conditions: { field: "payee" | "amount" | "account"; operator: "contains" | "is" | "gt" | "lt"; value: string }[];
  targetType: TargetType;
  categoryId: number | null;
  incomeSourceId: number | null;
  debtPersonId: number | null;
  savingsBucketId?: number | null;
};

/** Adds a rule - or, given `rule`, edits that one in place (same fields,
 * same checks). */
export function AddCategoryRuleDialog({
  categories,
  incomeSources,
  people,
  accounts = [],
  buckets = [],
  rule,
}: {
  /** Savings buckets an expense rule can also pay into. */
  buckets?: { id: number; name: string }[];
  rule?: EditableRule;
  accounts?: { id: number; name: string }[];
  categories: { id: number; name: string }[];
  incomeSources: { id: number; name: string }[];
  people: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [conditions, setConditions] = useState<EditorCondition[]>(() => [newEditorCondition()]);
  const [targetType, setTargetType] = useState<TargetType>("expense");
  const [categoryId, setCategoryId] = useState("");
  const [incomeSourceId, setIncomeSourceId] = useState("");
  const [tagDebt, setTagDebt] = useState(false);
  const [toSavings, setToSavings] = useState(false);
  const { bucketId, setBucketId, newBucketName, setNewBucketName, reset: resetBucket, resolveBucketId } = useBucketSelection();
  const [result, setResult] = useState<CreateRuleAndApplyResult | null>(null);
  const { personId, setPersonId, newPersonName, setNewPersonName, reset: resetPerson, resolvePersonId } =
    usePersonSelection();
  const [error, setError] = useState<string | null>(null);
  // The message sits at the bottom of a long dialog: bring it into view so a problem is never silent.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [error]);
  const [pending, startTransition] = useTransition();

  // Fresh form for a new rule; the rule's current values when editing.
  // Runs on every open, so a cancelled edit never leaves stale input behind.
  function reset() {
    setConditions(
      rule ? rule.conditions.map((c) => newEditorCondition(c.field, c.operator, c.value)) : [newEditorCondition()]
    );
    setTargetType(rule?.targetType ?? "expense");
    setCategoryId(rule?.categoryId ? String(rule.categoryId) : "");
    setIncomeSourceId(rule?.incomeSourceId ? String(rule.incomeSourceId) : "");
    setTagDebt(!!rule?.debtPersonId);
    setToSavings(!!rule?.savingsBucketId);
    resetBucket();
    if (rule?.savingsBucketId) setBucketId(String(rule.savingsBucketId));
    setResult(null);
    resetPerson();
    if (rule?.debtPersonId) setPersonId(String(rule.debtPersonId));
    setError(null);
  }

  function handleTargetTypeChange(next: TargetType) {
    setTargetType(next);
  }

  // What the rule would catch among the transactions waiting in Review.
  // For an expense rule it also finds PAST expenses that would gain the debt /
  // savings tag, so a tag forgotten when the rule was made can be added later.
  const previewTags =
    targetType === "expense" && categoryId
      ? {
          categoryId: parseInt(categoryId, 10),
          // a person / bucket still to be created counts as chosen (-1): the list only needs to know a tag is coming
          debtPersonId: tagDebt && personId ? (personId === NEW_PERSON ? -1 : parseInt(personId, 10)) : undefined,
          savingsBucketId: toSavings && bucketId ? (bucketId === NEW_BUCKET ? -1 : parseInt(bucketId, 10)) : undefined,
        }
      : undefined;
  const { parsed: livePreviewParsed, tickedIds, retroTickedIds, ...previewState } = useRulePreview(conditions, targetType, rule?.id, previewTags);
  const previewPanelState = { parsed: livePreviewParsed, tickedIds, retroTickedIds, ...previewState };
  const applyCount = tickedIds.length + retroTickedIds.length;

  function submit(apply: boolean) {
    const parsed = parseConditionInputs(conditions);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (targetType === "expense" && !categoryId) {
      setError("Pick a category.");
      return;
    }
    if (targetType === "income" && !incomeSourceId) {
      setError("Pick an income source.");
      return;
    }
    if (targetType !== "ignore" && tagDebt && !personId) {
      setError(targetType === "income" ? "Pick who you borrowed this from, or turn off the loan tag." : "Pick who this repayment is to, or turn off the debt tag.");
      return;
    }
    if (tagDebt && personId === NEW_PERSON && !newPersonName.trim()) {
      setError("Enter their name.");
      return;
    }
    if (targetType === "expense" && toSavings && !bucketId) {
      setError("Pick a savings bucket (or create one), or untick \"Tag as savings\".");
      return;
    }
    if (targetType === "expense" && toSavings && bucketId === NEW_BUCKET && !newBucketName.trim()) {
      setError("Enter a name for the new savings bucket.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const debtPersonId = targetType !== "ignore" && tagDebt ? await resolvePersonId() : undefined;
        const target =
          targetType === "ignore"
            ? ({ targetType: "ignore" } as const)
            : targetType === "expense"
              ? ({
                  targetType: "expense",
                  categoryId: parseInt(categoryId, 10),
                  debtPersonId,
                  savingsBucketId: toSavings && bucketId ? await resolveBucketId() : undefined,
                } as const)
              : ({ targetType: "income", incomeSourceId: parseInt(incomeSourceId, 10), debtPersonId } as const);
        const input = { conditions: parsed.conditions, target, applyToIds: apply ? tickedIds : [], tagExpenseIds: apply ? retroTickedIds : [] };
        const res = rule ? await saveRuleChanges(rule.id, input) : await saveRule(input);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // Say what happened to waiting transactions before closing, so an
        // applied (or skipped) row is never a surprise.
        if (apply && (res.result.categorized > 0 || res.result.tagged > 0 || res.result.skipped.length > 0)) {
          setResult(res.result);
          return;
        }
        if (!rule) reset();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save the rule.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next || !rule) reset();
      }}
    >
      <DialogTrigger
        render={
          rule ? (
            <Button size="icon-xs" variant="ghost" title="Edit rule" aria-label="Edit rule">
              <Pencil className="size-3.5 text-chart-1" />
            </Button>
          ) : (
            <Button size="sm" variant="outline">
              <Plus className="size-4 text-chart-6" />
              Add rule
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit rule" : "New auto-categorization rule"}</DialogTitle>
        </DialogHeader>
        {result ? (
        <div className="space-y-3" data-testid="rule-result">
          <p className="text-sm">
            Rule saved.{" "}
            {result.categorized > 0 &&
              `${targetType === "ignore" ? "Ignored" : "Categorized"} ${result.categorized} waiting transaction${result.categorized === 1 ? "" : "s"}. `}
            {result.tagged > 0 && `Tagged ${result.tagged} past transaction${result.tagged === 1 ? "" : "s"}. `}
            It also applies to future imports.
          </p>
          {result.skipped.length > 0 && (
            <div className="space-y-1 rounded-lg border border-border bg-secondary p-2 text-sm">
              <p className="font-medium">{result.skipped.length} not applied:</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {result.skipped.slice(0, 5).map((sk) => (
                  <li key={sk.id}>{sk.reason}</li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                if (!rule) reset();
                setOpen(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </div>
        ) : (
        <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-target-type">Routes to</Label>
            <Select
              value={targetType}
              onValueChange={(v) => handleTargetTypeChange((v as TargetType) ?? "expense")}
            >
              <SelectTrigger id="rule-target-type" className="w-full">
                <SelectValue>{(v: string) => (v === "income" ? "Income source" : v === "ignore" ? "Ignore" : "Expense category")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense category</SelectItem>
                <SelectItem value="income">Income source</SelectItem>
                <SelectItem value="ignore">Ignore (money in or out)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <RuleConditionsEditor conditions={conditions} onChange={setConditions} accounts={accounts} />

          {targetType === "ignore" ? null : targetType === "expense" ? (
            <div className="space-y-1.5">
              <Label htmlFor="rule-category">Category</Label>
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                <SelectTrigger id="rule-category" className="w-full">
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
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rule-income-source">Income source</Label>
              <Select value={incomeSourceId} onValueChange={(v) => setIncomeSourceId(v ?? "")}>
                <SelectTrigger id="rule-income-source" className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v ? (incomeSources.find((s) => String(s.id) === v)?.name ?? v) : "Choose an income source"
                    }
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
            </div>
          )}

          {targetType !== "ignore" && (
          <div className="flex items-center gap-2">
            <Checkbox
              aria-label={targetType === "income" ? "Tag as a loan" : "Tag as a debt repayment"}
              checked={tagDebt}
              onCheckedChange={(checked) => {
                setTagDebt(checked === true);
                // no people yet: go straight to naming the first one
                if (checked === true && people.length === 0 && !personId) setPersonId(NEW_PERSON);
              }}
            />
            <Label className="font-normal">
              {targetType === "income" ? "Tag as a loan (add to Debt)" : "Tag as a debt repayment"}
            </Label>
          </div>
          )}

          {targetType === "expense" && (
            <SavingsTagField buckets={buckets} checked={toSavings} onCheckedChange={setToSavings} bucketId={bucketId} onBucketIdChange={setBucketId} newBucketName={newBucketName} onNewBucketNameChange={setNewBucketName} />
          )}

          {targetType !== "ignore" && tagDebt && (
            <PersonPickerField
              idPrefix="rule"
              label={targetType === "income" ? "Borrowed from" : "Paying back"}
              placeholder="Choose who"
              people={people}
              personId={personId}
              onPersonIdChange={setPersonId}
              newPersonName={newPersonName}
              onNewPersonNameChange={setNewPersonName}
            />
          )}

          <RulePreviewPanel state={previewPanelState} />

          {error && (
            <p role="alert" ref={errorRef} className="text-sm text-status-critical">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Saving…" : rule ? "Save rule" : "Add rule"}
            </Button>
            <Button type="button" disabled={pending || applyCount === 0} onClick={() => submit(true)}>
              {rule ? "Save" : "Add"} &amp; apply to {applyCount}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
