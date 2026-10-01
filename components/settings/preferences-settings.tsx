"use client";

import { useState, useTransition } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updatePreferences } from "@/app/settings/actions";
import { CURRENCIES } from "@/lib/money";
import { DATE_FORMATS, DATE_FORMAT_LABELS, type DateFormat } from "@/lib/date-format";
import { MONTH_NAMES } from "@/lib/months";

export function PreferencesSettings({
  currency,
  dateFormat,
  carryOverStartYear,
  carryOverStartMonth,
}: {
  currency: string;
  dateFormat: DateFormat;
  carryOverStartYear: number;
  carryOverStartMonth: number;
}) {
  const [pending, startTransition] = useTransition();
  // Local echo so the Select updates instantly instead of waiting on the
  // root layout's revalidation round-trip - reset if the server value ever
  // disagrees (e.g. another tab changed it first).
  const [localCurrency, setLocalCurrency] = useState(currency);
  const [localDateFormat, setLocalDateFormat] = useState(dateFormat);
  const [localStartYear, setLocalStartYear] = useState(carryOverStartYear);
  const [localStartMonth, setLocalStartMonth] = useState(carryOverStartMonth);
  const startYearOptions = [localStartYear - 1, localStartYear, localStartYear + 1].filter(
    (y, i, arr) => arr.indexOf(y) === i
  );

  return (
    <div className="max-w-sm space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pref-currency">Currency</Label>
        <Select
          value={localCurrency}
          onValueChange={(v) => {
            if (!v || v === localCurrency) return;
            setLocalCurrency(v);
            startTransition(() => updatePreferences({ currency: v }));
          }}
        >
          <SelectTrigger id="pref-currency" className="w-full">
            <SelectValue>
              {(value: string) => CURRENCIES.find((c) => c.code === value)?.label ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pref-date-format">Date format</Label>
        <Select
          value={localDateFormat}
          onValueChange={(v) => {
            if (!v || v === localDateFormat) return;
            const next = v as DateFormat;
            setLocalDateFormat(next);
            startTransition(() => updatePreferences({ dateFormat: next }));
          }}
        >
          <SelectTrigger id="pref-date-format" className="w-full">
            <SelectValue>{(value: string) => DATE_FORMAT_LABELS[value as DateFormat]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DATE_FORMATS.map((f) => (
              <SelectItem key={f} value={f}>
                {DATE_FORMAT_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Only affects how dates are displayed - date pickers always use your browser&apos;s
          own format.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pref-carryover-month">Carry-over starts from</Label>
        <p className="text-xs text-muted-foreground">
          Unspent (or overspent) money from one budget period rolls into the next,
          starting here. Earlier periods are never touched - pick whenever you trust
          the numbers from, not necessarily your very first month using Tally.
        </p>
        <div className="space-y-2 pt-1">
          <Select
            value={String(localStartMonth)}
            onValueChange={(v) => {
              if (!v) return;
              const next = parseInt(v, 10);
              if (next === localStartMonth) return;
              setLocalStartMonth(next);
              startTransition(() => updatePreferences({ carryOverStartMonth: next }));
            }}
          >
            <SelectTrigger id="pref-carryover-month" className="w-full">
              <SelectValue>{(value: string) => MONTH_NAMES[parseInt(value, 10) - 1]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(localStartYear)}
            onValueChange={(v) => {
              if (!v) return;
              const next = parseInt(v, 10);
              if (next === localStartYear) return;
              setLocalStartYear(next);
              startTransition(() => updatePreferences({ carryOverStartYear: next }));
            }}
          >
            <SelectTrigger id="pref-carryover-year" className="w-full">
              <SelectValue>{(value: string) => value}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {startYearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {pending && <p className="text-xs text-muted-foreground">Saving…</p>}
    </div>
  );
}
