import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { addCategory, addIncomeSource, getEntriesForMonth, logExpense, logIncomeTransaction, setIncomeSourceRequiresDebtPerson } from "@/lib/db/queries";
import { addPerson } from "@/lib/db/debt";

const YEAR = 2026;

beforeEach(() => resetDb());

describe("getEntriesForMonth", () => {
  it("merges expense and income rows into one list, sorted newest-first, with signed amounts", async () => {
    const cat = await addCategory({ name: "Food", parentId: null, groupName: null, isAnnual: false, annualMonth: null });
    const source = await addIncomeSource("Wages");
    await logExpense({ categoryId: cat.id, amountPence: 1000, entryDate: `${YEAR}-10-05` });
    await logIncomeTransaction({ incomeSourceId: source.id, amountPence: 2000, entryDate: `${YEAR}-10-10`, year: YEAR, month: 10 });

    const rows = await getEntriesForMonth(YEAR, 10);

    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("income");
    expect(rows[0].amountPence).toBe(2000);
    expect(rows[0].label).toBe("Wages");
    expect(rows[1].kind).toBe("expense");
    expect(rows[1].amountPence).toBe(-1000);
    expect(rows[1].label).toBe("Food");
  });

  it("carries the debt tag and requiresDebtPerson through for an income row", async () => {
    const source = await addIncomeSource("Loans");
    const bob = await addPerson("Bob");
    await logIncomeTransaction({ incomeSourceId: source.id, amountPence: 2000, entryDate: `${YEAR}-10-05`, year: YEAR, month: 10, debtPersonId: bob.id });
    await setIncomeSourceRequiresDebtPerson(source.id, true);

    const [row] = await getEntriesForMonth(YEAR, 10);
    expect(row.debtPersonId).toBe(bob.id);
    expect(row.debtPersonName).toBe("Bob");
    expect(row.requiresDebtPerson).toBe(true);
    expect(row.savingsBucketId).toBeNull();
    expect(row.sharedToHousehold).toBe(false);
  });

  it("with no month, returns the whole year", async () => {
    const source = await addIncomeSource("Wages");
    await logIncomeTransaction({ incomeSourceId: source.id, amountPence: 1000, entryDate: `${YEAR}-01-05`, year: YEAR, month: 1 });
    await logIncomeTransaction({ incomeSourceId: source.id, amountPence: 1000, entryDate: `${YEAR}-11-05`, year: YEAR, month: 11 });

    const rows = await getEntriesForMonth(YEAR);
    expect(rows).toHaveLength(2);
  });
});
