import { describe, expect, it } from "vitest";
import { decodeCsv } from "@/lib/csv-decode";
import { detectDelimiter } from "@/lib/csv";
import { detectDateFormat, detectSkipRows, guessMapping, isCsvMapping, layoutOf, layoutStatus, mapCsvRows, parseAmount, type CsvMapping, type DateFormat } from "@/lib/csv-import";
import { parseCsv } from "@/lib/csv";

/** What a person gets when they drop a real bank file in: every layout below
 * is run through the same steps as the import dialog (decode, pick the
 * separator, guess the columns, read the rows). Revolut's columns come from a
 * real export; the others are modelled on the layouts banks publish and
 * people post in forums, with made-up transactions. A bank that changes its
 * export will not break these tests - add its real header here when it does.
 * The money is checked to the penny. */

const utf8 = (s: string) => new TextEncoder().encode(s);
/** Windows-1252, which for the characters used here is Latin-1. */
const cp1252 = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));
const utf16le = (s: string) => new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]));

function read(bytes: Uint8Array, opts: { preferred?: DateFormat; patch?: Partial<CsvMapping> } = {}) {
  const { text, encoding } = decodeCsv(bytes);
  const mapping: CsvMapping = { ...guessMapping(text, detectDelimiter(text), opts.preferred), ...opts.patch };
  return { text, encoding, mapping, ...mapCsvRows(text, mapping) };
}
const summary = (r: ReturnType<typeof read>) => r.rows.map((x) => `${x.bookingDate} ${x.amountPence} ${x.payeeRaw}`);

