"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { NEW_PERSON, PersonPickerField, usePersonSelection } from "@/components/grid/person-picker";

type Field = "payee" | "amount";
type Operator = "contains" | "is" | "gt" | "lt";

const OPERATORS_BY_FIELD: Record<Field, { value: Operator; label: string }[]> = {
  payee: [
    { value: "contains", label: "contains" },
    { value: "is", label: "is exactly" },
  ],
  amount: [
    { value: "gt", label: "is more than" },
    { value: "lt", label: "is less than" },
    { value: "is", label: "is exactly" },
  ],
};

export function AddCategoryRuleDialog({
  categories,
  people,
}: {
  categories: { id: number; name: string }[];
  people: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<Field>("payee");
  const [operator, setOperator] = useState<Operator>("contains");
  const [value, setValue] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tagDebt, setTagDebt] = useState(false);
  const { personId, setPersonId, newPersonName, setNewPersonName, reset: resetPerson, resolvePersonId } =
    usePersonSelection();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setField("payee");
    setOperator("contains");
    setValue("");
    setCategoryId("");
    setTagDebt(false);
    resetPerson();
    setError(null);
  }

  function handleFieldChange(next: Field) {
    setField(next);
    setOperator(OPERATORS_BY_FIELD[next][0].value);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) {
      setError("Enter a value to match.");
      return;
    }
    if (field === "amount" && Number.isNaN(parseFloat(value))) {
      setError("Amount must be a number (in pounds).");
      return;
    }
    if (!categoryId) {
      setError("Pick a category.");
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
        const debtPersonId = tagDebt ? await resolvePersonId() : undefined;
        await createCategoryRule({
          field,
          operator,
          // Rules match against pence, same as everything else stored in
          // this app - the form takes pounds like every other amount input.
          value: field === "amount" ? String(Math.round(parseFloat(value) * 100)) : value,
          categoryId: parseInt(categoryId, 10),
          debtPersonId,
        });
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New auto-categorization rule</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-field">If</Label>
            <Select value={field} onValueChange={(v) => handleFieldChange((v as Field) ?? "payee")}>
              <SelectTrigger id="rule-field" className="w-full">
                <SelectValue>{(v: string) => (v === "payee" ? "Payee" : "Amount")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="payee">Payee</SelectItem>
                <SelectItem value="amount">Amount</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-operator">Condition</Label>
            <Select value={operator} onValueChange={(v) => setOperator((v as Operator) ?? operator)}>
              <SelectTrigger id="rule-operator" className="w-full">
                <SelectValue>
                  {(v: string) => OPERATORS_BY_FIELD[field].find((o) => o.value === v)?.label ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {OPERATORS_BY_FIELD[field].map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-value">{field === "payee" ? "Text" : "Amount (£)"}</Label>
            <Input
              id="rule-value"
              placeholder={field === "payee" ? "e.g. netflix" : "e.g. 50.00"}
              inputMode={field === "amount" ? "decimal" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>

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
