"use client";

import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Saves the report as a PDF. It opens the browser's own print window with
 * the page laid out for paper (see the print rules in globals.css): choose
 * "Save as PDF" there (in Safari: the PDF menu, bottom left). That keeps the
 * charts as sharp vectors and needs no extra software. The page title is set
 * for the print so the saved file gets a useful name. */
export function ExportPdfButton({ title }: { title: string }) {
  function print() {
    const previous = document.title;
    document.title = title;
    const restore = () => {
      document.title = previous;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    // Some browsers return from print() immediately, others after the dialog.
    setTimeout(restore, 4000);
  }
  return (
    <Button size="sm" variant="outline" onClick={print} title="Opens the print window - choose Save as PDF" className="print:hidden">
      <FileDown className="size-4 text-chart-2" />
      Export PDF
    </Button>
  );
}
