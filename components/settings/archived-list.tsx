"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ArchivedList({
  items,
  restoreAction,
  emptyLabel,
}: {
  items: { id: number; name: string }[];
  restoreAction: (id: number) => Promise<void>;
  emptyLabel: string;
}) {
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="row-card flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-1.5">
          <span className="text-sm text-muted-foreground">{item.name}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => startTransition(() => restoreAction(item.id))}
          >
            <RotateCcw className="size-3.5 text-chart-3" />
            Restore
          </Button>
        </li>
      ))}
    </ul>
  );
}
