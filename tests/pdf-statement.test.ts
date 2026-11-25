import { describe, expect, it } from "vitest";
import { describeSummary, readPdfStatement } from "@/lib/pdf-statement";
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
    expect(r.summary).toMatchObject({ lines: 3, from: "2026-07-30", to: "2026-09-26", inPence: 6800, outPence: 1477, reconciled: false });
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

  it("tells the person what it read, and says plainly when it could not check the balance", async () => {
    const r = await read([page(BASIC)]);
    if (!r.ok) throw new Error(r.error);
    expect(describeSummary(r.summary)).toBe(
      "Read 3 lines, 30/07/2026 to 26/09/2026. Money in £68.00. Money out £14.77. This PDF has no balance column, so Tally can't check the lines that way. Compare the totals with your bank.",
    );
  });
});
