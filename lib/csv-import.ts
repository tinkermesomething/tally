import { parseCsv, type Delimiter } from "./csv";

/** Turns a bank's CSV export into transactions. All the choices a person
 * might need to make for an odd file live in CsvMapping, so nothing is
 * hard-wired to one bank. Pure - no DB, no React. */

export type DateFormat = "dmy" | "mdy" | "ymd";

export type CsvMapping = {
  delimiter: Delimiter;
  /** Lines to ignore at the very top (a title or summary above the table). */
  skipRows: number;
  /** The first remaining line holds column names, not a transaction. */
  hasHeader: boolean;
  dateCol: number;
  /** Only matters for numeric dates like 03/04/2026. */
  dateFormat: DateFormat;
  /** "single": one signed amount column. "split": separate money in / out. */
  amountMode: "single" | "split";
  amountCol: number;
  inCol: number;
  outCol: number;
  /** The file shows spending as positive (credit cards often do). */
  flipSign: boolean;
  /** One or more columns joined to make the payee text. */
  payeeCols: number[];
  /** Optional column holding the bank's own transaction id. */
  idCol: number | null;
};

export type ParsedCsvRow = {
  /** 1-based line number in the file, for error messages. */
  line: number;
  bookingDate: string;
  amountPence: number;
  payeeRaw: string;
  idHint: string | null;
};

export type CsvRowError = { line: number; reason: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function realDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Reads one date cell into YYYY-MM-DD, or null. Numeric day/month dates
 * follow `format`; text months ("5 Oct 2026") and ISO dates never need it. */
export function parseDate(raw: string, format: DateFormat = "dmy"): string | null {
  const text = raw.trim();
  if (!text) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (m) return realDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{2,4})(?:[T\s].*)?$/.exec(text); // 5 Oct 2026, 05-Oct-26
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mon < 0 ? null : realDate(fullYear(m[3]), mon + 1, Number(m[1]));
  }
  m = /^([A-Za-z]{3,9})[ ,.]+(\d{1,2})(?:st|nd|rd|th)?,?[ ,.]+(\d{2,4})(?:[T\s].*)?$/.exec(text); // Oct 5, 2026
  if (m) {
    const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mon < 0 ? null : realDate(fullYear(m[3]), mon + 1, Number(m[2]));
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s].*)?$/.exec(text);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(m[3]);
    if (format === "ymd") return null;
    return format === "mdy" ? realDate(y, a, b) : realDate(y, b, a);
  }
  return null;
}

/** Looks at the date cells to decide day-first vs month-first. A first part
 * above 12 means day-first; a second part above 12 means month-first;
 * otherwise it is genuinely ambiguous and defaults to day-first (UK). */
export function detectDateFormat(values: string[]): { format: DateFormat; ambiguous: boolean } {
  let dayFirst = false;
  let monthFirst = false;
  let iso = false;
  let numeric = 0;
  for (const v of values) {
    const t = v.trim();
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(t)) {
      iso = true;
      continue;
    }
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/.exec(t);
    if (!m) continue;
    numeric++;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return { format: "dmy", ambiguous: false };
  if (monthFirst && !dayFirst) return { format: "mdy", ambiguous: false };
  if (numeric === 0) return { format: iso ? "ymd" : "dmy", ambiguous: false };
  return { format: "dmy", ambiguous: true };
}

/** Reads one amount cell into signed pence, or null. Understands £/$/€,
 * thousands separators, a decimal comma ("12,50"), (negative) brackets and a
 * trailing minus. Works on the digits as text, never through floats. */
export function parseAmount(raw: string): number | null {
  let text = raw.replace(/[£$€\s ]/g, "").replace(/^\+/, "");
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma >= 0) {
    text = /,\d{1,2}$/.test(text) && text.indexOf(",") === comma ? text.replace(",", ".") : text.replace(/,/g, "");
  }
  if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") return null;
  const [whole, frac = ""] = text.split(".");
  const padded = (frac + "00").slice(0, 2);
  let pence = Number(whole || "0") * 100 + Number(padded);
  if (frac.length > 2 && Number(frac[2]) >= 5) pence += 1; // round half up
  if (!Number.isSafeInteger(pence)) return null;
  return negative ? -pence : pence;
}

