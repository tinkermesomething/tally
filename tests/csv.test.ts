import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "@/lib/csv";
import { detectDateFormat, guessMapping, isCsvMapping, mapCsvRows, parseAmount, parseDate, type CsvMapping } from "@/lib/csv-import";

describe("parseCsv", () => {
  it("reads quotes, escaped quotes, commas inside quotes and CRLF", () => {
    const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""",z\r\n');
    expect(rows).toEqual([["a", "b", "c"], ["x, y", 'say "hi"', "z"]]);
  });
  it("keeps a newline inside a quoted cell and drops blank lines and a BOM", () => {
    expect(parseCsv('﻿a,b\n\n"line1\nline2",2\n')).toEqual([["a", "b"], ["line1\nline2", "2"]]);
  });
  it("trims cell edges but keeps inner spaces; keeps empty cells in place", () => {
    expect(parseCsv("  a  b , ,c")).toEqual([["a  b", "", "c"]]);
  });
  it("detects semicolon, tab and pipe, and prefers the consistent delimiter", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a|b|c\n1|2|3")).toBe("|");
    expect(detectDelimiter("name,desc\n1,hello; world; ok")).toBe(",");
    expect(detectDelimiter("just one column")).toBe(",");
  });
  it("handles a file with no trailing newline and an empty file", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("parseDate", () => {
  it("ISO with or without a time", () => {
    expect(parseDate("2026-10-05")).toBe("2026-10-05");
    expect(parseDate("2026-10-05 14:22:11")).toBe("2026-10-05");
    expect(parseDate("2026-10-05T14:22:11Z")).toBe("2026-10-05");
  });
  it("day-first and month-first numeric dates follow the chosen format", () => {
    expect(parseDate("03/04/2026", "dmy")).toBe("2026-04-03");
    expect(parseDate("03/04/2026", "mdy")).toBe("2026-03-04");
    expect(parseDate("3-4-26", "dmy")).toBe("2026-04-03");
    expect(parseDate("31.12.2025", "dmy")).toBe("2025-12-31");
  });
  it("text months, any order, full or short", () => {
    expect(parseDate("5 Oct 2026")).toBe("2026-10-05");
    expect(parseDate("05-Oct-26")).toBe("2026-10-05");
    expect(parseDate("October 5, 2026")).toBe("2026-10-05");
    expect(parseDate("Oct 5th, 2026")).toBe("2026-10-05");
  });
  it("rejects impossible and unreadable dates", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("13/13/2026")).toBeNull();
    expect(parseDate("tomorrow")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("5 Foo 2026")).toBeNull();
  });
  it("detects day-first / month-first, and says so when it cannot tell", () => {
    expect(detectDateFormat(["25/12/2025", "03/04/2026"])).toEqual({ format: "dmy", ambiguous: false });
    expect(detectDateFormat(["12/25/2025", "03/04/2026"])).toEqual({ format: "mdy", ambiguous: false });
    expect(detectDateFormat(["03/04/2026", "05/06/2026"])).toEqual({ format: "dmy", ambiguous: true });
    expect(detectDateFormat(["2026-10-05"])).toEqual({ format: "ymd", ambiguous: false });
  });
});

describe("parseAmount", () => {
  it.each([
    ["12.50", 1250], ["-12.50", -1250], ["+7", 700], ["£1,234.56", 123456], ["-£3.20", -320],
    ["(45.00)", -4500], ["45.00-", -4500], ["12,50", 1250], ["1.234,56", 123456], ["1,234", 123400],
    ["0.99", 99], [".5", 50], ["1 000.00", 100000], ["€ 7,5", 750], ["12.345", 1235],
  ])("%s -> %s pence", (text, pence) => expect(parseAmount(text)).toBe(pence));
  it.each(["", "abc", "12abc", "--5", "1.2.3", "£", "."])("rejects %j", (text) => expect(parseAmount(text)).toBeNull());
  it("never goes through floating point (0.1 + 0.2 style traps)", () => {
    expect(parseAmount("0.29")).toBe(29);
    expect(parseAmount("1.15")).toBe(115);
    expect(parseAmount("19.99")).toBe(1999);
  });
});

const base: CsvMapping = { delimiter: ",", skipRows: 0, hasHeader: true, dateCol: 0, dateFormat: "dmy", amountMode: "single", amountCol: 1, inCol: 0, outCol: 0, flipSign: false, payeeCols: [2], idCol: null };

describe("mapCsvRows", () => {
  const text = "Date,Amount,Description\n05/10/2026,-12.50,TESCO\n06/10/2026,2500.00,WAGES\nbad,1,X\n07/10/2026,,Y\n08/10/2026,0.00,Z\n09/10/2026,5,\n";
  it("maps good rows and reports every bad one with its line and reason", () => {
    const { rows, errors, headers } = mapCsvRows(text, base);
    expect(headers).toEqual(["Date", "Amount", "Description"]);
    expect(rows.map((r) => [r.bookingDate, r.amountPence, r.payeeRaw])).toEqual([["2026-10-05", -1250, "TESCO"], ["2026-10-06", 250000, "WAGES"]]);
    expect(errors.map((e) => e.line)).toEqual([4, 5, 6, 7]);
    expect(errors[0].reason).toMatch(/date/i);
    expect(errors[1].reason).toMatch(/amount/i);
    expect(errors[2].reason).toMatch(/zero/i);
    expect(errors[3].reason).toMatch(/payee/i);
  });
  it("flip sign for files that show spending as positive", () => {
    const { rows } = mapCsvRows("d,a,p\n05/10/2026,12.50,SHOP", { ...base, flipSign: true });
    expect(rows[0].amountPence).toBe(-1250);
  });
  it("separate money in / money out columns (either may be empty)", () => {
    const t = "Date,Paid out,Paid in,Details\n05/10/2026,12.50,,SHOP\n06/10/2026,,2000.00,PAY\n";
    const { rows } = mapCsvRows(t, { ...base, amountMode: "split", outCol: 1, inCol: 2, payeeCols: [3] });
    expect(rows.map((r) => r.amountPence)).toEqual([-1250, 200000]);
  });
  it("skips lines above the table, works without a header, joins several payee columns, reads an id", () => {
    const t = "Statement for Mr X\nGenerated 2026\n05/10/2026,-3.00,Costa,Coffee,ID-1\n";
    const m: CsvMapping = { ...base, skipRows: 2, hasHeader: false, payeeCols: [2, 3], idCol: 4 };
    const { rows } = mapCsvRows(t, m);
    expect(rows).toEqual([{ line: 3, bookingDate: "2026-10-05", amountPence: -300, payeeRaw: "Costa · Coffee", idHint: "ID-1" }]);
  });
  it("European file: semicolons, decimal commas, month-first off", () => {
    const t = "Datum;Betrag;Text\n05.10.2026;-1.234,50;MIETE\n";
    const { rows } = mapCsvRows(t, { ...base, delimiter: ";" });
    expect(rows[0]).toMatchObject({ bookingDate: "2026-10-05", amountPence: -123450, payeeRaw: "MIETE" });
  });
  it("collapses payee whitespace and caps absurd lengths", () => {
    const { rows } = mapCsvRows(`d,a,p\n05/10/2026,1,"  A    B  ${"x".repeat(400)}"`, base);
    expect(rows[0].payeeRaw.startsWith("A B xxx")).toBe(true);
    expect(rows[0].payeeRaw.length).toBe(300);
  });
});

describe("guessMapping", () => {
  it("NatWest-style: header, signed amount, description", () => {
    const t = "Date,Type,Description,Value,Balance,Account Name,Account Number\n05/10/2026,POS,TESCO STORES,-12.50,100.00,A,1\n06/10/2026,BAC,WAGES,2500.00,2600.00,A,1\n";
    const g = guessMapping(t, ",");
    expect(g).toMatchObject({ hasHeader: true, dateCol: 0, amountMode: "single", amountCol: 3, payeeCols: [2], dateFormat: "dmy" });
    expect(mapCsvRows(t, g).rows).toHaveLength(2);
  });
  it("Revolut-style: ISO datetimes, Amount, Description", () => {
    const t = "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCARD_PAYMENT,Current,2026-10-05 10:00:00,2026-10-05 12:00:00,Greggs,-3.50,0.00,GBP,COMPLETED,50\n";
    const g = guessMapping(t, ",");
    expect(g.amountMode).toBe("single");
    const { rows } = mapCsvRows(t, g);
    expect(rows[0]).toMatchObject({ bookingDate: "2026-10-05", amountPence: -350, payeeRaw: "Greggs" });
  });
  it("split columns are noticed by their names", () => {
    const t = "Date,Details,Paid out,Paid in\n05/10/2026,SHOP,5.00,\n06/10/2026,WAGES,,100.00\n";
    const g = guessMapping(t, ",");
    expect(g.amountMode).toBe("split");
    expect(mapCsvRows(t, g).rows.map((r) => r.amountPence)).toEqual([-500, 10000]);
  });
  it("no header at all: works out the columns from what they contain", () => {
    const t = "05/10/2026,-12.50,TESCO STORES 1234\n06/10/2026,-3.00,COSTA COFFEE LONDON\n";
    const g = guessMapping(t, ",");
    expect(g.hasHeader).toBe(false);
    expect(mapCsvRows(t, g).rows.map((r) => [r.amountPence, r.payeeRaw])).toEqual([[-1250, "TESCO STORES 1234"], [-300, "COSTA COFFEE LONDON"]]);
  });
  it("day-first is detected from the data, month-first too", () => {
    expect(guessMapping("Date,Amount,Description\n25/12/2025,-1,A\n", ",").dateFormat).toBe("dmy");
    expect(guessMapping("Date,Amount,Description\n12/25/2025,-1,A\n", ",").dateFormat).toBe("mdy");
  });
  it("an id column is picked up by name", () => {
    const g = guessMapping("Date,Transaction ID,Amount,Description\n05/10/2026,abc123,-1,A\n", ",");
    expect(g.idCol).toBe(1);
  });
  it("validates a stored mapping before trusting it", () => {
    expect(isCsvMapping(base)).toBe(true);
    expect(isCsvMapping({ ...base, delimiter: "x" })).toBe(false);
    expect(isCsvMapping({ ...base, payeeCols: "a" })).toBe(false);
    expect(isCsvMapping(null)).toBe(false);
  });
});
