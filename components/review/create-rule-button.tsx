"use client";

import { useState, useTransition, useRef } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";
import { createCategoryRule } from "@/app/settings/bank-sync-actions";

type Field = "payee" | "amount";

/** Creates an auto-categorization rule using whatever category/income
 * source/debt-tag the row's own controls currently have selected - the
 * row's existing choice is also the rule's action, so it isn't re-asked
 * here (same target, just "do this automatically next time"). */
export function CreateRuleButton({
  payeeClean,
  payeeRaw,
  amountPence,
  target,
}: {
  payeeClean: string | null;
  payeeRaw: string;
  amountPence: number;
  /** Resolved lazily (debtPersonId may require creating a new person) only
   * when "Create rule" is actually clicked. */
  target:
    | { targetType: "expense"; categoryId: number; resolveDebtPersonId: () => Promise<number | undefined> }
    | { targetType: "income"; incomeSourceId: number };
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<Field>("payee");
  const [value, setValue] = useState(payeeClean ?? payeeRaw);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);

  function handleFieldChange(next: Field) {
    setField(next);
    setValue(next === "payee" ? payeeClean ?? payeeRaw : (Math.abs(amountPence) / 100).toFixed(2));
  }

  function handleCreate() {
    if (!value.trim()) {
      setError("Enter a value to match.");
      return;
    }
    if (field === "amount" && Number.isNaN(parseFloat(value))) {
      setError("Amount must be a number.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const matchValue = field === "amount" ? String(Math.round(parseFloat(value) * 100)) : value.trim();
        if (target.targetType === "expense") {
          const debtPersonId = await target.resolveDebtPersonId();
          await createCategoryRule({
            field,
            operator: field === "payee" ? "contains" : "is",
            value: matchValue,
            targetType: "expense",
            categoryId: target.categoryId,
            debtPersonId,
          });
        } else {
          await createCategoryRule({
            field,
            operator: field === "payee" ? "contains" : "is",
            value: matchValue,
            targetType: "income",
            incomeSourceId: target.incomeSourceId,
          });
        }
        setDone(true);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create rule.");
      }
    });
  }

  if (done) {
    return <span className="text-xs text-muted-foreground">Rule created</span>;
  }

  return (
    <>
      <Button ref={anchorRef} size="icon-xs" variant="ghost" title="Create a rule from this" onClick={() => setOpen((v) => !v)}>
        <Repeat className="size-3.5" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverPortal>
          <PopoverPositioner anchor={anchorRef} align="end" sideOffset={4}>
            <PopoverPopup>
              <div className="w-56 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Auto-apply this category{target.targetType === "expense" ? " (and debt tag, if set)" : ""} to future matches.
                </p>
                <Select value={field} onValueChange={(v) => handleFieldChange((v as Field) ?? "payee")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => (v === "payee" ? "If payee contains" : "If amount is exactly")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="payee">If payee contains</SelectItem>
                    <SelectItem value="amount">If amount is exactly</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode={field === "amount" ? "decimal" : "text"}
                  placeholder={field === "payee" ? "e.g. netflix" : "e.g. 50.00"}
                />
                {error && <p className="text-xs text-status-critical">{error}</p>}
                <Button size="sm" className="w-full" onClick={handleCreate} disabled={pending}>
                  Create rule
                </Button>
              </div>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </>
  );
}
