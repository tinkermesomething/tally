"use client";

import { useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveIncomeSource } from "@/app/grid/actions";

export function IncomeSourceSettingsRow({ id, name }: { id: number; name: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="font-medium">{name}</span>
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={pending}
        title="Archive"
        onClick={() => startTransition(() => archiveIncomeSource(id))}
      >
        <Archive className="size-3.5" />
      </Button>
    </div>
  );
}
