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
  /** Optional column of fees the bank takes on top of the amount (Revolut,
   * Wise). A fee always lowers the balance, whatever sign the file uses.
   * Absent on mappings saved before this existed. */
  feeCol?: number | null;
  /** Optional column holding the line's state (Revolut "State", Wise and
   * PayPal "Status"). Lines still pending, or reverted, declined, failed or
   * cancelled, are left out: they are not settled money. Absent on mappings
   * saved before this existed. */
  statusCol?: number | null;
  /** The file's column names and count when this mapping was saved. Lets a
   * later file be checked against the layout the person confirmed. */
  headers?: string[];
  columns?: number;
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

/** A line with nothing to import (a bank's fee note, say). Not a sign the layout changed. */
export const ZERO_AMOUNT_REASON = "The amount is zero.";

/** States of a line that is not settled money. Anything else ("Completed",
 * "Posted", a word we don't know) is imported. */
const UNSETTLED = /^(pending|reverted|reversed|declined|failed|cancel(l)?ed|rejected|denied|expired|voided)\b/i;

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
 * otherwise it is genuinely ambiguous and follows `preferred` (the person's
 * date setting), day-first if that is not month-first. */
export function detectDateFormat(values: string[], preferred: DateFormat = "dmy"): { format: DateFormat; ambiguous: boolean } {
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
  // Genuinely ambiguous: the person's own date setting is the best hint.
  return { format: preferred === "mdy" ? "mdy" : "dmy", ambiguous: true };
}

/** Reads one amount cell into signed pence, or null. Understands £/$/€
 * and currency codes ("GBP 12.50"), thousands separators (1,234.50, 1.234,50,
 * 1 234,50, 1'234.50), a decimal comma ("12,50"), (negative) brackets, a
 * trailing minus, a unicode minus and DR/CR suffixes. Works on the digits as text, never through floats. */
const CURRENCY_CODE = "(?:GBP|USD|EUR|CHF|CAD|AUD|NZD|JPY|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|INR|ZAR|HKD|SGD|AED|TRY|MXN|BRL)";
const CODE_BEFORE = new RegExp(`^${CURRENCY_CODE}\\s*(?=[-+(\\d.,])`, "i");
const CODE_AFTER = new RegExp(`(?<=[\\d)])\\s*${CURRENCY_CODE}$`, "i");

