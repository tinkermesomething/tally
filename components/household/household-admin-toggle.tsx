"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { setHouseholdEnabledAction } from "@/app/household/actions";
import { runAction } from "@/lib/action-result";

export function HouseholdAdminToggle({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setLocal(next);
    setError(null);
    startTransition(async () => {
      const failure = await runAction(() => setHouseholdEnabledAction(next));
      if (failure) {
        setLocal(!next);
        setError(failure);
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm">Enable household budget</p>
        <p className="text-xs text-muted-foreground">
          Adds a read-only &quot;Household&quot; tab for everyone, built from whatever each person chooses to share from
          their own budget - nobody&apos;s private data is exposed by turning this on.
        </p>
        {error && <p className="text-xs text-status-critical">{error}</p>}
      </div>
      <Switch checked={local} disabled={pending} onCheckedChange={toggle} />
    </div>
  );
}
