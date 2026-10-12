import { MONTH_ABBREVIATIONS } from "@/lib/months";
import { csvAmount, csvText } from "@/lib/grid-csv";
import type { HouseholdGridRow, HouseholdIncomeGridRow } from "@/lib/db/household";

/** The Household page as a CSV, same shape as lib/grid-csv.ts's own
 * gridToCsv - pure: takes the same rows the page already fetched, so the
 * file can never disagree with the screen. */

export type HouseholdCsvView = "budgeted" | "spent" | "both";

export const HOUSEHOLD_CSV_VIEWS: { id: HouseholdCsvView; label: string }[] = [
  { id: "budgeted", label: "Budgeted" },
  { id: "spent", label: "Spent" },
  { id: "both", label: "Budgeted + spent" },
];

const line = (cells: string[]) => cells.join(",");

export function householdGridToCsv(
  grid: HouseholdGridRow[],
  incomeGrid: HouseholdIncomeGridRow[],
  year: number,
  view: HouseholdCsvView,
  currency = "GBP"
): string {
  const both = view === "both";
  const head = ["Category", "Group", ...(both ? ["Type"] : []), ...MONTH_ABBREVIATIONS, "Year total", "Monthly average", "Shared by"];
  const lines: string[] = [line(head)];

  for (const row of grid) {
    const group = row.groupName ?? "";
    const contributors = csvText(row.contributors.join(", "));
    if (view === "budgeted" || both) {
      const cells = Array.from({ length: 12 }, (_, i) => row.months[i + 1].budgetedPence);
      lines.push(line([csvText(row.categoryName), csvText(group), ...(both ? ["Budgeted"] : []), ...cells.map(csvAmount), csvAmount(row.yearBudgetedPence), csvAmount(Math.round(row.yearBudgetedPence / 12)), contributors]));
    }
    if (view === "spent" || both) {
      const cells = Array.from({ length: 12 }, (_, i) => row.months[i + 1].spentPence);
      lines.push(line([csvText(row.categoryName), csvText(group), ...(both ? ["Spent"] : []), ...cells.map(csvAmount), csvAmount(row.yearSpentPence), csvAmount(Math.round(row.yearSpentPence / 12)), contributors]));
    }
  }

  if (incomeGrid.length > 0) {
    lines.push("");
    for (const row of incomeGrid) {
      const cells = Array.from({ length: 12 }, (_, i) => row.months[i + 1]);
      lines.push(
        line([
          csvText(`Income - ${row.sourceName}`),
          "",
          ...(both ? ["Income"] : []),
          ...cells.map(csvAmount),
          csvAmount(row.yearTotalPence),
          csvAmount(Math.round(row.yearTotalPence / 12)),
          csvText(row.contributors.join(", ")),
        ])
      );
    }
  }

  lines.push("", csvText(`Amounts in ${currency}, for ${year}. Exported from Tally.`));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export const householdCsvFilename = (year: number, view: HouseholdCsvView) =>
  `tally-household-${year}-${view === "both" ? "budgeted-and-spent" : view}.csv`;
