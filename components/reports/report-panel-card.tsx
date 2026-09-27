"use client";

import { useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryPieChart, type GroupSlice } from "@/components/reports/category-pie-chart";
import { ReportPanelDialog } from "@/components/reports/report-panel-dialog";
import { deleteReportPanel } from "@/app/reports/actions";
import { formatPence } from "@/lib/money";
import type { ReportPanel } from "@/lib/db/queries";

export function ReportPanelCard({
  panel,
  slices,
  existingGroups,
  categories,
}: {
  panel: ReportPanel;
  slices: GroupSlice[];
  existingGroups: string[];
  categories: { id: number; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const total = slices.reduce((sum, s) => sum + s.amountPence, 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h2 className="font-medium">{panel.name}</h2>
          <p className="text-sm text-muted-foreground">Where {formatPence(total)} is allocated.</p>
        </div>
        <div className="flex items-center gap-1">
          <ReportPanelDialog
            panel={panel}
            existingGroups={existingGroups}
            categories={categories}
            trigger={
              <Button size="icon-xs" variant="ghost" title="Edit panel">
                <Pencil className="size-3.5" />
              </Button>
            }
          />
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={pending}
            title="Delete panel"
            onClick={() => startTransition(() => deleteReportPanel(panel.id))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <CategoryPieChart slices={slices} />
    </div>
  );
}
