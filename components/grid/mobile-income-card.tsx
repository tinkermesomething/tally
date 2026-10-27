"use client";

import { GridCell } from "@/components/grid/grid-cell";
import type { IncomeSourceRow } from "@/lib/db/queries";
import { updateIncomeAmount, clearIncomeAmount } from "@/app/grid/actions";

export function MobileIncomeCard({
  source,
  year,
  month,
}: {
  source: IncomeSourceRow;
  year: number;
  month: number;
}) {
  const cell = source.months[month];
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
      <span className="font-medium">{source.name}</span>
      <GridCell
        amountPence={cell?.amountPence}
        paid={true}
        spentPence={cell?.spentPence}
        spentLabel="Received"
        previousAmountPence={cell?.previousAmountPence}
        showPaidToggle={false}
        onCommitAmount={(pounds) => updateIncomeAmount({ incomeSourceId: source.id, year, month, pounds })}
        onClearAmount={() => clearIncomeAmount({ incomeSourceId: source.id, year, month })}
      />
    </div>
  );
}
