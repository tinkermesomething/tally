import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories, categoryEntries, incomeEntries, incomeSources, incomeTransactions } from "@/lib/db/schema";
import { getGridData, logExpense } from "@/lib/db/queries";
import { parseCsv } from "@/lib/csv";
import { csvAmount, csvText, gridCsvFilename, gridToCsv } from "@/lib/grid-csv";

beforeEach(() => resetDb());
const YEAR = 2026;

async function seed() {
  const [rent] = await db.insert(categories).values({ name: "Rent", groupName: "Housing", sortOrder: 0 }).returning();
  const [subs] = await db.insert(categories).values({ name: "Subs, \"misc\"", groupName: "Fun", sortOrder: 1 }).returning();
  const [a] = await db.insert(categories).values({ name: "Apple", parentId: subs.id, sortOrder: 10 }).returning();
  const [b] = await db.insert(categories).values({ name: "=SUM(A1)", parentId: subs.id, sortOrder: 11 }).returning();
  const [wages] = await db.insert(incomeSources).values({ name: "Wages", sortOrder: 0 }).returning();
  await db.insert(categoryEntries).values([
    { categoryId: rent.id, year: YEAR, month: 1, amountPence: 90000, paid: false },
    { categoryId: rent.id, year: YEAR, month: 2, amountPence: 90000, paid: false },
    { categoryId: a.id, year: YEAR, month: 1, amountPence: 299, paid: false },
    { categoryId: b.id, year: YEAR, month: 1, amountPence: 500, paid: false },
  ]);
  await db.insert(incomeEntries).values([{ incomeSourceId: wages.id, year: YEAR, month: 1, amountPence: 400000 }]);
  // Actual received, same role logExpense plays for the categories above -
  // INCOME/Received now come from here, not the budgeted row.
  await db.insert(incomeTransactions).values([{ incomeSourceId: wages.id, year: YEAR, month: 1, amountPence: 400000, entryDate: `${YEAR}-01-01` }]);
  await logExpense({ categoryId: rent.id, amountPence: 90000, entryDate: `${YEAR}-01-01` });
  await logExpense({ categoryId: a.id, amountPence: 350, entryDate: `${YEAR}-01-09` });
  return { rent, subs, a, b };
}

describe("csv cell helpers", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvText('a,b')).toBe('"a,b"');
    expect(csvText('say "hi"')).toBe('"say ""hi"""');
    expect(csvText("line1\nline2")).toBe('"line1\nline2"');
    expect(csvText("plain")).toBe("plain");
    expect(csvText(null)).toBe("");
  });
  it("neutralises spreadsheet formulas (= + - @ tab CR) with a leading quote", () => {
    for (const bad of ["=1+1", "+1", "-1", "@x", "\tx", "\rx"]) expect(csvText(bad).replace(/"/g, "")).toMatch(/^'/);
    expect(csvText("a=b")).toBe("a=b");
  });
  it("amounts are plain pounds with two decimals; missing is blank", () => {
    expect(csvAmount(12345)).toBe("123.45");
    expect(csvAmount(-50)).toBe("-0.50");
    expect(csvAmount(0)).toBe("0.00");
    expect(csvAmount(undefined)).toBe("");
  });
  it("file names say the year and the view", () => {
    expect(gridCsvFilename(2026, "budgeted")).toBe("tally-grid-2026-budgeted.csv");
    expect(gridCsvFilename(2026, "spent")).toBe("tally-grid-2026-spent.csv");
    expect(gridCsvFilename(2026, "both")).toBe("tally-grid-2026-budgeted-and-spent.csv");
  });
});

