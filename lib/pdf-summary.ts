/** What Tally read from a PDF statement, in numbers, so the screen can show it
 * in the person's own currency and date format. No server code here: the
 * import dialog uses this in the browser. Pure. */

export type PdfSummary = {
  lines: number;
  /** The period the statement says it covers (its From and To), if it says. */
  from: string | null;
  to: string | null;
  /** The oldest and newest line actually read. */
  firstLine: string;
  lastLine: string;
  inPence: number;
  outPence: number;
  /** The statement had a balance column and every line followed from the one before. */
  reconciled: boolean;
  /** Text on the pages that Tally did not turn into lines (notes, footers), so nothing is dropped unseen. */
  left: string[];
  leftCount: number;
};

export type SummaryFormat = { money: (pence: number) => string; date: (iso: string) => string };

/** Plain sentences for the preview. The person compares these with the bank. */
export function describePdfSummary(s: PdfSummary, fmt: SummaryFormat): string[] {
  const read = `Read ${s.lines} ${s.lines === 1 ? "line" : "lines"}, from ${fmt.date(s.firstLine)} to ${fmt.date(s.lastLine)}.`;
  const covers = s.from && s.to ? ` The statement says it covers ${fmt.date(s.from)} to ${fmt.date(s.to)}.` : "";
  const totals = `Money in ${fmt.money(s.inPence)}. Money out ${fmt.money(s.outPence)}.`;
  const proof = s.reconciled
    ? "Every balance in the PDF follows from the line before it, so the lines add up."
    : "This PDF has no balance column, so Tally can't prove the lines add up. Check that these two totals match your bank's own figures for the same dates.";
  return [read + covers, totals, proof];
}
