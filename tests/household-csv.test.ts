import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { householdCsvFilename, householdGridToCsv } from "@/lib/household-csv";
import type { HouseholdGridRow, HouseholdIncomeGridRow } from "@/lib/db/household";

function row(categoryName: string, groupName: string | null, contributors: string[], budgeted: number, spent: number): HouseholdGridRow {
  const months: HouseholdGridRow["months"] = {};
  for (let m = 1; m <= 12; m++) months[m] = { budgetedPence: m === 1 ? budgeted : 0, spentPence: m === 1 ? spent : 0 };
  return { categoryName, groupName, months, yearBudgetedPence: budgeted, yearSpentPence: spent, contributors };
}

function incomeRow(sourceName: string, contributors: string[], total: number): HouseholdIncomeGridRow {
  const months: HouseholdIncomeGridRow["months"] = {};
  for (let m = 1; m <= 12; m++) months[m] = m === 1 ? total : 0;
  return { sourceName, months, yearTotalPence: total, contributors };
}

describe("householdGridToCsv", () => {
  const grid = [row("Groceries", "Living", ["Alice", "Bob"], 50000, 20000)];
  const incomeGrid = [incomeRow("Salary", ["Alice"], 250000)];

  it("budgeted view: header, one row per category, contributors in the last column", () => {
    const parsed = parseCsv(householdGridToCsv(grid, [], 2026, "budgeted"));
    expect(parsed[0]).toEqual(["Category", "Group", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Year total", "Monthly average", "Shared by"]);
    expect(parsed[1]).toEqual(["Groceries", "Living", "500.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "500.00", "41.67", "Alice, Bob"]);
  });

  it("spent view: same shape, spent figures instead of budgeted", () => {
    const parsed = parseCsv(householdGridToCsv(grid, [], 2026, "spent"));
    expect(parsed[1][2]).toBe("200.00"); // Jan
    expect(parsed[1][14]).toBe("200.00"); // Year total
  });

  it("both: one row per category per type, with a Type column", () => {
    const parsed = parseCsv(householdGridToCsv(grid, [], 2026, "both"));
    expect(parsed[0][2]).toBe("Type");
    expect(parsed[1]).toEqual(expect.arrayContaining(["Budgeted"]));
    expect(parsed[2]).toEqual(expect.arrayContaining(["Spent"]));
  });

  it("includes shared income sources after a blank line, only when there are any", () => {
    const withIncome = parseCsv(householdGridToCsv(grid, incomeGrid, 2026, "budgeted"));
    const incomeLine = withIncome.find((r) => r[0] === "Income - Salary");
    expect(incomeLine).toBeDefined();
    expect(incomeLine?.at(-1)).toBe("Alice");

    const withoutIncome = parseCsv(householdGridToCsv(grid, [], 2026, "budgeted"));
    expect(withoutIncome.some((r) => r[0].startsWith("Income"))).toBe(false);
  });

  it("file names say the year and the view", () => {
    expect(householdCsvFilename(2026, "budgeted")).toBe("tally-household-2026-budgeted.csv");
    expect(householdCsvFilename(2026, "spent")).toBe("tally-household-2026-spent.csv");
    expect(householdCsvFilename(2026, "both")).toBe("tally-household-2026-budgeted-and-spent.csv");
  });
});
