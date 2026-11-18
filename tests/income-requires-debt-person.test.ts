import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: async () => ({ user: { email: "t@t", sub: "test-sub" } }) }));
vi.mock("next/cache", () => ({ revalidatePath() {} }));

import { resetDb } from "./helpers/db";
import { asSignedInUser } from "./helpers/user";
import { db } from "@/lib/db";
import { incomeSources, debtLedgerEntries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { addIncomeSource, pencilInIncome, logIncomeTransaction } from "@/lib/db/queries";
import { addPerson } from "@/lib/db/debt";
import { logIncome } from "@/app/grid/actions";
import { categorizeImportedTransactionAsIncome } from "@/app/review/actions";
import { addLedgerEntry } from "@/app/debt/actions";
import { stageImportedTransactions } from "@/lib/db/bank-sync";
import { bankAccounts, importedTransactions } from "@/lib/db/schema";

const YEAR = 2026;

beforeEach(() => resetDb());

async function makeRequiredSource(name: string) {
  const source = await addIncomeSource(name);
  await db.update(incomeSources).set({ requiresDebtPerson: true }).where(eq(incomeSources.id, source.id));
  return source;
}

describe("requiresDebtPerson is enforced wherever an income transaction can be logged", () => {
  it(
    "logIncome rejects a required source with no person, accepts one with",
    asSignedInUser("test-sub", "t@t", async () => {
      const source = await makeRequiredSource("Loans");
      const bob = await addPerson("Bob");

      const rejected = await logIncome({ incomeSourceId: source.id, pounds: 20, entryDate: `${YEAR}-10-05` });
      expect(rejected.ok).toBe(false);

      const accepted = await logIncome({ incomeSourceId: source.id, pounds: 20, entryDate: `${YEAR}-10-05`, debtPersonId: bob.id });
      expect(accepted.ok).toBe(true);
    })
  );

  it("pencilInIncome rejects a required source with no person", async () => {
    const source = await makeRequiredSource("Loans");
    await expect(pencilInIncome({ incomeSourceId: source.id, amountPence: 2000, entryDate: `${YEAR}-10-05`, year: YEAR, month: 10 })).rejects.toThrow(
      "requires tagging"
    );
  });

  it(
    "categorizing a staged bank transaction as income rejects a required source with no person",
    asSignedInUser("test-sub", "t@t", async () => {
      const source = await makeRequiredSource("Loans");
      const [account] = await db
        .insert(bankAccounts)
        .values({ provider: "g", institutionId: "i", requisitionId: "r", externalAccountId: "e", displayName: "T", consentExpiresAt: new Date(Date.now() + 1e9) })
        .returning();
      await stageImportedTransactions(account.id, [{ importedId: "t1", amountPence: 2000, bookingDate: `${YEAR}-10-05`, payeeRaw: "Roberto" }]);
      const [row] = await db.select().from(importedTransactions);

      await expect(categorizeImportedTransactionAsIncome(row.id, { incomeSourceId: source.id })).rejects.toThrow("requires tagging");
    })
  );

  it("a non-required source is unaffected", async () => {
    const source = await addIncomeSource("Wages");
    const row = await logIncomeTransaction({ incomeSourceId: source.id, amountPence: 2000, entryDate: `${YEAR}-10-05`, year: YEAR, month: 10 });
    expect(row.amountPence).toBe(2000);
  });

  it(
    "addLedgerEntry's loan branch against a required source succeeds using its own personId, with the debt ledger row linked to the income transaction",
    asSignedInUser("test-sub", "t@t", async () => {
      const source = await makeRequiredSource("Loans");
      const bob = await addPerson("Bob");

      await addLedgerEntry({ personId: bob.id, pounds: 20, entryDate: `${YEAR}-10-05`, direction: "loan", incomeSourceId: source.id });

      const ledger = await db.select().from(debtLedgerEntries);
      expect(ledger).toHaveLength(1);
      expect(ledger[0].incomeTransactionId).not.toBeNull();
    })
  );
});
