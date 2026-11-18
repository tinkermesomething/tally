import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { incomeSources } from "@/lib/db/schema";
import { addIncomeSource, setIncomeSourceRequiresDebtPerson } from "@/lib/db/queries";
import { addCategoryRule } from "@/lib/db/bank-sync";
import { addPerson } from "@/lib/db/debt";

beforeEach(() => resetDb());

describe("setIncomeSourceRequiresDebtPerson", () => {
  it("turns the flag on when there are no rules targeting the source", async () => {
    const source = await addIncomeSource("Loans");
    await setIncomeSourceRequiresDebtPerson(source.id, true);
    const [updated] = await db.select().from(incomeSources).where(eq(incomeSources.id, source.id));
    expect(updated.requiresDebtPerson).toBe(true);
  });

  it("refuses when an active rule targets the source with no person pinned", async () => {
    const source = await addIncomeSource("Loans");
    await addCategoryRule({ conditions: [{ field: "payee", operator: "contains", value: "roberto" }], targetType: "income", incomeSourceId: source.id });
    await expect(setIncomeSourceRequiresDebtPerson(source.id, true)).rejects.toThrow("has no person pinned");
  });

  it("allows it when the only rule targeting the source already has a person pinned", async () => {
    const source = await addIncomeSource("Loans");
    const bob = await addPerson("Bob");
    await addCategoryRule({ conditions: [{ field: "payee", operator: "contains", value: "roberto" }], targetType: "income", incomeSourceId: source.id, debtPersonId: bob.id });
    await setIncomeSourceRequiresDebtPerson(source.id, true);
    const [updated] = await db.select().from(incomeSources).where(eq(incomeSources.id, source.id));
    expect(updated.requiresDebtPerson).toBe(true);
  });

  it("turning the flag off is always allowed, regardless of unpinned rules", async () => {
    const source = await addIncomeSource("Loans");
    await addCategoryRule({ conditions: [{ field: "payee", operator: "contains", value: "roberto" }], targetType: "income", incomeSourceId: source.id });
    await setIncomeSourceRequiresDebtPerson(source.id, false);
    const [updated] = await db.select().from(incomeSources).where(eq(incomeSources.id, source.id));
    expect(updated.requiresDebtPerson).toBe(false);
  });
});
