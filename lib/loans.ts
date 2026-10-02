/** The income source a loan should land under: an exact "loan"/"loans"
 * source if there is one, otherwise the first whose name mentions loan.
 * Used to pre-select it when someone tags incoming money as a loan - only
 * ever a suggestion, never forced. Returns the id as a string (the form
 * state everywhere else is strings), or "" when no source looks like one. */
export function findLoansSourceId(sources: { id: number; name: string }[]): string {
  const exact = sources.find((s) => /^loans?$/i.test(s.name.trim()));
  const loose = sources.find((s) => /loan/i.test(s.name));
  const found = exact ?? loose;
  return found ? String(found.id) : "";
}
