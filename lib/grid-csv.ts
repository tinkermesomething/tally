import { MONTH_ABBREVIATIONS } from "@/lib/months";
import { spentTotals } from "@/lib/grid-totals";
import type { GridCategory, GridData } from "@/lib/db/queries";

/** The Grid as a CSV for spreadsheets. Pure: it takes the same GridData the
 * page shows, so the file can never disagree with the screen. */

export type GridCsvView = "budgeted" | "spent" | "both";

export const GRID_CSV_VIEWS: { id: GridCsvView; label: string }[] = [
  { id: "budgeted", label: "Budgeted" },
  { id: "spent", label: "Spent" },
  { id: "both", label: "Budgeted + spent" },
];

/** A text cell, quoted when needed. A leading = + - @ (or tab / CR) would be
 * run as a FORMULA by Excel, Numbers and Sheets, so it gets a leading quote. */
export function csvText(value: string | null | undefined): string {
  let v = value ?? "";
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Pence -> "12.50" (plain number, no symbol, so a spreadsheet can sum it).
 * undefined -> an empty cell. */
export const csvAmount = (pence: number | undefined): string => (pence === undefined ? "" : (pence / 100).toFixed(2));

const line = (cells: string[]) => cells.join(",");

type Series = { cells: (number | undefined)[]; total: number | undefined; average: number | undefined };

const budgetedOf = (c: GridCategory): Series => ({
  cells: Array.from({ length: 12 }, (_, i) => c.months[i + 1]?.amountPence),
  total: c.yearTotalPence,
  average: c.monthlyAveragePence,
});

const spentOf = (c: GridCategory): Series => {
  const t = spentTotals(c.actualByMonth);
  return { cells: c.actualByMonth.slice(0, 12), total: t.total, average: t.average };
};

/** The whole Grid for `year`: one row per category (its subcategories right
 * under it, with the parent named), then the summary rows and income sources.
 * UTF-8 with a BOM and CRLF line ends, so Excel and Numbers open it cleanly. */
export function gridToCsv(data: GridData, view: GridCsvView, currency = "GBP"): string {
  const both = view === "both";
  const head = ["Category", "Parent", "Group", ...(both ? ["Type"] : []), ...MONTH_ABBREVIATIONS, "Year total", "Monthly average"];
  const lines: string[] = [line(head)];

  const emit = (name: string, parent: string, group: string, type: string, s: Series) => {
    lines.push(
      line([
        csvText(name),
        csvText(parent),
        csvText(group),
        ...(both ? [csvText(type)] : []),
        ...s.cells.map(csvAmount),
        csvAmount(s.total),
        csvAmount(s.average),
      ])
    );
  };

  const rowsFor = (c: GridCategory, parent: string) => {
    const group = c.groupName ?? "";
    if (view === "budgeted" || both) emit(c.name, parent, group, "Budgeted", budgetedOf(c));
    if (view === "spent" || both) emit(c.name, parent, group, "Spent", spentOf(c));
  };
  for (const c of data.categories) {
    rowsFor(c, "");
    for (const child of c.children) rowsFor(child, c.name);
  }

  // Summary rows: the same figures as the footer of the grid.
  lines.push("");
  const summary = (label: string, cells: number[], total: number) =>
    lines.push(line([csvText(label), "", "", ...(both ? [""] : []), ...cells.map((v) => csvAmount(v)), csvAmount(total), ""]));
  summary("SUBTOTAL", data.subtotalByMonth, data.yearTotal.subtotal);
  summary("BUDGETED", data.plannedByMonth, data.yearTotal.planned);
  summary("WAGES", data.wagesByMonth, data.yearTotal.wages);
  summary("AVAILABLE", data.availableByMonth, data.yearTotal.available);
  summary("ACTUALLY SPENT", data.actuallySpentByMonth, data.yearTotal.actuallySpent);
  summary("LEFT TO SPEND", data.leftToSpendByMonth, data.yearTotal.leftToSpend);

  if (data.incomeSources.length > 0) {
    lines.push("");
    for (const s of data.incomeSources) {
      // Budgeted (amountPence) and Received (spentPence) are the income
      // table's own counterpart to a category's Budgeted/Spent - same
      // view gating, same shape.
      if (view === "budgeted" || both) {
        lines.push(
          line([
            csvText(`Income - ${s.name}`),
            "",
            "",
            ...(both ? ["Budgeted"] : []),
            ...Array.from({ length: 12 }, (_, i) => csvAmount(s.months[i + 1]?.amountPence)),
            csvAmount(s.yearTotalPence),
            csvAmount(s.monthlyAveragePence),
          ])
        );
      }
      if (view === "spent" || both) {
        const receivedByMonth = Array.from({ length: 12 }, (_, i) => s.months[i + 1]?.spentPence ?? 0);
        const t = spentTotals(receivedByMonth);
        lines.push(
          line([
            csvText(`Income - ${s.name}`),
            "",
            "",
            ...(both ? ["Received"] : []),
            ...receivedByMonth.map(csvAmount),
            csvAmount(t.total),
            csvAmount(t.average),
          ])
        );
      }
    }
  }
  lines.push("", csvText(`Amounts in ${currency}, for ${data.year}. Exported from Tally.`));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export const gridCsvFilename = (year: number, view: GridCsvView) => `tally-grid-${year}-${view === "both" ? "budgeted-and-spent" : view}.csv`;
