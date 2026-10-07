"use client";

import { useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeCategoryRule } from "@/app/settings/bank-sync-actions";
import { FIELD_COLOR } from "@/lib/field-colors";
import { cn } from "@/lib/utils";

// What a rule does decides the colour of its target, so a glance down the
// list shows which rules ignore, which file expenses and which file income.
const TARGET_STYLE = {
  expense: "bg-chart-3/15 text-chart-3",
  income: "bg-chart-6/15 text-chart-6",
  ignore: "bg-chart-5/15 text-chart-5",
} as const;

const OPERATOR_LABEL: Record<string, string> = {
  contains: "contains",
  is: "is",
  gt: "is more than",
  lt: "is less than",
};

export type RuleConditionDisplay = {
  field: "payee" | "amount" | "account";
  operator: "contains" | "is" | "gt" | "lt";
  /** Already display-ready - amounts formatted, not raw pence. */
  value: string;
};

export function CategoryRuleSettingsRow({
  id,
  conditions,
  targetName,
  debtPersonName,
  savingsBucketName = null,
  debtKind = "repayment",
  targetKind = "expense",
  editor,
}: {
  /** Which kind of target this is, for its colour. */
  targetKind?: keyof typeof TARGET_STYLE;
  /** The edit button (a dialog), rendered beside Remove. */
  editor?: React.ReactNode;
  id: number;
  conditions: RuleConditionDisplay[];
  /** The expense category or income source this rule routes to - whichever
   * it is, this is already the resolved display name, not an id. */
  targetName: string;
  debtPersonName: string | null;
  /** The savings bucket this rule also pays into, if any. */
  savingsBucketName?: string | null;
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
            <span className={cn("font-semibold", FIELD_COLOR[c.field])}>{c.field}</span> {OPERATOR_LABEL[c.operator]}{" "}
            <span className="rounded bg-primary/10 px-1 font-medium">&ldquo;{c.value}&rdquo;</span>
          </span>
        ))}{" "}
        → <span className={cn("rounded px-1.5 py-0.5 font-medium", TARGET_STYLE[targetKind])}>{targetName}</span>
        {debtPersonName && (
          <span className="text-muted-foreground">
            {" "}
            ({debtKind === "loan" ? "loan from" : "repayment to"} {debtPersonName})
          </span>
        )}
        {savingsBucketName && <span className="text-muted-foreground"> (to savings: {savingsBucketName})</span>}
      </p>
      <div className="flex shrink-0 items-center">
        {editor}
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          title="Remove rule"
          onClick={() => startTransition(() => removeCategoryRule(id))}
        >
          <Archive className="size-3.5 text-chart-2" />
        </Button>
      </div>
    </div>
  );
}