describe("real-world layouts", () => {
  it("Revolut: fees come off the amount; plan-fee lines (amount 0, fee 7.99) are not lost", () => {
    const r = read(utf8(`Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
Card Payment,Current,2026-07-31 09:53:31,2026-08-01 13:39:19,Coffee Shop,-10.00,0.00,GBP,COMPLETED,134.63
Topup,Current,2026-08-02 10:00:00,2026-08-02 10:00:01,Payment from A PERSON,101.00,0.00,GBP,COMPLETED,235.63
Charge,Current,2026-08-28 01:45:21,2026-08-28 01:45:21,Premium plan fee,0.00,7.99,GBP,COMPLETED,227.64
Exchange,Current,2026-09-01 08:00:00,2026-09-01 08:00:00,Exchanged to GBP,50.00,0.50,GBP,COMPLETED,277.14
`));
    expect(r.mapping).toMatchObject({ hasHeader: true, dateCol: 2, amountCol: 5, feeCol: 6, payeeCols: [4], idCol: null });
    expect(r.errors).toEqual([]);
    expect(summary(r)).toEqual([
      "2026-07-31 -1000 Coffee Shop",
      "2026-08-02 10100 Payment from A PERSON",
      "2026-08-28 -799 Premium plan fee",
      "2026-09-01 4950 Exchanged to GBP",
    ]);
  });

  it("Monzo: separate Money In / Money Out, the bank's own ID, dd/mm/yyyy, emoji, quoted commas", () => {
    const r = read(utf8(`Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In
tx_0001,01/08/2026,09:15:02,Card payment,Pret A Manger,☕,Eating out,-4.50,GBP,-4.50,GBP,,"1 High St, London",,PRET A MANGER LONDON GBR,,-4.50,
tx_0002,03/08/2026,12:00:00,Faster payment,Employer Ltd,,Income,2500.00,GBP,2500.00,GBP,,,,SALARY AUG,,,2500.00
tx_0003,14/08/2026,18:30:10,Card payment,Tesco,🛒,Groceries,-23.10,GBP,-23.10,GBP,,,,TESCO STORES 3252,,-23.10,
`));
    expect(r.mapping).toMatchObject({ amountMode: "split", dateCol: 1, dateFormat: "dmy", payeeCols: [4], idCol: 0 });
    expect(r.errors).toEqual([]);
    expect(summary(r)).toEqual(["2026-08-01 -450 Pret A Manger", "2026-08-03 250000 Employer Ltd", "2026-08-14 -2310 Tesco"]);
    expect(r.rows.map((x) => x.idHint)).toEqual(["tx_0001", "tx_0002", "tx_0003"]);
  });

  it("Starling: a free-text Reference column is NOT taken as the bank's ID (it repeats)", () => {
    const r = read(utf8(`Date,Counter Party,Reference,Type,Amount (GBP),Balance (GBP),Spending Category,Notes
01/08/2026,Tesco,CARD PAYMENT,CONTACTLESS,-12.34,1000.00,GROCERIES,
15/08/2026,Landlord,Rent,FASTER PAYMENT,-950.00,50.00,HOME,
15/09/2026,Landlord,Rent,FASTER PAYMENT,-950.00,50.00,HOME,
28/08/2026,Employer Ltd,Salary,FASTER PAYMENT,2400.00,2450.00,INCOME,
`));
    expect(r.mapping).toMatchObject({ idCol: null, payeeCols: [1], amountCol: 4 });
    expect(summary(r)).toEqual(["2026-08-01 -1234 Tesco", "2026-08-15 -95000 Landlord", "2026-09-15 -95000 Landlord", "2026-08-28 240000 Employer Ltd"]);
  });

  it("Barclays: payee from Memo, extra Number/Account columns ignored", () => {
    const r = read(utf8(`Number,Date,Account,Amount,Subcategory,Memo
0,01/08/2026,20-00-00 12345678,-12.50,Contactless Card Purchase,TESCO STORES 3252   ON 31 JUL BCC
0,05/08/2026,20-00-00 12345678,2500.00,Direct Credit,ACME LTD SALARY
0,20/08/2026,20-00-00 12345678,-45.00,Direct Debit,GAS CO
`));
    expect(r.mapping).toMatchObject({ dateCol: 1, amountCol: 3, payeeCols: [5] });
    expect(summary(r)).toEqual(["2026-08-01 -1250 TESCO STORES 3252 ON 31 JUL BCC", "2026-08-05 250000 ACME LTD SALARY", "2026-08-20 -4500 GAS CO"]);
  });

  it("Lloyds / Halifax: Debit and Credit columns, sort code with a leading apostrophe", () => {
    const r = read(utf8(`Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance
01/08/2026,DEB,'30-99-99,12345678,TESCO STORES 3252,12.50,,987.50
03/08/2026,FPI,'30-99-99,12345678,ACME LTD SALARY,,2500.00,3487.50
`));
    expect(r.mapping).toMatchObject({ amountMode: "split", dateCol: 0, payeeCols: [4] });
    expect(summary(r)).toEqual(["2026-08-01 -1250 TESCO STORES 3252", "2026-08-03 250000 ACME LTD SALARY"]);
  });

  it("Nationwide: account summary above the table, text months, £ in Windows-1252", () => {
    const r = read(cp1252(`"Account Name:","Current Account"
"Account Balance:","£1,234.56"
"Available Balance:","£1,234.56"

"Date","Transaction type","Description","Paid out","Paid in","Balance"
"01 Aug 2026","Visa purchase","Tesco","£12.50","","£1,222.06"
"05 Aug 2026","Bank credit","Employer Ltd","","£2,500.00","£3,722.06"
`));
    expect(r.encoding).toBe("windows-1252");
    expect(r.mapping).toMatchObject({ skipRows: 3, hasHeader: true, amountMode: "split", payeeCols: [2] });
    expect(r.errors).toEqual([]);
    expect(summary(r)).toEqual(["2026-08-01 -1250 Tesco", "2026-08-05 250000 Employer Ltd"]);
  });

  it("Amex UK: spending is positive, so the sign must be flipped (the preview shows it; the mapping then remembers)", () => {
    const text = `Date,Description,Card Member,Account #,Amount
01/08/2026,TESCO STORES,A PERSON,XXXX-12345,12.50
03/08/2026,PAYMENT RECEIVED - THANK YOU,A PERSON,XXXX-12345,-200.00
`;
    const guessed = read(utf8(text));
    expect(guessed.mapping).toMatchObject({ payeeCols: [1], amountCol: 4, flipSign: false });
    const flipped = read(utf8(text), { patch: { flipSign: true } });
    expect(summary(flipped)).toEqual(["2026-08-01 -1250 TESCO STORES", "2026-08-03 20000 PAYMENT RECEIVED - THANK YOU"]);
  });

  it("Chase (US): month-first dates, payee from Description not Details (DEBIT/CREDIT)", () => {
    const r = read(utf8(`Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,08/01/2026,TESCO,-12.50,DEBIT_CARD,987.50,
CREDIT,08/14/2026,PAYROLL ACME,2500.00,ACH_CREDIT,3487.50,
`));
    expect(r.mapping).toMatchObject({ dateFormat: "mdy", payeeCols: [2], amountCol: 3 });
    expect(summary(r)).toEqual(["2026-08-01 -1250 TESCO", "2026-08-14 250000 PAYROLL ACME"]);
  });

  it("N26 (EU): ISO dates, quoted cells, Reference not taken as an ID", () => {
    const r = read(utf8(`"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"
"2026-08-01","2026-08-01","REWE","DE00000000000000000000","Outgoing Transfer","Einkauf","Main Account","-23.40","","",""
"2026-08-03","2026-08-03","ACME GmbH","DE00000000000000001","Income","Gehalt","Main Account","2500.00","","",""
`));
    expect(r.mapping).toMatchObject({ dateCol: 0, dateFormat: "ymd", amountCol: 7, payeeCols: [2], idCol: null });
    expect(summary(r)).toEqual(["2026-08-01 -2340 REWE", "2026-08-03 250000 ACME GmbH"]);
  });

  it("German-style: semicolons, decimal commas, dd.mm.yyyy, umlauts in Windows-1252, no English headers", () => {
    const r = read(cp1252(`Buchungstag;Wertstellung;Empfänger;Verwendungszweck;Betrag
01.08.2026;01.08.2026;Bäckerei Müller;Brötchen;-4,50
03.08.2026;03.08.2026;ACME GmbH;Gehalt August;2.500,00
15.08.2026;15.08.2026;Vermieter;Miete;-1.234,56
`));
    expect(r.mapping).toMatchObject({ delimiter: ";", dateCol: 0, amountCol: 4, payeeCols: [2] });
    expect(summary(r)).toEqual(["2026-08-01 -450 Bäckerei Müller", "2026-08-03 250000 ACME GmbH", "2026-08-15 -123456 Vermieter"]);
  });

  it("Excel 'Unicode text': UTF-16, tab separated", () => {
    const r = read(utf16le("Date\tDescription\tAmount\n01/08/2026\tTesco £\t-12.50\n03/08/2026\tSalary\t2500.00\n"));
    expect(r.encoding).toBe("utf-16le");
    expect(r.mapping.delimiter).toBe("\t");
    expect(summary(r)).toEqual(["2026-08-01 -1250 Tesco £", "2026-08-03 250000 Salary"]);
  });

  it("no header row at all (three bare columns)", () => {
    const r = read(utf8("01/08/2026,TESCO STORES,-12.50\n03/08/2026,ACME SALARY,2500.00\n"));
    expect(r.mapping).toMatchObject({ hasHeader: false, dateCol: 0, amountCol: 2, payeeCols: [1] });
    expect(summary(r)).toEqual(["2026-08-01 -1250 TESCO STORES", "2026-08-03 250000 ACME SALARY"]);
  });

  it("UTF-8 BOM, Windows line endings and a description that spans two lines", () => {
    const r = read(utf8('﻿Date,Description,Amount\r\n01/08/2026,"TESCO\r\nSTORES",-12.50\r\n03/08/2026,Salary,2500.00\r\n'));
    expect(r.encoding).toBe("utf-8");
    expect(r.errors).toEqual([]);
    expect(summary(r)).toEqual(["2026-08-01 -1250 TESCO STORES", "2026-08-03 250000 Salary"]);
  });

  it("a footer line (a total under the table) is reported, never silently dropped", () => {
    const r = read(utf8("Date,Description,Amount\n01/08/2026,Tesco,-12.50\nTotal,,-12.50\n"));
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toContain("date");
  });
});

