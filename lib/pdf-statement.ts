import { parseAmount } from "./csv-import";
import { readPdfItemsIsolated } from "./pdf-run";

/** Reads a bank's PDF statement (the kind you download from online banking,
 * with real text in it, not a scan) into the same CSV text the importer
 * already understands. From there the normal preview, saved columns and
 * ingest folder do the rest.
 *
 * A PDF has no rows. It has pieces of text at positions. So rows are rebuilt
 * from the positions, and the result is only trusted if it adds up:
 *  - every date has exactly one amount, and every amount belongs to a date;
 *  - every line sits inside the dates the statement says it covers;
 *  - if the statement shows a running balance, each balance must follow from
 *    the line above it.
 * Anything else is refused with a reason. It never guesses.
 *
 * The positions come from the PDF reader (readPdfStatement); everything
 * below it is pure, so tests need no real statement. */

/** One piece of text and where it sits. y grows upward, as in a PDF. */
export type PdfItem = { str: string; x: number; y: number; w: number; h: number };

export type PdfSummary = {
  lines: number;
  from: string | null;
  to: string | null;
  inPence: number;
  outPence: number;
  /** The statement had a balance column and every line followed from the one before. */
  reconciled: boolean;
};

export type PdfResult = { ok: true; csv: string; summary: PdfSummary } | { ok: false; error: string };

type Kind = "date" | "text" | "in" | "out" | "signed" | "balance";
type Column = { name: string; kind: Kind; x: number; right: number };

const LINE_TOLERANCE = 2.5;
const RIGHT_TOLERANCE = 12;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const kindOf = (name: string): Kind => {
  const n = name.trim().toLowerCase();
  if (n === "date") return "date";
  if (/balance/.test(n)) return "balance";
  if (/paid in|money in|credit|deposit|received/.test(n)) return "in";
  if (/paid out|money out|debit|withdraw|spent/.test(n)) return "out";
  if (/^(amount|value)\b/.test(n)) return "signed";
  return "text";
};

const isMoneyKind = (k: Kind) => k === "in" || k === "out" || k === "signed" || k === "balance";

/** "£8.00", "-£14.77", "1,234.50", "12.50 CR" - a whole cell that is an amount with pence. */
const looksLikeMoney = (s: string) => /^[-+(]?\s*[£$€]?\s*\d[\d,]*\.\d{2}\s*\)?\s*(CR|DR)?$/i.test(s.trim()) && parseAmount(s) !== null;

type DateParts = { d: number; m: number; y: number | null };

/** "26 Sep", "26 Sep 2026", "26/09/2026". Day-first. A year of 2 digits means 20xx. */
function readDateCell(s: string): DateParts | null {
  const t = s.trim();
  const named = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*\.?(?:[ -](\d{4}|\d{2}))?$/.exec(t);
  if (named) {
    const m = MONTHS.indexOf(named[2].toLowerCase()) + 1;
    if (m === 0) return null;
    return { d: Number(named[1]), m, y: named[3] ? (named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3])) : null };
  }
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (numeric) return { d: Number(numeric[1]), m: Number(numeric[2]), y: Number(numeric[3]) };
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const dmy = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;

/** Pence as text, without going through a float. */
const money = (pence: number) => `${pence < 0 ? "-" : ""}${Math.floor(Math.abs(pence) / 100)}.${String(Math.abs(pence) % 100).padStart(2, "0")}`;

const cell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Items on one visual line, left to right. */
function toLines(items: PdfItem[]): PdfItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= LINE_TOLERANCE) last.push(it);
    else lines.push([it]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  return lines;
}

/** The line of column titles: has "Date" and at least one money column. */
function findHeader(lines: PdfItem[][]): { index: number; columns: Column[] } | null {
  for (let i = 0; i < lines.length; i++) {
    const names = lines[i].map((it) => it.str.trim()).filter(Boolean);
    if (!names.some((n) => kindOf(n) === "date")) continue;
    const columns: Column[] = lines[i]
      .filter((it) => it.str.trim())
      .map((it) => ({ name: it.str.trim(), kind: kindOf(it.str), x: it.x, right: it.x + it.w }));
    if (columns.some((c) => isMoneyKind(c.kind) && c.kind !== "balance")) return { index: i, columns };
  }
  return null;
}

/** The first and last day the statement says it covers: a "From" and a "To"
 * label, each with a dd/mm/yyyy just under it. */
function findPeriod(items: PdfItem[]): { from: string; to: string } | null {
  const dateOf = (label: PdfItem) => {
    const near = items
      .filter((it) => /^\d{2}\/\d{2}\/\d{4}$/.test(it.str.trim()) && it.y < label.y && label.y - it.y < 60 && Math.abs(it.x - label.x) < 60)
      .sort((a, b) => label.y - a.y - (label.y - b.y));
    const p = near[0] ? readDateCell(near[0].str) : null;
    return p && p.y !== null ? iso(p.y, p.m, p.d) : null;
  };
  const fromLabel = items.find((it) => /^from$/i.test(it.str.trim()));
  const toLabel = items.find((it) => /^to$/i.test(it.str.trim()));
  if (!fromLabel || !toLabel) return null;
  const from = dateOf(fromLabel);
  const to = dateOf(toLabel);
  return from && to && from <= to ? { from, to } : null;
}

