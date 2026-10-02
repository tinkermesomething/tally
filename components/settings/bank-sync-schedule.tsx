"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updatePreferences } from "@/app/settings/actions";

const FREQUENCIES = [
  { hours: 6, label: "Every 6 hours" },
  { hours: 12, label: "Every 12 hours" },
  { hours: 24, label: "Once a day" },
];

export function BankSyncSchedule({
  enabled,
  frequencyHours,
}: {
  enabled: boolean;
  frequencyHours: number;
}) {
  const [localEnabled, setLocalEnabled] = useState(enabled);
  const [localFrequency, setLocalFrequency] = useState(frequencyHours);
  const [, startTransition] = useTransition();

  function handleToggle(next: boolean) {
    setLocalEnabled(next);
    startTransition(() => updatePreferences({ bankSyncEnabled: next }));
  }

  function handleFrequencyChange(value: string | null) {
    if (!value) return;
    const hours = parseInt(value, 10);
    setLocalFrequency(hours);
    startTransition(() => updatePreferences({ bankSyncFrequencyHours: hours }));
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium">Scheduled sync</h2>
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
        <div>
          <p className="text-sm">Sync automatically</p>
          <p className="text-xs text-muted-foreground">
            Off by default - GoCardless limits how often each account can be checked, and manual
            syncs count toward the same limit, so pick a frequency you&apos;re comfortable with.
          </p>
        </div>
        <Switch checked={localEnabled} onCheckedChange={handleToggle} />
      </div>
      {localEnabled && (
        <Select value={String(localFrequency)} onValueChange={handleFrequencyChange}>
          <SelectTrigger className="w-44">
            <SelectValue>
              {(value: string) => FREQUENCIES.find((f) => String(f.hours) === value)?.label ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((f) => (
              <SelectItem key={f.hours} value={String(f.hours)}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
