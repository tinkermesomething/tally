"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
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
import { createCategoryRule } from "@/app/settings/bank-sync-actions";
import { RuleConditionsEditor, newEditorCondition, type EditorCondition } from "@/components/rules/rule-conditions-editor";
import { parseConditionInputs } from "@/lib/rules";
import { NEW_PERSON, PersonPickerField, usePersonSelection } from "@/components/grid/person-picker";

type TargetType = "expense" | "income";

export function AddCategoryRuleDialog({
  categories,
  incomeSources,
  people,
}: {
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
  const { personId, setPersonId, newPersonName, setNewPersonName, reset: resetPerson, resolvePersonId } =
    usePersonSelection();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setConditions([newEditorCondition()]);
    setTargetType("expense");
    setCategoryId("");
    setIncomeSourceId("");
    setTagDebt(false);
    resetPerson();
    setError(null);
  }

  function handleTargetTypeChange(next: TargetType) {
    setTargetType(next);
    // Debt-tagging a rule only makes sense alongside an expense category -
    // the debt ledger already models someone repaying you as its own
    // entry, unconnected to bank-sync, so there's nothing for an
    // income-targeted rule to tag.
    if (next === "income") setTagDebt(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    if (tagDebt && !personId) {
      setError("Pick who this repayment is to, or turn off the debt tag.");
      return;
    }
    if (tagDebt && personId === NEW_PERSON && !newPersonName.trim()) {
      setError("Enter the new person's name.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        if (targetType === "expense") {
          const debtPersonId = tagDebt ? await resolvePersonId() : undefined;
          await createCategoryRule({
            conditions: parsed.conditions,
            targetType: "expense",
            categoryId: parseInt(categoryId, 10),
            debtPersonId,
          });
        } else {
          await createCategoryRule({
            conditions: parsed.conditions,
            targetType: "income",
            incomeSourceId: parseInt(incomeSourceId, 10),
          });
        }
        reset();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add rule.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Plus className="size-4" />
            Add rule
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New auto-categorization rule</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-target-type">Routes to</Label>
            <Select
              value={targetType}
              onValueChange={(v) => handleTargetTypeChange((v as TargetType) ?? "expense")}
            >
              <SelectTrigger id="rule-target-type" className="w-full">
                <SelectValue>{(v: string) => (v === "income" ? "Income source" : "Expense category")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense category</SelectItem>
                <SelectItem value="income">Income source</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <RuleConditionsEditor conditions={conditions} onChange={setConditions} />

          {targetType === "expense" ? (
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

          {targetType === "expense" && (
            <>
              <div className="flex items-center gap-2">
                <Checkbox checked={tagDebt} onCheckedChange={(checked) => setTagDebt(checked === true)} />
                <Label className="font-normal">Also tag as a debt repayment</Label>
              </div>

              {tagDebt && (
                <PersonPickerField
                  idPrefix="rule"
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

          {error && <p className="text-sm text-status-critical">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