const col = (row: string[], i: number | null) => (i === null || i < 0 ? "" : (row[i] ?? ""));

/** The table below the skipped lines and (optionally) the header row. */
export function splitTable(text: string, mapping: Pick<CsvMapping, "delimiter" | "skipRows" | "hasHeader">) {
  const all = parseCsv(text, mapping.delimiter);
  const rest = all.slice(Math.max(0, mapping.skipRows));
  const headers = mapping.hasHeader ? (rest[0] ?? []) : [];
  const body = mapping.hasHeader ? rest.slice(1) : rest;
  const firstLine = Math.max(0, mapping.skipRows) + (mapping.hasHeader ? 2 : 1);
  return { headers, body, firstLine, columns: Math.max(0, ...all.map((r) => r.length)) };
}

export const MAX_PAYEE_LENGTH = 300;

/** Applies the mapping. Rows that can't be read are reported with a reason
 * (never silently dropped); everything else comes back as transactions. */
export function mapCsvRows(text: string, mapping: CsvMapping): { rows: ParsedCsvRow[]; errors: CsvRowError[]; headers: string[] } {
  const { headers, body, firstLine } = splitTable(text, mapping);
  const rows: ParsedCsvRow[] = [];
  const errors: CsvRowError[] = [];
  body.forEach((cells, i) => {
    const line = firstLine + i;
    const bookingDate = parseDate(col(cells, mapping.dateCol), mapping.dateFormat);
    if (!bookingDate) return void errors.push({ line, reason: `Can't read the date "${col(cells, mapping.dateCol)}".` });

    let amount: number | null;
    if (mapping.amountMode === "split") {
      const inText = col(cells, mapping.inCol);
      const outText = col(cells, mapping.outCol);
      const inPence = inText ? parseAmount(inText) : 0;
      const outPence = outText ? parseAmount(outText) : 0;
      if (inPence === null || outPence === null) return void errors.push({ line, reason: "Can't read the money in/out amounts." });
      if (!inText && !outText) return void errors.push({ line, reason: "No money in or out on this line." });
      amount = Math.abs(inPence) - Math.abs(outPence);
    } else {
      amount = parseAmount(col(cells, mapping.amountCol));
      if (amount === null) return void errors.push({ line, reason: `Can't read the amount "${col(cells, mapping.amountCol)}".` });
    }
    if (mapping.flipSign) amount = -amount;
    if (amount === 0) return void errors.push({ line, reason: "The amount is zero." });

    const payeeRaw = mapping.payeeCols
      .map((c) => col(cells, c))
      .filter(Boolean)
      .join(" · ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_PAYEE_LENGTH);
    if (!payeeRaw) return void errors.push({ line, reason: "No payee text on this line." });
    const idHint = mapping.idCol !== null ? col(cells, mapping.idCol).trim() || null : null;
    rows.push({ line, bookingDate, amountPence: amount, payeeRaw, idHint });
  });
  return { rows, errors, headers };
}

const looksLikeDateHeader = /date|time|completed|posted|booking|started/i;
const amountHeader = /^(amount|value|total|sum)\b|\bamount\b/i;
const inHeader = /paid in|money in|credit|deposit|received|\bin$/i;
const outHeader = /paid out|money out|debit|withdraw|spent|\bout$/i;
const payeeHeader = /description|payee|merchant|details|narrative|name|counterparty|reference|memo|transaction$/i;
const idHeader = /(^|\b)(id|ref(erence)? ?(no|number)?|transaction id|tx ?id)\b/i;

/** A sensible starting mapping for any file - guessed from the header names
 * if there are any, else from what the columns contain - for the person to
 * confirm or change on the mapping screen. */
export function guessMapping(text: string, delimiter: Delimiter): CsvMapping {
  const all = parseCsv(text, delimiter);
  const width = Math.max(1, ...all.map((r) => r.length));
  const first = all[0] ?? [];
  const sample = all.slice(1, 40);

  const dateScore = (c: number, rows: string[][]) => rows.filter((r) => parseDate(col(r, c), "dmy") || parseDate(col(r, c), "mdy")).length;
  const numScore = (c: number, rows: string[][]) => rows.filter((r) => col(r, c) !== "" && parseAmount(col(r, c)) !== null).length;

  // A header row is a first line whose cells aren't themselves dates/amounts.
  const hasHeader = first.length > 0 && first.every((c) => !parseDate(c, "dmy") && (parseAmount(c) === null || c === "")) && first.some((c) => c !== "");
  const rows = hasHeader ? sample : all.slice(0, 40);
  const names = hasHeader ? first : [];

  let dateCol = names.findIndex((n) => looksLikeDateHeader.test(n));
  if (dateCol < 0 || dateScore(dateCol, rows) === 0) {
    dateCol = Array.from({ length: width }, (_, c) => c).sort((a, b) => dateScore(b, rows) - dateScore(a, rows))[0] ?? 0;
  }
  let inCol = names.findIndex((n, c) => c !== dateCol && inHeader.test(n));
  let outCol = names.findIndex((n, c) => c !== dateCol && outHeader.test(n));
  const split = inCol >= 0 && outCol >= 0 && inCol !== outCol;
  let amountCol = names.findIndex((n, c) => c !== dateCol && amountHeader.test(n));
  if (!split && (amountCol < 0 || numScore(amountCol, rows) === 0)) {
    amountCol = Array.from({ length: width }, (_, c) => c)
      .filter((c) => c !== dateCol)
      .sort((a, b) => numScore(b, rows) - numScore(a, rows))[0] ?? 1;
  }
  if (!split) {
    inCol = 0;
    outCol = 0;
  }
  let payeeCol = names.findIndex((n, c) => c !== dateCol && c !== amountCol && c !== inCol && c !== outCol && payeeHeader.test(n));
  if (payeeCol < 0) {
    const used = new Set([dateCol, amountCol, inCol, outCol]);
    const textLen = (c: number) => rows.reduce((s, r) => s + (numScore(c, [r]) === 0 ? col(r, c).length : 0), 0);
    payeeCol = Array.from({ length: width }, (_, c) => c).filter((c) => !used.has(c)).sort((a, b) => textLen(b) - textLen(a))[0] ?? 0;
  }
  const idc = names.findIndex((n, c) => c !== payeeCol && idHeader.test(n));
  const { format } = detectDateFormat(rows.map((r) => col(r, dateCol)));

  return {
    delimiter,
    skipRows: 0,
    hasHeader,
    dateCol,
    dateFormat: format,
    amountMode: split ? "split" : "single",
    amountCol: Math.max(0, amountCol),
    inCol: Math.max(0, inCol),
    outCol: Math.max(0, outCol),
    flipSign: false,
    payeeCols: [Math.max(0, payeeCol)],
    idCol: idc >= 0 ? idc : null,
  };
}

export function isCsvMapping(value: unknown): value is CsvMapping {
  const m = value as Partial<CsvMapping> | null;
  return (
    !!m &&
    typeof m === "object" &&
    [",", ";", "\t", "|"].includes(m.delimiter as string) &&
    Number.isInteger(m.skipRows) &&
    typeof m.hasHeader === "boolean" &&
    Number.isInteger(m.dateCol) &&
    ["dmy", "mdy", "ymd"].includes(m.dateFormat as string) &&
    (m.amountMode === "single" || m.amountMode === "split") &&
    Number.isInteger(m.amountCol) &&
    Number.isInteger(m.inCol) &&
    Number.isInteger(m.outCol) &&
    typeof m.flipSign === "boolean" &&
    Array.isArray(m.payeeCols) &&
    m.payeeCols.every((c) => Number.isInteger(c)) &&
    (m.idCol === null || Number.isInteger(m.idCol))
  );
}
