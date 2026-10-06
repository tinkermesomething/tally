"use client";

import { useTransition } from "react";
import { Anchor, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveIncomeSource, setPayAnchor } from "@/app/grid/actions";

export function IncomeSourceSettingsRow({
  id,
  name,
  isPayAnchor,
}: {
  id: number;
  name: string;
  isPayAnchor: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-between gap-2 row-card rounded-lg bg-card px-3 py-2">
      <span className="font-medium">{name}</span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => setPayAnchor(isPayAnchor ? null : id))}
          title={
            isPayAnchor
              ? "This source sets the budget month for expenses logged from now on - click to unset"
              : "Make this the pay anchor: logging an entry here lets you pick which budget month it (and everything logged after it) counts toward"
          }
          className={
            isPayAnchor
              ? "inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.65rem] text-primary"
              : "shrink-0 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:border-muted-foreground"
          }
        >
          <Anchor className="size-3" />
          {isPayAnchor ? "Pay anchor" : "Set as pay anchor"}
        </button>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          title="Archive"
          onClick={() => startTransition(() => archiveIncomeSource(id))}
        >
          <Archive className="size-3.5 text-chart-2" />
        </Button>
      </div>
    </div>
  );
}
