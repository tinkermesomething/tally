/** Turns the raw bytes of a bank's CSV into text. Banks do not agree on an
 * encoding: UTF-8 (with or without a BOM), UTF-16 (Excel's "Unicode text"),
 * and Windows-1252 (older UK and EU exports, where £ and é are single bytes).
 * Reading Windows-1252 as UTF-8 turns every £ into a replacement character, so
 * a strict UTF-8 read is tried first and Windows-1252 is the fallback.
 * Pure: the browser dialog and the ingest folder share it. */

export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export function decodeCsv(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16le" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16be" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}
