import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: async () => ({ user: { email: "t@t", sub: "test-sub" } }) }));
vi.mock("next/cache", () => ({ revalidatePath() {} }));

import { resetDb } from "./helpers/db";
import { asSignedInUser } from "./helpers/user";
import { db } from "@/lib/db";
import { incomeTransactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { addIncomeSource, getGridData } from "@/lib/db/queries";
import { addPerson } from "@/lib/db/debt";
import { logIncome } from "@/app/grid/actions";
import { addLedgerEntry } from "@/app/debt/actions";

const YEAR = 2026;

beforeEach(() => resetDb());

describe("logIncome writes a real income_transactions row, not just the budgeted figure", () => {
  it(
    "a manually logged income amount counts immediately toward wagesByMonth, same as a bank-synced one would",
    asSignedInUser("test-sub", "t@t", async () => {
      const source = await addIncomeSource("Gifts");
      const res = await logIncome({ incomeSourceId: source.id, pounds: 20, entryDate: `${YEAR}-10-05` });
      expect(res.ok).toBe(true);

      expect(await db.select().from(incomeTransactions)).toHaveLength(1);
      const grid = await getGridData(YEAR);
      expect(grid.wagesByMonth[9]).toBe(2000); // October
    })
  );

  it(
    "a debt-linked income entry creates exactly one loan ledger row, tied to the transaction",
    asSignedInUser("test-sub", "t@t", async () => {
      const source = await addIncomeSource("Gifts");
      const bob = await addPerson("Bob");
      const res = await logIncome({ incomeSourceId: source.id, pounds: 20, entryDate: `${YEAR}-10-05`, debtPersonId: bob.id });
      expect(res.ok).toBe(true);

      const { debtLedgerEntries } = await import("@/lib/db/schema");
      const entries = await db.select().from(debtLedgerEntries);
      expect(entries).toHaveLength(1);
      const transaction = (await db.select().from(incomeTransactions))[0];
      expect(entries[0]).toMatchObject({ direction: "loan", incomeTransactionId: transaction.id });
    })
  );
});

describe("addLedgerEntry's loan branch writes a real income_transactions row too", () => {
  it(
    "a friend's loan logged as income counts toward wagesByMonth, with exactly one debt ledger row (not two)",
    asSignedInUser("test-sub", "t@t", async () => {
      const source = await addIncomeSource("Gifts");
      const bob = await addPerson("Bob");
      await addLedgerEntry({ personId: bob.id, pounds: 20, entryDate: `${YEAR}-10-05`, direction: "loan", incomeSourceId: source.id });

      const rows = await db.select().from(incomeTransactions).where(eq(incomeTransactions.incomeSourceId, source.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].amountPence).toBe(2000);

      const { debtLedgerEntries } = await import("@/lib/db/schema");
      expect(await db.select().from(debtLedgerEntries)).toHaveLength(1); // not double-counted

      const grid = await getGridData(YEAR);
      expect(grid.wagesByMonth[9]).toBe(2000);
    })
  );
});
