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

export function PreferencesSettings({
  currency,
  dateFormat,
}: {
  currency: string;
  dateFormat: DateFormat;
}) {
  const [pending, startTransition] = useTransition();
  // Local echo so the Select updates instantly instead of waiting on the
  // root layout's revalidation round-trip - reset if the server value ever
  // disagrees (e.g. another tab changed it first).
  const [localCurrency, setLocalCurrency] = useState(currency);
  const [localDateFormat, setLocalDateFormat] = useState(dateFormat);

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

      {pending && <p className="text-xs text-muted-foreground">Saving…</p>}
    </div>
  );
}
