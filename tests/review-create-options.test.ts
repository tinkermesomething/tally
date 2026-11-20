import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: async () => ({ user: { email: "t@t", sub: "test-sub" } }) }));
vi.mock("next/cache", () => ({ revalidatePath() {} }));

import { resetDb } from "./helpers/db";
import { asSignedInUser } from "./helpers/user";
import { db } from "@/lib/db";
import { categories, incomeSources } from "@/lib/db/schema";
import { createCategoryForReview, createIncomeSourceForReview } from "@/app/review/actions";

beforeEach(() => resetDb());

// The "+ New…" entry in the review pickers: on a budget built from a first CSV
// import there is nothing to pick until one is created from the row itself.
describe("createCategoryForReview / createIncomeSourceForReview", () => {
  it(
    "creates a plain top-level category and returns its id",
    asSignedInUser("test-sub", "t@t", async () => {
      const res = await createCategoryForReview("  Groceries ");
      expect(res).toMatchObject({ ok: true });
      const rows = await db.select().from(categories);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: "Groceries", parentId: null, isAnnual: false });
      expect(res).toEqual({ ok: true, id: rows[0].id });
    })
  );

  it(
    "creates an income source and returns its id",
    asSignedInUser("test-sub", "t@t", async () => {
      const res = await createIncomeSourceForReview("Salary");
      const rows = await db.select().from(incomeSources);
      expect(rows.map((r) => r.name)).toEqual(["Salary"]);
      expect(res).toEqual({ ok: true, id: rows[0].id });
    })
  );

  it(
    "a blank name is a returned error and creates nothing",
    asSignedInUser("test-sub", "t@t", async () => {
      expect(await createCategoryForReview("   ")).toEqual({ ok: false, error: "Name can't be empty." });
      expect(await createIncomeSourceForReview("")).toEqual({ ok: false, error: "Name can't be empty." });
      expect(await db.select().from(categories)).toHaveLength(0);
      expect(await db.select().from(incomeSources)).toHaveLength(0);
    })
  );
});
