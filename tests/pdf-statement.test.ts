import { describe, expect, it } from "vitest";
import { readPdfStatement } from "@/lib/pdf-statement";
import { describePdfSummary } from "@/lib/pdf-summary";
import { MAX_PDF_PAGES, readPdfItemsIsolated } from "@/lib/pdf-run";
import { parseCsv } from "@/lib/csv";
import { guessMapping, mapCsvRows } from "@/lib/csv-import";
import { makePdf, page, right, width, type Line, type Placed } from "./helpers/make-pdf";

const read = (pages: Placed[][]) => readPdfStatement(makePdf(pages));
const rows = (csv: string) => parseCsv(csv, ",");

const BASIC: Line[] = [
  { date: "26 Sep", desc: "Mobile top-up", type: "Mobile/Online Transaction", in: "£8.00" },
  { date: "25 Sep", desc: "Lidl", out: "-£14.77" },
  { date: "21 Sep", desc: "SMITH A", type: "Mobile/Online Transaction", in: "£60.00" },
];

describe("reading a PDF statement", () => {
  it("rebuilds rows from positions, signs money out, and works out the year from the period", async () => {
    const r = await read([page(BASIC)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(rows(r.csv)).toEqual([
      ["Date", "Description", "Type", "Amount"],
      ["26/09/2026", "Mobile top-up", "Mobile/Online Transaction", "8.00"],
      ["25/09/2026", "Lidl", "Debit Card Transaction", "-14.77"],
      ["21/09/2026", "SMITH A", "Mobile/Online Transaction", "60.00"],
    ]);
    expect(r.summary).toMatchObject({ lines: 3, from: "2026-07-30", to: "2026-09-26", inPence: 6800, outPence: 1477, reconciled: false, left: [], leftCount: 0 });
  });

  it("goes straight through the normal CSV import", async () => {
    const r = await read([page(BASIC)]);
    if (!r.ok) throw new Error(r.error);
    const m = guessMapping(r.csv, ",");
    const { rows: parsed, errors } = mapCsvRows(r.csv, m);
    expect(errors).toEqual([]);
    expect(parsed.map((x) => [x.bookingDate, x.amountPence, x.payeeRaw])).toEqual([
      ["2026-09-26", 800, "Mobile top-up"],
      ["2026-09-25", -1477, "Lidl"],
      ["2026-09-21", 6000, "SMITH A"],
    ]);
  });

  it("joins the pages, each with its own column titles, and ignores footer text", async () => {
    const second: Line[] = [{ date: "16 Sep", desc: "MYREWARDS", type: "Automated Credit", in: "£5.00" }, { date: "15 Sep", desc: "Transport For London", out: "-£30.00" }];
    const r = await read([page(BASIC), page(second, { period: false, top: 640, footer: ["Registered in England and Wales No. 929027."] })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(rows(r.csv).length).toBe(6);
    expect(r.summary.lines).toBe(5);
  });

  it("keeps a wrapped description with its own line", async () => {
    const r = await read([page([{ date: "25 Sep", desc: "Lidl", out: "-£3.00", wrap: "Ealing Broadway" }, { date: "24 Sep", desc: "Tesco", out: "-£1.00" }])]);
    if (!r.ok) throw new Error(r.error);
    expect(rows(r.csv)[1][1]).toBe("Lidl Ealing Broadway");
    expect(rows(r.csv)[2][1]).toBe("Tesco");
  });

  it("quotes text that has a comma or a quote", async () => {
    const r = await read([page([{ date: "25 Sep", desc: 'Smith, J "Jo"', out: "-£3.00" }])]);
    if (!r.ok) throw new Error(r.error);
    expect(rows(r.csv)[1][1]).toBe('Smith, J "Jo"');
  });

  describe("with a running balance", () => {
    const lines: Line[] = [
      { date: "26 Sep", desc: "Pay", in: "£100.00", bal: "£350.00" },
      { date: "25 Sep", desc: "Lidl", out: "-£14.77", bal: "£250.00" },
      { date: "24 Sep", desc: "Tesco", out: "-£5.23", bal: "£264.77" },
    ];
    it("accepts balances that follow from the amounts, newest first", async () => {
      const r = await read([page(lines, { balance: true })]);
      if (!r.ok) throw new Error(r.error);
      expect(r.summary.reconciled).toBe(true);
      expect(rows(r.csv)[0]).toEqual(["Date", "Description", "Type", "Amount", "Balance"]);
    });
    it("accepts oldest first too", async () => {
      const r = await read([page([...lines].reverse(), { balance: true })]);
      expect(r.ok).toBe(true);
    });
    it("refuses when one balance does not follow, and names the line", async () => {
      const bad = lines.map((l) => (l.desc === "Lidl" ? { ...l, bal: "£251.00" } : l));
      const r = await read([page(bad, { balance: true })]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/balances do not add up/i);
    });
  });

  describe("refuses instead of guessing", () => {
    it("a line with a date but no amount", async () => {
      const r = await read([page([{ date: "26 Sep", desc: "Pay", in: "£8.00" }, { date: "25 Sep", desc: "Lidl" }])]);
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toMatch(/25 sep.*no amount/i);
    });
    it("an amount that is far below any line", async () => {
      const r = await read([page([{ date: "26 Sep", desc: "Pay", in: "£8.00" }], { footer: ["£99.00"] })]);
      expect(r).toMatchObject({ ok: false });
    });
    it("a date outside the period the statement covers", async () => {
      const r = await read([page([{ date: "29 Sep", desc: "Pay", in: "£8.00" }])]);
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toMatch(/not inside the period/i);
    });
    it("a date with no year when the period is missing", async () => {
      const r = await read([page([{ date: "26 Sep", desc: "Pay", in: "£8.00" }], { period: false })]);
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toMatch(/no year/i);
    });
    it("dates with no column titles above them", async () => {
      const r = await read([[{ s: "26 Sep", x: 20, y: 600 }, { s: "£8.00", x: 440, y: 600 }]]);
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toMatch(/column titles/i);
    });
    it("a later page that drops its titles still reads by the earlier page's columns", async () => {
      const r = await read([page(BASIC), [{ s: "16 Sep", x: 20, y: 600 }, { s: "Cafe", x: 100, y: 600 }, { ...right("-£3.00", 520 + width("Paid out")), y: 600 }]]);
      expect(r.ok && r.summary.lines).toBe(4);
    });
    it("two amounts on one line", async () => {
      const r = await read([page([{ date: "26 Sep", desc: "Pay", in: "£8.00", out: "-£1.00" }])]);
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toMatch(/more than one amount/i);
    });
    it("a PDF with no text (a scan)", async () => {
      const r = await read([[]]);
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toMatch(/scan/i);
    });
    it("a file that is not a PDF", async () => {
      expect(await readPdfStatement(new TextEncoder().encode("Date,Amount\n"))).toEqual({ ok: false, error: "That file is not a PDF." });
    });
    it("a damaged PDF", async () => {
      const r = await readPdfStatement(new TextEncoder().encode("%PDF-1.4\nnot really\n"));
      expect(r).toMatchObject({ ok: false });
    });
  });

  it("records the oldest and newest line read, apart from the period the statement claims", async () => {
    const r = await read([page(BASIC)]);
    if (!r.ok) throw new Error(r.error);
    expect(r.summary).toMatchObject({ firstLine: "2026-09-21", lastLine: "2026-09-26", from: "2026-07-30", to: "2026-09-26" });
    const noPeriod = await read([page([{ date: "26 Sep 2026", desc: "Pay", in: "£8.00" }], { period: false })]);
    if (!noPeriod.ok) throw new Error(noPeriod.error);
    expect(noPeriod.summary).toMatchObject({ from: null, to: null, firstLine: "2026-09-26" });
  });

  it("lists the text it did not turn into lines, so nothing is dropped unseen", async () => {
    const r = await read([page(BASIC, { footer: ["Registered in England and Wales No. 929027."] }), [{ s: "Important information about your account", x: 20, y: 700 }, { s: "Call us on 0800 000 000", x: 20, y: 680 }]]);
    if (!r.ok) throw new Error(r.error);
    expect(r.summary.left).toEqual(["Registered in England and Wales No. 929027.", "Important information about your account", "Call us on 0800 000 000"]);
    expect(r.summary.leftCount).toBe(3);
  });

  it("shows left-out text as whole lines, with an ellipsis when it is cut", async () => {
    const long = "i".repeat(150);
    const r = await read([[...page(BASIC), { s: "Page", x: 20, y: 300 }, { s: "1 of 2", x: 120, y: 300 }, { s: long, x: 20, y: 270 }]]);
    if (!r.ok) throw new Error(r.error);
    expect(r.summary.left).toEqual(["Page 1 of 2", `${"i".repeat(120)}…`]);
  });

  it("shows only the first few left-out lines but counts them all", async () => {
    const r = await read([page(BASIC, { footer: Array.from({ length: 20 }, (_, i) => `Note ${i}`), footerStep: 25 })]);
    if (!r.ok) throw new Error(r.error);
    expect(r.summary.left).toHaveLength(12);
    expect(r.summary.leftCount).toBe(20);
  });
});

describe("what the person is told", () => {
  const fmt = { money: (p: number) => `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`, date: (d: string) => d.split("-").reverse().join("/") };
  const base = { lines: 190, from: "2026-07-30", to: "2026-09-26", firstLine: "2026-07-31", lastLine: "2026-09-26", inPence: 1051034, outPence: 1049969, reconciled: false, left: [], leftCount: 0 };

  it("uses the person's own money and date format, and says when it can't prove the lines add up", () => {
    expect(describePdfSummary(base, fmt)).toEqual([
      "Read 190 lines, from 31/07/2026 to 26/09/2026. The statement says it covers 30/07/2026 to 26/09/2026.",
      "Money in £10,510.34. Money out £10,499.69.",
      "This PDF has no balance column, so Tally can't prove the lines add up. Check that these two totals match your bank's own figures for the same dates.",
    ]);
  });
  it("says so when the balances add up, and copes with one line and no stated period", () => {
    const one = describePdfSummary({ ...base, lines: 1, from: null, to: null, reconciled: true }, fmt);
    expect(one[0]).toBe("Read 1 line, from 31/07/2026 to 26/09/2026.");
    expect(one[2]).toBe("Every balance in the PDF follows from the line before it, so the lines add up.");
  });
  it("names the line that is wrong, and what to do instead", async () => {
    const r = await read([page([{ date: "26 Sep", desc: "Pay", in: "£8.00" }, { date: "25 Sep", desc: "Lidl" }])]);
    if (r.ok) throw new Error("should refuse");
    expect(r.error).toBe("The line at 25 Sep (Lidl), page 1 has no amount. Nothing was imported. If your bank offers a CSV, use that instead.");
  });
  it("gives every structural refusal the same way out", async () => {
    for (const pages of [[[]], [[{ s: "26 Sep", x: 20, y: 600 }]], [page([{ date: "29 Sep", desc: "Pay", in: "£8.00" }])]]) {
      const r = await read(pages);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Nothing was imported\. If your bank offers a CSV, use that instead\.$/);
    }
  });
});

describe("limits on opening a PDF", () => {
  it("stops reading when it takes too long, says so, and the next file still reads", async () => {
    const bytes = makePdf([page(BASIC)]);
    const slow = await readPdfItemsIsolated(bytes, 1);
    expect(slow).toMatchObject({ ok: false, error: expect.stringMatching(/took more than/) });
    const next = await readPdfStatement(bytes);
    expect(next.ok).toBe(true);
  });

  it("refuses a PDF with too many pages before reading any of them", async () => {
    const r = await readPdfStatement(makePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, () => [{ s: "x", x: 10, y: 10 }])));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/more than 200 pages/) });
  });

  it("reads several files one after another, never at the same time", async () => {
    const bytes = makePdf([page(BASIC)]);
    const results = await Promise.all([readPdfStatement(bytes), readPdfStatement(bytes), readPdfStatement(bytes)]);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
