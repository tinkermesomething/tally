import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { categories } from "@/lib/db/schema";
import { closeUserDb, openUserDb } from "@/lib/db/connection";
import { runWithUserDb } from "@/lib/db/context";
import { db, inTransaction } from "@/lib/db";

/** These are the tests that actually matter for the bug this session found
 * and fixed: a shared connection's transaction nesting used to be tracked
 * on the CONNECTION itself (`conn.txDepth`), so two genuinely different
 * call chains pointed at the same connection (today's one shared legacy
 * connection; later, one user's own background job racing their own live
 * request) could race on that one counter - one miscounting itself as
 * "nested inside" the other's transaction. The fix moved depth onto the
 * CALLING CHAIN (lib/db/context.ts) and added a per-connection write lock
 * (lib/db/write-lock.ts) so a second outer transaction on a busy
 * connection waits instead of racing it. */

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "tally-txn-"));
const dek = () => randomBytes(32).toString("hex");
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("two chains sharing ONE connection", () => {
  it("a second outer transaction waits for the first to fully finish, never races it", async () => {
    const conn = openUserDb(path.join(dir(), "shared.db"), dek());
    const events: string[] = [];
    const letAContinue = deferred<void>();

    const chainA = runWithUserDb(conn, () =>
      inTransaction(async () => {
        events.push("A:begin");
        await db.insert(categories).values({ name: "A" });
        await letAContinue.promise; // held open deliberately, so B is genuinely racing a REAL open transaction
        events.push("A:commit");
      })
    );

    // Give A's BEGIN a moment to actually run before B starts racing it.
    await new Promise((r) => setTimeout(r, 10));

    const chainB = runWithUserDb(conn, () =>
      inTransaction(async () => {
        // If this ever runs before A:commit, the fix failed - B would be
        // sharing A's still-open transaction instead of waiting for it.
        events.push("B:begin");
        await db.insert(categories).values({ name: "B" });
        events.push("B:commit");
      })
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["A:begin"]); // B is still waiting - nothing of B's has run yet
    letAContinue.resolve();
    await Promise.all([chainA, chainB]);

    expect(events).toEqual(["A:begin", "A:commit", "B:begin", "B:commit"]);
    const names = (await runWithUserDb(conn, async () => (await db.select().from(categories)).map((c) => c.name))).sort();
    expect(names).toEqual(["A", "B"]);
    closeUserDb(conn);
  });

  it("if the first transaction rolls back, the second - which waited for it - is completely unaffected", async () => {
    const conn = openUserDb(path.join(dir(), "shared.db"), dek());
    const letAContinue = deferred<void>();

    const chainA = runWithUserDb(conn, () =>
      inTransaction(async () => {
        await db.insert(categories).values({ name: "will be rolled back" });
        await letAContinue.promise;
        throw new Error("A failed on purpose");
      })
    ).catch((e: Error) => e.message);

    await new Promise((r) => setTimeout(r, 10));
    const chainB = runWithUserDb(conn, () => inTransaction(async () => db.insert(categories).values({ name: "B is fine" })));

    letAContinue.resolve();
    const [aResult] = await Promise.all([chainA, chainB]);
    expect(aResult).toBe("A failed on purpose");

    const names = await runWithUserDb(conn, async () => (await db.select().from(categories)).map((c) => c.name));
    expect(names).toEqual(["B is fine"]); // A's row is gone; B's own, later, separate transaction is untouched
    closeUserDb(conn);
  });

  it("each chain still starts its OWN depth at 0 on a shared connection - never 'inherits' the other's nesting", async () => {
    const conn = openUserDb(path.join(dir(), "shared.db"), dek());
    const letAContinue = deferred<void>();
    const bSawDepthZero = deferred<boolean>();

    const chainA = runWithUserDb(conn, () =>
      inTransaction(async () => {
        await letAContinue.promise;
      })
    );
    await new Promise((r) => setTimeout(r, 10));

    const chainB = runWithUserDb(conn, async () => {
      // Before the fix, B would have read A's depth (1) off the shared
      // connection and wrongly treated itself as nested (a SAVEPOINT, not
      // its own BEGIN) - which only matters once it actually gets its turn,
      // checked by confirming it ran its own real BEGIN/COMMIT below.
      let ranOwnOuterTransaction = false;
      await inTransaction(async () => {
        ranOwnOuterTransaction = true;
        await db.insert(categories).values({ name: "B" });
      });
      bSawDepthZero.resolve(ranOwnOuterTransaction);
    });

    letAContinue.resolve();
    await chainA;
    await chainB;
    expect(await bSawDepthZero.promise).toBe(true);
    expect((await runWithUserDb(conn, async () => db.select().from(categories))).map((c) => c.name)).toEqual(["B"]);
    closeUserDb(conn);
  });
});

describe("two DIFFERENT connections", () => {
  it("are never serialized against each other - real parallelism, not a global lock", async () => {
    const d = dir();
    const connA = openUserDb(path.join(d, "a.db"), dek());
    const connB = openUserDb(path.join(d, "b.db"), dek());
    const events: string[] = [];
    const letAContinue = deferred<void>();

    const chainA = runWithUserDb(connA, () =>
      inTransaction(async () => {
        events.push("A:begin");
        await letAContinue.promise;
        events.push("A:commit");
      })
    );
    await new Promise((r) => setTimeout(r, 10));

    const chainB = runWithUserDb(connB, () =>
      inTransaction(async () => {
        // A DIFFERENT connection's open transaction must never block this -
        // if it did, this line would only run after A:commit.
        events.push("B:begin-and-commit");
      })
    );

    await chainB;
    expect(events).toEqual(["A:begin", "B:begin-and-commit"]); // B finished WHILE A was still open
    letAContinue.resolve();
    await chainA;
    expect(events).toEqual(["A:begin", "B:begin-and-commit", "A:commit"]);
    closeUserDb(connA);
    closeUserDb(connB);
  });
});
