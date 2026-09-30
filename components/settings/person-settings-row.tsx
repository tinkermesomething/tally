"use client";

import { useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPence } from "@/lib/money";
import { cn } from "@/lib/utils";
import { removePerson } from "@/app/debt/actions";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import type { PersonWithBalance } from "@/lib/db/debt";

export function PersonSettingsRow({ person }: { person: PersonWithBalance }) {
  const { currency } = useAppSettings();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex flex-col">
        <span className="font-medium">{person.name}</span>
        {person.balancePence !== 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              person.balancePence > 0 ? "text-status-critical" : "text-status-good"
            )}
          >
            {person.balancePence > 0
              ? `You owe ${formatPence(person.balancePence, currency)}`
              : `Owed to you ${formatPence(-person.balancePence, currency)}`}
          </span>
        )}
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={pending}
        title="Archive"
        onClick={() => startTransition(() => removePerson(person.id))}
      >
        <Archive className="size-3.5" />
      </Button>
    </div>
  );
}