describe("date order follows the person's setting when a file can't say", () => {
  const ambiguous = ["03/04/2026", "05/04/2026", "11/10/2026"];
  it("day-first by default, month-first when the setting is month-first", () => {
    expect(detectDateFormat(ambiguous)).toEqual({ format: "dmy", ambiguous: true });
    expect(detectDateFormat(ambiguous, "mdy")).toEqual({ format: "mdy", ambiguous: true });
    expect(detectDateFormat(ambiguous, "ymd")).toEqual({ format: "dmy", ambiguous: true });
  });
  it("a date that can only be one way beats the setting", () => {
    expect(detectDateFormat([...ambiguous, "25/04/2026"], "mdy")).toEqual({ format: "dmy", ambiguous: false });
    expect(detectDateFormat([...ambiguous, "04/25/2026"], "dmy")).toEqual({ format: "mdy", ambiguous: false });
  });
  it("reaches the guessed mapping", () => {
    const csv = "Date,Description,Amount\n03/04/2026,A,-1.00\n05/04/2026,B,-2.00\n";
    expect(read(utf8(csv)).rows[0].bookingDate).toBe("2026-04-03");
    expect(read(utf8(csv), { preferred: "mdy" }).rows[0].bookingDate).toBe("2026-03-04");
  });
});