export function parseAmount(raw: string): number | null {
  let text = raw.replace(/[\u2212\u2013\u2014]/g, "-").replace(/[£$€'\u2019]/g, "").trim();
  text = text.replace(CODE_BEFORE, "").replace(CODE_AFTER, "");
  let negative = false;
  const side = /(?<=[\d)])\s*(CR|DR)\.?$/i.exec(text); // "12.50 DR" = money out, "12.50 CR" = money in
  if (side) {
    negative = side[1].toUpperCase() === "DR";
    text = text.slice(0, side.index);
  }
  text = text.replace(/\s/g, "").replace(/^\+/, "");
  if (!text) return null;
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
export function mapCsvRows(text: string, mapping: CsvMapping): { rows: ParsedCsvRow[]; errors: CsvRowError[]; skipped: CsvRowError[]; headers: string[] } {
  const { headers, body, firstLine } = splitTable(text, mapping);
  const rows: ParsedCsvRow[] = [];
  const errors: CsvRowError[] = [];
  const skipped: CsvRowError[] = [];
  body.forEach((cells, i) => {
    const line = firstLine + i;
    const state = col(cells, mapping.statusCol ?? null).trim();
    if (state && UNSETTLED.test(state)) return void skipped.push({ line, reason: `Left out: ${state.toLowerCase()}.` });

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
    const feeText = col(cells, mapping.feeCol ?? null);
    if (feeText) {
      const fee = parseAmount(feeText);
      if (fee === null) return void errors.push({ line, reason: `Can't read the fee "${feeText}".` });
      amount -= Math.abs(fee);
    }
    if (amount === 0) return void errors.push({ line, reason: ZERO_AMOUNT_REASON });

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
  return { rows, errors, skipped, headers };
}

const looksLikeDateHeader = /date|time|completed|posted|booking|started/i;
const amountHeader = /^(amount|value|total|sum)\b|\bamount\b/i;
const inHeader = /paid in|money in|credit|deposit|received|\bin$/i;
const outHeader = /paid out|money out|debit|withdraw|spent|\bout$/i;
const payeeHeader = /description|payee|merchant|narrative|name|counter ?party|reference|memo|transaction$/i;
// "Details" is a weaker hint: some banks use it for the type (Chase: DEBIT / CREDIT).
const payeeWeakHeader = /details/i;
const statusHeader = /^(transaction )?(status|state)$/i;
const feeHeader = /^fees?\b|\bfees?$/i;
// A real ID, not a free-text "Reference" (Starling, N26: "Rent", "Salary"), which repeats.
const idHeader = /\bid$|^id\b|transaction id|\btx ?id\b|\bref(erence)? ?(no\.?|number|id)\b/i;

/** A sensible starting mapping for any file - guessed from the header names
 * if there are any, else from what the columns contain - for the person to
 * confirm or change on the mapping screen. */
/** Lines that are money coming IN whatever the bank: pay, refunds, card payments. */
const INCOME_WORDS = /\b(salary|payroll|wages?|payment received|thank you|refund|cashback|interest paid|dividend|deposit)\b/i;
const STRONG_INCOME_WORDS = /payment received|thank you/i;

export type SignCheck = {
  /** Spending is shown as positive in this file. */
  flip: boolean;
  /** "described": the descriptions settle it. "normal": nothing suggests a flip.
   * "unsure": most amounts are positive and nothing says why, so a person must choose. */
  certainty: "described" | "normal" | "unsure";
  note: string | null;
};

/** Which way round is this file's sign? A current account shows spending as
 * negative; many credit-card files show it as positive. A wrong guess turns
 * every purchase into income, and nothing in the numbers shows it - a card's
 * balance is what you OWE, so it matches either way and proves nothing. What
 * does show it is the lines that are always money in ("PAYMENT RECEIVED -
 * THANK YOU", salary, refunds): if those are negative, spending is positive. */
export function detectSign(text: string, mapping: CsvMapping): SignCheck {
  const { rows } = mapCsvRows(text, { ...mapping, flipSign: false });
  const income = rows.filter((r) => INCOME_WORDS.test(r.payeeRaw));
  if (income.length >= 2 || income.some((r) => STRONG_INCOME_WORDS.test(r.payeeRaw))) {
    const negative = income.filter((r) => r.amountPence < 0);
    if (negative.length * 2 > income.length) {
      return { flip: true, certainty: "described", note: `Set to "spending is positive", because lines like "${negative[0].payeeRaw.slice(0, 40)}" are negative here. Check the preview.` };
    }
    if (negative.length * 2 < income.length) return { flip: false, certainty: "described", note: null };
  }
  const positive = rows.filter((r) => r.amountPence > 0).length;
  if (rows.length >= 6 && positive / rows.length >= 0.7) {
    return { flip: false, certainty: "unsure", note: "Most amounts here are positive. In a current account spending is negative, but many credit-card files show spending as positive. Choose which this file is." };
  }
  return { flip: false, certainty: "normal", note: null };
}

/** How many lines at the top are a title or account summary rather than the
 * table: the table starts at the first line with the width most lines have. */
export function detectSkipRows(all: string[][]): number {
  const head = all.slice(0, 40);
  const widths = new Map<number, number>();
  for (const r of head) widths.set(r.length, (widths.get(r.length) ?? 0) + 1);
  let width = 0;
  let most = 0;
  for (const [w, n] of widths) {
    if (w >= 2 && (n > most || (n === most && w > width))) {
      width = w;
      most = n;
    }
  }
  if (most < 2) return 0;
  return Math.max(0, head.findIndex((r) => r.length === width));
}

export function guessMapping(text: string, delimiter: Delimiter, preferredDates: DateFormat = "dmy"): CsvMapping {
  const everything = parseCsv(text, delimiter);
  const skipRows = detectSkipRows(everything);
  const all = everything.slice(skipRows);
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
  const free = (c: number) => c !== dateCol && c !== amountCol && c !== inCol && c !== outCol;
  let payeeCol = names.findIndex((n, c) => free(c) && payeeHeader.test(n));
  if (payeeCol < 0) payeeCol = names.findIndex((n, c) => free(c) && payeeWeakHeader.test(n));
  if (payeeCol < 0) {
    const used = new Set([dateCol, amountCol, inCol, outCol]);
    const textLen = (c: number) => rows.reduce((s, r) => s + (numScore(c, [r]) === 0 ? col(r, c).length : 0), 0);
    payeeCol = Array.from({ length: width }, (_, c) => c).filter((c) => !used.has(c)).sort((a, b) => textLen(b) - textLen(a))[0] ?? 0;
  }
  let idc = names.findIndex((n, c) => c !== payeeCol && idHeader.test(n));
  if (idc >= 0) {
    // An ID that repeats would make different transactions look like one.
    const ids = (hasHeader ? all.slice(1) : all).map((r) => col(r, idc).trim()).filter(Boolean);
    if (ids.length === 0 || new Set(ids).size !== ids.length) idc = -1;
  }
  const feec = split ? -1 : names.findIndex((n, c) => c !== dateCol && c !== amountCol && c !== payeeCol && feeHeader.test(n) && numScore(c, rows) > 0);
  const statc = names.findIndex((n, c) => c !== dateCol && c !== amountCol && c !== payeeCol && statusHeader.test(n.trim()));
  const { format } = detectDateFormat(rows.map((r) => col(r, dateCol)), preferredDates);

  const guess: CsvMapping = {
    delimiter,
    skipRows,
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
    feeCol: feec >= 0 ? feec : null,
    statusCol: statc >= 0 ? statc : null,
  };
  return { ...guess, flipSign: detectSign(text, guess).flip };
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** The columns a mapping actually reads. */
export function usedColumns(m: CsvMapping): number[] {
  const cols = [m.dateCol, ...(m.amountMode === "split" ? [m.inCol, m.outCol] : [m.amountCol]), ...m.payeeCols];
  if (m.feeCol != null) cols.push(m.feeCol);
  if (m.statusCol != null) cols.push(m.statusCol);
  if (m.idCol !== null) cols.push(m.idCol);
  return [...new Set(cols)].sort((a, b) => a - b);
}

/** What a mapping must remember so a later file can be compared with the one it was confirmed on. */
export function layoutOf(text: string, m: CsvMapping): Pick<CsvMapping, "headers" | "columns"> {
  const t = splitTable(text, m);
  return { headers: t.headers, columns: t.columns };
}

export type LayoutStatus = { state: "ok" } | { state: "unknown" } | { state: "changed"; reason: string };

/** Is this file laid out like the one the mapping was confirmed on? A bank
 * that adds, drops or reorders columns would make an old mapping read the
 * wrong ones, and the numbers can still parse - so the names of the columns
 * the mapping reads must match. Extra columns it does not read are fine.
 * "unknown" is a mapping saved before layouts were remembered. */
export function layoutStatus(text: string, m: CsvMapping): LayoutStatus {
  if (!m.headers || m.columns === undefined) return { state: "unknown" };
  const t = splitTable(text, m);
  if (!m.hasHeader) {
    return t.columns === m.columns ? { state: "ok" } : { state: "changed", reason: `The file has ${t.columns} columns. It had ${m.columns} when this account was set up.` };
  }
  const name = (h: string[], c: number) => (h[c] ? `"${h[c]}"` : "nothing");
  for (const c of usedColumns(m)) {
    if (norm(t.headers[c] ?? "") !== norm(m.headers[c] ?? "")) {
      return { state: "changed", reason: `Column ${c + 1} was ${name(m.headers, c)} when this account was set up. In this file it is ${name(t.headers, c)}.` };
    }
  }
  return { state: "ok" };
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
    (m.idCol === null || Number.isInteger(m.idCol)) &&
    (m.feeCol === undefined || m.feeCol === null || Number.isInteger(m.feeCol)) &&
    (m.statusCol === undefined || m.statusCol === null || Number.isInteger(m.statusCol)) &&
    (m.headers === undefined || (Array.isArray(m.headers) && m.headers.every((h) => typeof h === "string"))) &&
    (m.columns === undefined || Number.isInteger(m.columns))
  );
}
