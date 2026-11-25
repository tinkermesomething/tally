import { decodeCsv } from "./csv-decode";

/** A bank file the importer takes: a CSV, or a PDF statement. */
export const isStatementName = (name: string) => /\.(csv|pdf)$/i.test(name) && !name.startsWith(".");

export const isPdfBytes = (bytes: Uint8Array) => bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

export type StatementText = { ok: true; text: string; /** What Tally read from a PDF, for the person to compare with the bank. */ note?: string } | { ok: false; error: string };

/** The CSV text of a file. A CSV is decoded; a PDF is read by position and
 * turned into the same kind of CSV, or refused. The PDF reader loads only
 * when a PDF turns up. */
export async function readStatement(bytes: Uint8Array): Promise<StatementText> {
  if (isPdfBytes(bytes)) {
    const { readPdfStatement, describeSummary } = await import("./pdf-statement");
    const r = await readPdfStatement(bytes);
    return r.ok ? { ok: true, text: r.csv, note: describeSummary(r.summary) } : { ok: false, error: r.error };
  }
  const { text } = decodeCsv(bytes);
  if (text.includes("\0")) return { ok: false, error: "That doesn't look like a text CSV file." };
  return { ok: true, text };
}