type Row = { page: number; date: DateParts; text: Map<string, string[]>; amounts: { kind: Kind; pence: number; raw: string }[] };

const fail = (error: string): PdfResult => ({ ok: false, error });

export function statementFromPages(pages: PdfItem[][]): PdfResult {
  const everything = pages.flat().filter((it) => it.str.trim());
  if (everything.length === 0) return fail("This PDF has no text in it. It may be a scan or a photo. Tally can only read PDFs that were made by the bank's own system.");
  const period = findPeriod((pages[0] ?? []).filter((it) => it.str.trim()));

  const rows: Row[] = [];
  let columns: Column[] | null = null;
  let hasBalance = false;

  for (let p = 0; p < pages.length; p++) {
    const lines = toLines(pages[p].filter((it) => it.str.trim()));
    const header = findHeader(lines);
    if (header) {
      columns = header.columns;
      if (columns.some((c) => c.kind === "balance")) hasBalance = true;
    }
    const start = header ? header.index + 1 : 0;
    const body = lines.slice(start).flat();
    if (!header && !body.some((it) => readDateCell(it.str) !== null)) continue; // a cover page or a notes page
    if (!columns) return fail(`Page ${p + 1} has dates but no row of column titles above them, so Tally can't tell which number is which.`);
    const cols = columns;
    const dateCol = cols.find((c) => c.kind === "date");
    if (!dateCol) return fail("The column titles have no Date column.");
    const dateXs = body.filter((it) => readDateCell(it.str) !== null && Math.abs(it.x - dateCol.x) <= 6);
    if (dateXs.length === 0) continue;
    dateXs.sort((a, b) => b.y - a.y);

    // The table starts at the first date. Text above it (but under the titles) must not hide an amount.
    const firstY = dateXs[0].y;
    for (const it of body) {
      if (it.y > firstY + LINE_TOLERANCE && looksLikeMoney(it.str)) return fail(`Page ${p + 1} has an amount ("${it.str.trim()}") above its first date. Tally can't tell which line it belongs to.`);
    }

    const textCols = cols.filter((c) => !isMoneyKind(c.kind));
    const moneyCols = cols.filter((c) => isMoneyKind(c.kind));
    dateXs.forEach((d, i) => {
      const top = d.y + LINE_TOLERANCE;
      const bottom = i + 1 < dateXs.length ? dateXs[i + 1].y + LINE_TOLERANCE : -Infinity;
      const inBand = body.filter((it) => it.y <= top && it.y > bottom).sort((a, b) => b.y - a.y || a.x - b.x);
      const date = readDateCell(d.str)!;
      const row: Row = { page: p + 1, date, text: new Map(), amounts: [] };
      // Wrapped description lines sit close under the row. Far below it is the page footer.
      let lastY = d.y;
      let lastH = Math.max(d.h, 1);
      for (const it of inBand) {
        if (it === d) continue;
        const isMoney = looksLikeMoney(it.str);
        const moneyCol = isMoney ? moneyCols.find((c) => Math.abs(it.x + it.w - c.right) <= RIGHT_TOLERANCE) : undefined;
        if (moneyCol) {
          row.amounts.push({ kind: moneyCol.kind, pence: parseAmount(it.str)!, raw: it.str.trim() });
          lastY = Math.min(lastY, it.y);
          continue;
        }
        if (lastY - it.y > lastH * 2.4) {
          if (isMoney) return fail(`Page ${p + 1}: an amount ("${it.str.trim()}") sits below the "${date.d} ${MONTHS[date.m - 1]}" line but not on a line of its own. Tally can't place it.`);
          continue; // footer text
        }
        const col = [...textCols].reverse().find((c) => c.x <= it.x + 3);
        if (!col) return fail(`Page ${p + 1}: text ("${it.str.trim()}") sits left of the first column.`);
        const list = row.text.get(col.name) ?? [];
        list.push(it.str.trim());
        row.text.set(col.name, list);
        lastY = Math.min(lastY, it.y);
        lastH = Math.max(lastH, it.h);
      }
      rows.push(row);
    });
  }

  if (rows.length === 0) return fail("Tally found no transaction lines in this PDF.");
  const cols = columns!;
  const descName = cols.find((c) => c.kind === "text" && /description|details|payee|narrative|merchant|reference/i.test(c.name))?.name ?? cols.find((c) => c.kind === "text")?.name;
  if (!descName) return fail("The column titles have no description column.");
  const typeNames = cols.filter((c) => c.kind === "text" && c.name !== descName).map((c) => c.name);

  type Line = { iso: string; desc: string; extra: string[]; pence: number; balance: number | null };
  const out: Line[] = [];
  for (const r of rows) {
    const where = `${r.date.d} ${MONTHS[r.date.m - 1]}, page ${r.page}`;
    let year = r.date.y;
    if (year === null) {
      if (!period) return fail(`The line at ${where} has no year, and Tally can't find the From and To dates at the top of the statement to work it out.`);
      const years = [...new Set([Number(period.from.slice(0, 4)), Number(period.to.slice(0, 4))])];
      const fits = years.filter((y) => {
        const d = iso(y, r.date.m, r.date.d);
        return d !== null && d >= period.from && d <= period.to;
      });
      if (fits.length !== 1) return fail(`The line at ${where} is not inside the period the statement covers (${dmy(period.from)} to ${dmy(period.to)}), or could fall in two years.`);
      year = fits[0];
    }
    const date = iso(year, r.date.m, r.date.d);
    if (!date) return fail(`The line at ${where} is not a real date.`);
    if (period && (date < period.from || date > period.to)) return fail(`The line at ${where} is outside the period the statement covers (${dmy(period.from)} to ${dmy(period.to)}).`);

    const real = r.amounts.filter((a) => a.kind !== "balance");
    const balances = r.amounts.filter((a) => a.kind === "balance");
    if (real.length === 0) return fail(`The line at ${where} has no amount.`);
    if (real.length > 1) return fail(`The line at ${where} has more than one amount (${real.map((a) => a.raw).join(", ")}).`);
    if (balances.length > 1) return fail(`The line at ${where} has more than one balance.`);
    const a = real[0];
    let pence: number;
    if (a.kind === "in") {
      if (a.pence < 0) return fail(`The line at ${where} has a negative amount (${a.raw}) in a money-in column.`);
      pence = a.pence;
    } else if (a.kind === "out") pence = -Math.abs(a.pence);
    else pence = a.pence;
    out.push({
      iso: date,
      desc: (r.text.get(descName) ?? []).join(" "),
      extra: typeNames.map((n) => (r.text.get(n) ?? []).join(" ")),
      pence,
      balance: balances[0] ? balances[0].pence : null,
    });
  }

  let reconciled = false;
  if (hasBalance) {
    const check = (newestFirst: boolean) => {
      for (let i = 0; i + 1 < out.length; i++) {
        const [later, earlier] = newestFirst ? [out[i], out[i + 1]] : [out[i + 1], out[i]];
        if (later.balance === null || earlier.balance === null) continue;
        if (later.balance - earlier.balance !== later.pence) return i;
      }
      return -1;
    };
    const down = check(true);
    const up = check(false);
    if (down !== -1 && up !== -1) {
      const at = out[Math.min(down, up) + 1];
      return fail(`The balances do not add up. They stop following from the amounts at the line dated ${dmy(at.iso)}. Tally may have read a number wrong, so it won't import this file.`);
    }
    reconciled = out.filter((l) => l.balance !== null).length > 1;
  }

  const header = ["Date", cols.find((c) => c.name === descName)!.name, ...typeNames, "Amount", ...(hasBalance ? ["Balance"] : [])];
  const csv =
    [header, ...out.map((l) => [dmy(l.iso), l.desc, ...l.extra, money(l.pence), ...(hasBalance ? [l.balance === null ? "" : money(l.balance)] : [])])]
      .map((r) => r.map(cell).join(","))
      .join("\n") + "\n";
  const dates = out.map((l) => l.iso).sort();
  return {
    ok: true,
    csv,
    summary: {
      lines: out.length,
      from: period?.from ?? dates[0],
      to: period?.to ?? dates[dates.length - 1],
      inPence: out.reduce((s, l) => s + (l.pence > 0 ? l.pence : 0), 0),
      outPence: out.reduce((s, l) => s + (l.pence < 0 ? -l.pence : 0), 0),
      reconciled,
    },
  };
}

export { MAX_PDF_PAGES } from "./pdf-run";

/** Reads a PDF file. The PDF itself is opened in a separate thread with limits (see pdf-run.ts). */
export async function readPdfStatement(bytes: Uint8Array): Promise<PdfResult> {
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return fail("That file is not a PDF.");
  const opened = await readPdfItemsIsolated(bytes);
  return opened.ok ? statementFromPages(opened.pages) : fail(opened.error);
}

/** One plain sentence for the preview, so the person can compare it with the bank. */
export function describeSummary(s: PdfSummary): string {
  const range = s.from && s.to ? `${dmy(s.from)} to ${dmy(s.to)}` : "";
  const checked = s.reconciled ? "Every balance in the PDF follows from the line before it." : "This PDF has no balance column, so Tally can't check the lines that way. Compare the totals with your bank.";
  return `Read ${s.lines} lines${range ? `, ${range}` : ""}. Money in £${money(s.inPence)}. Money out £${money(s.outPence)}. ${checked}`;
}
