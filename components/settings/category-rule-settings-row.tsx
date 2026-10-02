"use client";

import { useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeCategoryRule } from "@/app/settings/bank-sync-actions";

const OPERATOR_LABEL: Record<string, string> = {
  contains: "contains",
  is: "is",
  gt: "is more than",
  lt: "is less than",
};

export type RuleConditionDisplay = {
  field: "payee" | "amount";
  operator: "contains" | "is" | "gt" | "lt";
  /** Already display-ready - amounts formatted, not raw pence. */
  value: string;
};

export function CategoryRuleSettingsRow({
  id,
  conditions,
  targetName,
  debtPersonName,
  debtKind = "repayment",
}: {
  id: number;
  conditions: RuleConditionDisplay[];
  /** The expense category or income source this rule routes to - whichever
   * it is, this is already the resolved display name, not an id. */
  targetName: string;
  debtPersonName: string | null;
  /** repayment = money out paying them back; loan = money in borrowed from them. */
  debtKind?: "repayment" | "loan";
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <p>
        If{" "}
        {conditions.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> and </span>}
            <span className="font-medium">{c.field}</span> {OPERATOR_LABEL[c.operator]}{" "}
            <span className="font-medium">&ldquo;{c.value}&rdquo;</span>
          </span>
        ))}{" "}
        → <span className="font-medium">{targetName}</span>
        {debtPersonName && (
          <span className="text-muted-foreground">
            {" "}
            ({debtKind === "loan" ? "loan from" : "repayment to"} {debtPersonName})
          </span>
        )}
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
