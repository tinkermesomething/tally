"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MONTH_NAMES } from "@/lib/months";

/** The "billed yearly, not monthly" checkbox + billing-month picker, shared
 * between AddCategoryDialog and AddSubcategoryDialog - the two forms are
 * otherwise different (parent/group pickers only make sense at the top
 * level), but this pair of fields is identical between them. */
export function AnnualBillingFields({
  idPrefix,
  isAnnual,
  onIsAnnualChange,
  annualMonth,
  onAnnualMonthChange,
}: {
  /** Distinguishes this instance's element ids from the other dialog's,
   * since both can't render at once but ids should still be unique. */
  idPrefix: string;
  isAnnual: boolean;
  onIsAnnualChange: (isAnnual: boolean) => void;
  annualMonth: string;
  onAnnualMonthChange: (annualMonth: string) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idPrefix}-annual`}
          checked={isAnnual}
          onCheckedChange={(checked) => onIsAnnualChange(checked === true)}
        />
        <Label htmlFor={`${idPrefix}-annual`} className="font-normal">
          Billed yearly, not monthly
        </Label>
      </div>

      {isAnnual && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-annual-month`}>Usually billed in</Label>
          <Select value={annualMonth} onValueChange={(v) => onAnnualMonthChange(v ?? "1")}>
            <SelectTrigger id={`${idPrefix}-annual-month`} className="w-full">
              <SelectValue>
                {(value: string) => MONTH_NAMES[parseInt(value, 10) - 1] ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
}
