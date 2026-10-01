"use client";

import { useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeCategoryRule } from "@/app/settings/bank-sync-actions";

const OPERATOR_LABEL: Record<string, string> = {
  contains: "contains",
  is: "is",
  gt: ">",
  lt: "<",
};

export function CategoryRuleSettingsRow({
  id,
  field,
  operator,
  value,
  targetName,
  debtPersonName,
}: {
  id: number;
  field: "payee" | "amount";
  operator: "contains" | "is" | "gt" | "lt";
  value: string;
  /** The expense category or income source this rule routes to - whichever
   * it is, this is already the resolved display name, not an id. */
  targetName: string;
  debtPersonName: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <p>
        If <span className="font-medium">{field}</span> {OPERATOR_LABEL[operator]}{" "}
        <span className="font-medium">&ldquo;{value}&rdquo;</span> → <span className="font-medium">{targetName}</span>
        {debtPersonName && <span className="text-muted-foreground"> (repayment to {debtPersonName})</span>}
      </p>
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={pending}
        title="Remove rule"
        onClick={() => startTransition(() => removeCategoryRule(id))}
      >
        <Archive className="size-3.5" />
      </Button>
    </div>
  );
}
