"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadTextFile } from "@/lib/download";
import { GRID_CSV_VIEWS, gridCsvFilename, type GridCsvView } from "@/lib/grid-csv";

/** Saves the Grid as a CSV. The three versions (budgeted, spent, both) are
 * built on the server from the same data the page shows, so the file always
 * matches the screen; this just hands the chosen one to the browser. */
export function ExportGridButton({ year, csv }: { year: number; csv: Record<GridCsvView, string> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" variant="outline" aria-label="Export the grid as CSV" title="Export the grid as a CSV for a spreadsheet">
            <Download className="size-4 text-chart-1" />
            Export CSV
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {GRID_CSV_VIEWS.map((v) => (
          <DropdownMenuItem key={v.id} onClick={() => downloadTextFile(gridCsvFilename(year, v.id), csv[v.id])}>
            {v.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