describe("amount formats", () => {
  it.each([
    ["GBP 12.50", 1250],
    ["12.50 GBP", 1250],
    ["USD -12.50", -1250],
    ["−12.50", -1250],
    ["(12.50)", -1250],
    ["12.50 DR", -1250],
    ["12.50 CR", 1250],
    ["12.50DR", -1250],
    ["1'234.50", 123450],
    ["1’234.50", 123450],
    ["1 234,50", 123450],
    ["1 234,50", 123450],
    ["1.234,50", 123450],
    ["1,234.50", 123450],
    ["12,50-", -1250],
    ["€ 12,50", 1250],
    ["+12.50", 1250],
  ])("%s", (raw, pence) => expect(parseAmount(raw)).toBe(pence));

  it.each(["", "abc", "ABC 12", "12.5.0", "--5", "CR", "GBP"])("is not an amount: %j", (raw) => expect(parseAmount(raw)).toBeNull());
});

describe("encodings", () => {
  it("UTF-8 stays UTF-8 and keeps its characters", () => {
    expect(decodeCsv(utf8("Café £5"))).toEqual({ text: "Café £5", encoding: "utf-8" });
  });
  it("a Windows-1252 £ is read as £, not a replacement character", () => {
    expect(decodeCsv(cp1252("Tesco £5 café"))).toEqual({ text: "Tesco £5 café", encoding: "windows-1252" });
  });
  it("UTF-16 with a byte-order mark, either way round", () => {
    expect(decodeCsv(utf16le("a;£b")).text).toBe("a;£b");
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0xa3]);
    expect(decodeCsv(be)).toEqual({ text: "A£", encoding: "utf-16be" });
  });
});

describe("a summary above the table", () => {
  it("starts the table at the first line as wide as most lines", () => {
    expect(detectSkipRows(parseCsv("a,b\nc,d\nDate,Description,Amount\n1,2,3\n4,5,6\n7,8,9\n", ","))).toBe(2);
  });
  it("leaves an ordinary file alone", () => {
    expect(detectSkipRows(parseCsv("Date,Description,Amount\n1,2,3\n4,5,6\n", ","))).toBe(0);
    expect(detectSkipRows([])).toBe(0);
  });
});