describe("gridToCsv", () => {
  it("opens cleanly in a spreadsheet: BOM, CRLF line ends, a header row, round-trips through a CSV parser", async () => {
    await seed();
    const csv = gridToCsv(await getGridData(YEAR), "budgeted");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.includes("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "").includes("\n")).toBe(false); // every newline is a CRLF
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["Category", "Parent", "Group", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Year total", "Monthly average"]);
    expect(rows.every((r, i) => i === 0 || r.length === 1 || r.length === rows[0].length)).toBe(true);
  });
  it("budgeted: one row per category with its subcategories right under it, parent and group named", async () => {
    await seed();
    const rows = parseCsv(gridToCsv(await getGridData(YEAR), "budgeted"));
    const byName = (n: string) => rows.find((r) => r[0] === n)!;
    expect(byName("Rent").slice(0, 5)).toEqual(["Rent", "", "Housing", "900.00", "900.00"]);
    expect(byName("Rent")[15]).toBe("1800.00");
    const names = rows.map((r) => r[0]);
    expect(names.indexOf("Apple")).toBe(names.indexOf('Subs, "misc"') + 1); // child directly under its parent
    expect(byName("Apple")[1]).toBe('Subs, "misc"');
    expect(byName("Apple")[3]).toBe("2.99");
    expect(byName("Rent")[5]).toBe(""); // March has no plan: blank, not 0.00
  });
  it("names with commas and quotes survive; a formula-looking name is neutralised", async () => {
    await seed();
    const rows = parseCsv(gridToCsv(await getGridData(YEAR), "budgeted"));
    expect(rows.some((r) => r[0] === 'Subs, "misc"')).toBe(true);
    expect(rows.some((r) => r[0] === "'=SUM(A1)")).toBe(true);
    expect(rows.some((r) => r[0] === "=SUM(A1)")).toBe(false);
  });
  it("spent: the same rows, with what was actually paid", async () => {
    await seed();
    const rows = parseCsv(gridToCsv(await getGridData(YEAR), "spent"));
    const byName = (n: string) => rows.find((r) => r[0] === n)!;
    expect(byName("Rent")[3]).toBe("900.00");
    expect(byName("Apple")[3]).toBe("3.50"); // logged 350p against a 299p plan
    expect(byName("Rent")[15]).toBe("900.00");
  });
  it("spent: income shows what was actually received, not budgeted", async () => {
    await seed();
    const rows = parseCsv(gridToCsv(await getGridData(YEAR), "spent"));
    const wages = rows.find((r) => r[0] === "Income - Wages")!;
    expect(wages[3]).toBe("4000.00");
    expect(wages[15]).toBe("4000.00");
  });
  it("both: income gets a Budgeted row and a Received row", async () => {
    await seed();
    const rows = parseCsv(gridToCsv(await getGridData(YEAR), "both"));
    const wagesRows = rows.filter((r) => r[0] === "Income - Wages");
    expect(wagesRows.map((r) => r[3])).toEqual(["Budgeted", "Received"]);
  });
  it("both: two rows per category with a Type column", async () => {
    await seed();
    const rows = parseCsv(gridToCsv(await getGridData(YEAR), "both"));
    expect(rows[0][3]).toBe("Type");
    const rent = rows.filter((r) => r[0] === "Rent");
    expect(rent.map((r) => r[3])).toEqual(["Budgeted", "Spent"]);
    expect(rent[0][4]).toBe("900.00");
    expect(rent[1][4]).toBe("900.00");
  });
  it("the summary rows and income rows match the grid's own footer figures", async () => {
    await seed();
    const data = await getGridData(YEAR);
    const rows = parseCsv(gridToCsv(data, "budgeted"));
    const row = (n: string) => rows.find((r) => r[0] === n)!;
    expect(row("BUDGETED").slice(3, 15).map(Number)).toEqual(data.plannedByMonth.map((v) => v / 100));
    expect(row("INCOME")[3]).toBe("4000.00");
    expect(row("LEFT TO SPEND").slice(3, 15).map(Number)).toEqual(data.leftToSpendByMonth.map((v) => v / 100));
    expect(Number(row("ACTUALLY SPENT")[15])).toBe(data.yearTotal.actuallySpent / 100);
    expect(row("Income - Wages")[3]).toBe("4000.00");
  });
  it("an empty grid still produces a valid file (header + summary rows)", async () => {
    const rows = parseCsv(gridToCsv(await getGridData(YEAR), "budgeted"));
    expect(rows[0][0]).toBe("Category");
    expect(rows.some((r) => r[0] === "SUBTOTAL")).toBe(true);
  });
  it("totals add up: every budgeted category row's months sum to its year total", async () => {
    await seed();
    const rows = parseCsv(gridToCsv(await getGridData(YEAR), "budgeted"));
    for (const r of rows.filter((x) => ["Rent", "Apple"].includes(x[0]))) {
      const sum = r.slice(3, 15).reduce((s, v) => s + (v === "" ? 0 : Math.round(Number(v) * 100)), 0);
      expect(sum).toBe(Math.round(Number(r[15]) * 100));
    }
  });
});

import { spentTotals } from "@/lib/grid-totals";

describe("spent year total and average (shared by the Grid and the CSV)", () => {
  it("total is the sum; the average counts only the months with spending", () => {
    expect(spentTotals([0, 1000, 0, 2000, 0, 0, 0, 0, 0, 0, 0, 3000])).toEqual({ total: 6000, average: 2000 });
  });
  it("nothing spent: zero total and no average", () => {
    expect(spentTotals(Array(12).fill(0))).toEqual({ total: 0, average: undefined });
  });
  it("rounds the average to whole pence; only the first twelve months count", () => {
    expect(spentTotals([100, 100, 101, ...Array(9).fill(0), 99999])).toEqual({ total: 100 + 100 + 101, average: 100 });
  });
  it("the CSV's Spent view reports the same total and average as the grid", async () => {
    const { rent } = await seed();
    const data = await getGridData(YEAR);
    const rows = parseCsv(gridToCsv(data, "spent"));
    const row = rows.find((r) => r[0] === "Rent")!;
    const cat = data.categories.find((c) => c.id === rent.id)!;
    const t = spentTotals(cat.actualByMonth);
    expect(Math.round(Number(row[15]) * 100)).toBe(t.total);
    expect(Math.round(Number(row[16]) * 100)).toBe(t.average);
  });
});
