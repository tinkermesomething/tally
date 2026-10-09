"use client";

import { useRef, useTransition } from "react";
import { Pencil, Trash2, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryPieChart, type GroupSlice } from "@/components/reports/category-pie-chart";
import { VarianceChart } from "@/components/reports/variance-chart";
import { ReportPanelDialog } from "@/components/reports/report-panel-dialog";
import { deleteReportPanel } from "@/app/reports/actions";
import { formatPence } from "@/lib/money";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { buildVarianceRows, VIEW_PREFIX, type ReportView } from "@/lib/report-view";
import type { ReportPanel } from "@/lib/db/queries";

const sum = (slices: GroupSlice[]) => slices.reduce((s, x) => s + x.amountPence, 0);

export function ReportPanelCard({
  panel,
  view,
  budgeted,
  spent,
  existingGroups,
  categories,
  periodLabel,
}: {
  panel: ReportPanel;
  view: ReportView;
  budgeted: GroupSlice[];
  spent: GroupSlice[];
  existingGroups: string[];
  categories: { id: number; name: string }[];
  /** e.g. "March 2026" or "2026, full year" - same string the whole-page
   * export (ExportPdfButton) uses, so this panel's own PDF title matches. */
  periodLabel: string;
}) {
  const { currency } = useAppSettings();
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  const subtitle =
    view === "budgeted"
      ? `Where ${formatPence(sum(budgeted), currency)} is budgeted.`
      : view === "spent"
        ? `Where ${formatPence(sum(spent), currency)} was actually spent.`
        : `${formatPence(sum(budgeted), currency)} budgeted, ${formatPence(sum(spent), currency)} spent.`;

  /** Exports just THIS panel, not the whole Reports page: marks it as the
   * one `.report-panel` print-single-panel leaves visible (see
   * globals.css), prints (landscape A4 is the page-wide @page default,
   * nothing extra needed here), then undoes both the marker and the title
   * - same restore-on-afterprint approach as ExportPdfButton, duplicated
   * rather than shared since this one also needs the DOM marker step. */
  function exportThisPanel() {
    const node = panelRef.current;
    if (!node) return;
    const previousTitle = document.title;
    document.title = `Tally report - ${VIEW_PREFIX[view]} - ${panel.name} - ${periodLabel}`;
    document.body.classList.add("print-single-panel");
    node.dataset.printTarget = "true";
    const restore = () => {
      document.title = previousTitle;
      document.body.classList.remove("print-single-panel");
      delete node.dataset.printTarget;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    // Confirmed real (whole-page export, not just this panel, every time):
    // calling window.print() in the same tick as the class/attribute change
    // above isn't safe to assume painted first - Safari in particular can
    // snapshot the page for print before that mutation has actually been
    // reflowed. Double requestAnimationFrame is the standard wait-for-a-
    // real-paint technique (one rAF only guarantees "before the next
    // paint", not "after a completed one") - print only fires once the
    // single-panel CSS has actually taken visual effect.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        setTimeout(restore, 4000);
      });
    });
  }

  return (
    <div ref={panelRef} className="report-panel rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h2 className="font-medium">
            {VIEW_PREFIX[view]} — {panel.name}
          </h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1 print:hidden">
          <ReportPanelDialog
            panel={panel}
            existingGroups={existingGroups}
            categories={categories}
            trigger={
              <Button size="icon-xs" variant="ghost" title="Edit panel">
                <Pencil className="size-3.5 text-chart-1" />
              </Button>
            }
          />
          <Button size="icon-xs" variant="ghost" title="Export this panel as PDF" onClick={exportThisPanel}>
            <FileDown className="size-3.5 text-chart-2" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={pending}
            title="Delete panel"
            onClick={() => startTransition(() => deleteReportPanel(panel.id))}
          >
            <Trash2 className="size-3.5 text-status-critical" />
          </Button>
        </div>
      </div>
      <ReportBody view={view} budgeted={budgeted} spent={spent} />
    </div>
  );
}

/** The charts for one panel (or the main one) in the chosen view. */
export function ReportBody({
  view,
  budgeted,
  spent,
}: {
  view: ReportView;
  budgeted: GroupSlice[];
  spent: GroupSlice[];
}) {
  const { currency } = useAppSettings();
  if (view === "budgeted") return <CategoryPieChart slices={budgeted} />;
  if (view === "spent") return <CategoryPieChart slices={spent} emptyLabel="Nothing spent for this period yet." />;
  return (
    <div className="space-y-6">
      {/* .compare-columns (globals.css): two equal halves that can't outgrow the card. */}
      <div className="compare-columns" data-testid="compare-columns">
        <div className="min-w-0" data-testid="compare-budgeted">
          <h3 className="text-sm font-medium">Budgeted</h3>
          <p className="mb-1 text-xs text-muted-foreground">{formatPence(sum(budgeted), currency)}</p>
          <CategoryPieChart slices={budgeted} compact />
        </div>
        <div className="min-w-0" data-testid="compare-spent">
          <h3 className="text-sm font-medium">Spent</h3>
          <p className="mb-1 text-xs text-muted-foreground">{formatPence(sum(spent), currency)}</p>
          <CategoryPieChart slices={spent} compact emptyLabel="Nothing spent for this period yet." />
        </div>
      </div>
      <VarianceChart rows={buildVarianceRows(budgeted, spent)} />
    </div>
  );
}