describe("layout memory: a bank that changes its columns is caught", () => {
  const CSV = "Date,Description,Amount\n01/08/2026,Tesco,-12.50\n";
  const saved = (text = CSV): CsvMapping => {
    const m = guessMapping(text, ",");
    return { ...m, ...layoutOf(text, m) };
  };

  it("the same layout is fine, even with new columns at the end", () => {
    expect(layoutStatus(CSV, saved()).state).toBe("ok");
    expect(layoutStatus("Date,Description,Amount,Balance\n01/08/2026,Tesco,-12.50,100.00\n", saved()).state).toBe("ok");
  });
  it("header spelling, case and spacing don't matter", () => {
    expect(layoutStatus("DATE, description ,AMOUNT\n01/08/2026,Tesco,-12.50\n", saved()).state).toBe("ok");
  });
  it("a column inserted before the ones used is caught (the numbers would still parse)", () => {
    const now = "Date,Type,Description,Amount\n01/08/2026,Card,Tesco,-12.50\n";
    const s = layoutStatus(now, saved());
    expect(s.state).toBe("changed");
    expect(s.state === "changed" && s.reason).toContain('Column 2 was "Description"');
  });
  it("swapped or renamed columns are caught", () => {
    expect(layoutStatus("Date,Amount,Description\n01/08/2026,-12.50,Tesco\n", saved()).state).toBe("changed");
    expect(layoutStatus("Date,Payee,Amount\n01/08/2026,Tesco,-12.50\n", saved()).state).toBe("changed");
  });
  it("a change in a column the mapping does not read is harmless", () => {
    const wide = "Date,Description,Amount,Notes\n01/08/2026,Tesco,-12.50,x\n";
    expect(layoutStatus("Date,Description,Amount,Remarks\n01/08/2026,Tesco,-12.50,x\n", saved(wide)).state).toBe("ok");
  });
  it("a file with no header row is checked by its column count", () => {
    const bare = "01/08/2026,Tesco,-12.50\n";
    expect(layoutStatus("01/08/2026,Tesco,-12.50\n", saved(bare)).state).toBe("ok");
    expect(layoutStatus("01/08/2026,Tesco,-12.50,x\n", saved(bare)).state).toBe("changed");
  });
  it("a mapping saved before layouts were remembered is 'unknown', and old mappings still validate", () => {
    const old = guessMapping(CSV, ",");
    expect(layoutStatus(CSV, old).state).toBe("unknown");
    expect(isCsvMapping(old)).toBe(true);
    expect(isCsvMapping(saved())).toBe(true);
    expect(isCsvMapping({ ...old, headers: [1] })).toBe(false);
    expect(isCsvMapping({ ...old, feeCol: "x" })).toBe(false);
  });
});

describe("fees", () => {
  const csv = "Date,Description,Amount,Fee\n01/08/2026,Transfer out,-100.00,1.50\n02/08/2026,Top up,50.00,0.00\n03/08/2026,Plan,0.00,7.99\n04/08/2026,Bad,1.00,x\n";
  it("a fee always lowers the balance, and an unreadable fee is reported", () => {
    const r = read(utf8(csv));
    expect(r.mapping.feeCol).toBe(3);
    expect(r.rows.map((x) => x.amountPence)).toEqual([-10150, 5000, -799]);
    expect(r.errors.map((e) => e.reason)).toEqual(['Can\'t read the fee "x".']);
  });
  it("with the sign flipped (spending shown as positive) the fee still lowers the balance", () => {
    const r = read(utf8("Date,Description,Amount,Fee\n01/08/2026,Shop,10.00,1.00\n"), { patch: { flipSign: true } });
    expect(r.rows[0].amountPence).toBe(-1100);
  });
  it("a mapping without a fee column behaves exactly as before", () => {
    const r = read(utf8(csv), { patch: { feeCol: null } });
    expect(r.rows.map((x) => x.amountPence)).toEqual([-10000, 5000, 100]);
    const legacy = { ...r.mapping };
    delete legacy.feeCol;
    expect(mapCsvRows(csv, legacy).rows.map((x) => x.amountPence)).toEqual([-10000, 5000, 100]);
  });
});
