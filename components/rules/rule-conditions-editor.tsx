"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_CONDITIONS, OPERATORS_BY_FIELD, type ConditionInput, type RuleField } from "@/lib/rules";

/** A condition as the editor holds it: amounts in pounds, as typed, plus a
 * stable key so removing one in the middle doesn't scramble the inputs. */
export type EditorCondition = ConditionInput & { key: number };

let nextKey = 1;
export function newEditorCondition(
  field: RuleField = "payee",
  operator: ConditionInput["operator"] = "contains",
  value = ""
): EditorCondition {
  return { key: nextKey++, field, operator, value };
}

/** "Match all of the following" list of conditions - add, remove, edit.
 * Pure UI: parsing/validation lives in lib/rules (parseConditionInputs). */
export function RuleConditionsEditor({
  conditions,
  onChange,
  accounts = [],
}: {
  conditions: EditorCondition[];
  onChange: (next: EditorCondition[]) => void;
  /** Linked bank accounts - enables the "Account" condition. */
  accounts?: { id: number; name: string }[];
}) {
  function update(key: number, patch: Partial<ConditionInput>) {
    onChange(conditions.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function changeField(key: number, field: RuleField) {
    // Switching field resets the operator (each field has its own set)
    // and the value (payee text and a pound amount aren't interchangeable).
    update(key, { field, operator: OPERATORS_BY_FIELD[field][0].value, value: "" });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        {conditions.length > 1 ? "Match when ALL of these are true" : "Match when"}
      </p>
      {conditions.map((c, i) => (
        <div key={c.key} className="flex items-center gap-2" data-testid={`condition-${i}`}>
          <Select value={c.field} onValueChange={(v) => changeField(c.key, (v as RuleField) ?? "payee")}>
            <SelectTrigger className="w-28" aria-label={`Condition ${i + 1} field`}>
              <SelectValue>{(v: string) => (v === "payee" ? "Payee" : v === "account" ? "Account" : "Amount")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="payee">Payee</SelectItem>
              <SelectItem value="amount">Amount</SelectItem>
              {(accounts.length > 0 || c.field === "account") && <SelectItem value="account">Account</SelectItem>}
            </SelectContent>
          </Select>
          <Select
            value={c.operator}
            onValueChange={(v) => update(c.key, { operator: (v as ConditionInput["operator"]) ?? c.operator })}
          >
            <SelectTrigger className="w-36" aria-label={`Condition ${i + 1} comparison`}>
              <SelectValue>
                {(v: string) => OPERATORS_BY_FIELD[c.field].find((o) => o.value === v)?.label ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OPERATORS_BY_FIELD[c.field].map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {c.field === "account" ? (
            <Select value={c.value} onValueChange={(v) => update(c.key, { value: v ?? "" })}>
              <SelectTrigger className="min-w-0 flex-1" aria-label={`Condition ${i + 1} value`}>
                <SelectValue>
                  {(v: string) => (v ? (accounts.find((a) => String(a.id) === v)?.name ?? "Unknown account") : "Choose an account")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
          <Input
            className="min-w-0 flex-1"
            aria-label={`Condition ${i + 1} value`}
            inputMode={c.field === "amount" ? "decimal" : "text"}
            placeholder={c.field === "payee" ? "e.g. tesco" : "e.g. 10.00"}
            value={c.value}
            onChange={(e) => update(c.key, { value: e.target.value })}
          />
          )}
          {c.field === "amount" && <span className="text-xs text-muted-foreground">£</span>}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={conditions.length === 1}
            title="Remove this condition"
            aria-label={`Remove condition ${i + 1}`}
            onClick={() => onChange(conditions.filter((x) => x.key !== c.key))}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      {conditions.length < MAX_CONDITIONS && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...conditions, newEditorCondition("amount", "is", "")])}
        >
          <Plus className="size-3.5" />
          Add condition
        </Button>
      )}
    </div>
  );
}
