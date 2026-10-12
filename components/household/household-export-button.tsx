"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadTextFile } from "@/lib/download";
import { HOUSEHOLD_CSV_VIEWS, householdCsvFilename, type HouseholdCsvView } from "@/lib/household-csv";

/** Same mechanism as the real Grid's ExportGridButton - the three
 * versions are built on the server from the same rows the page shows, so
 * the file always matches the screen; this just hands the chosen one to
 * the browser. */
export function HouseholdExportButton({ year, csv }: { year: number; csv: Record<HouseholdCsvView, string> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="icon-sm" variant="outline" aria-label="Export the household budget as CSV" title="Export the household budget as a CSV for a spreadsheet">
            <Download className="size-4 text-chart-1" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {HOUSEHOLD_CSV_VIEWS.map((v) => (
          <DropdownMenuItem key={v.id} onClick={() => downloadTextFile(householdCsvFilename(year, v.id), csv[v.id])}>
            {v.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
