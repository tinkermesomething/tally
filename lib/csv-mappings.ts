import { isCsvMapping, type CsvMapping } from "./csv-import";

/** An account can be fed two kinds of file, a CSV and a PDF statement, and the
 * two are laid out differently. So an account remembers the confirmed columns
 * for each kind. Pure.
 *
 * Stored in one text column. An account that only ever had CSVs keeps the old
 * shape (just the mapping), so nothing changes for it. Once a PDF has been
 * confirmed it becomes { v: 2, csv, pdf }. */

export type FileKind = "csv" | "pdf";
export type SavedMappings = { csv: CsvMapping | null; pdf: CsvMapping | null };

export const kindOfName = (name: string): FileKind => (/\.pdf$/i.test(name) ? "pdf" : "csv");

const valid = (v: unknown): CsvMapping | null => (isCsvMapping(v) ? v : null);

export function parseSavedMappings(json: string | null | undefined): SavedMappings {
  if (!json) return { csv: null, pdf: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { csv: null, pdf: null }; // a damaged saved mapping is ignored: the file is mapped fresh
  }
  const wrapped = parsed as { v?: unknown; csv?: unknown; pdf?: unknown } | null;
  if (wrapped && typeof wrapped === "object" && wrapped.v === 2) return { csv: valid(wrapped.csv), pdf: valid(wrapped.pdf) };
  return { csv: valid(parsed), pdf: null };
}

/** The text to store after `mapping` was confirmed for `kind`. The other kind is kept as it was. */
export function withSavedMapping(json: string | null | undefined, kind: FileKind, mapping: CsvMapping): string {
  const next = { ...parseSavedMappings(json), [kind]: mapping };
  return next.pdf ? JSON.stringify({ v: 2, csv: next.csv, pdf: next.pdf }) : JSON.stringify(next.csv);
}
