import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db, inTransaction } from "@/lib/db";
import { people } from "@/lib/db/schema";

beforeEach(resetDb);

const names = async () => (await db.select().from(people)).map((p) => p.name);

describe("inTransaction", () => {
  it("commits on success", async () => {
    await inTransaction(async () => {
      await db.insert(people).values({ name: "a" });
    });
    expect(await names()).toEqual(["a"]);
  });

  it("rolls everything back on throw", async () => {
    await expect(
      inTransaction(async () => {
        await db.insert(people).values({ name: "a" });
        throw new Error("x");
      })
    ).rejects.toThrow("x");
    expect(await names()).toEqual([]);
  });

  it("an inner failure that the outer catches only undoes the inner part", async () => {
    await inTransaction(async () => {
      await db.insert(people).values({ name: "outer" });
      await inTransaction(async () => {
        await db.insert(people).values({ name: "inner" });
        throw new Error("x");
      }).catch(() => {});
    });
    expect(await names()).toEqual(["outer"]);
  });

  it("an outer failure undoes a committed inner part", async () => {
    await expect(
      inTransaction(async () => {
        await inTransaction(async () => {
          await db.insert(people).values({ name: "inner" });
        });
        throw new Error("x");
      })
    ).rejects.toThrow();
    expect(await names()).toEqual([]);
  });

  it("stays usable after a failure (depth is restored)", async () => {
    await inTransaction(async () => {
      throw new Error("x");
    }).catch(() => {});
    await inTransaction(async () => {
      await db.insert(people).values({ name: "ok" });
    });
    expect(await names()).toEqual(["ok"]);
  });

  it("DB-only awaits never let another task run mid-transaction", async () => {
    let probeRan = false;
    setImmediate(() => {
      probeRan = true;
    });
    await inTransaction(async () => {
      await db.insert(people).values({ name: "a" });
      await db.select().from(people);
      await db.insert(people).values({ name: "b" });
      expect(probeRan).toBe(false);
    });
  });
});
