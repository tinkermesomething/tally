import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categories } from "@/lib/db/schema";
import { closeUserDb, openUserDb } from "@/lib/db/connection";
import { currentUserConn, hasUserDb, runWithUserDb } from "@/lib/db/context";
import { closeAllForTests, getOrOpenUserDb } from "@/lib/db/pool";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "tally-ctx-"));
const dek = () => randomBytes(32).toString("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("DB call outside any context", () => {
  it("fails loudly instead of silently using nothing", () => {
    expect(hasUserDb()).toBe(false);
    expect(() => currentUserConn()).toThrow(/No user database is active/);
  });
});

describe("runWithUserDb", () => {
  it("the active connection is reachable through awaits and nested function calls", async () => {
    const conn = openUserDb(path.join(dir(), "1.db"), dek());
    async function nested() {
      await sleep(1);
      return currentUserConn();
    }
    const seen = await runWithUserDb(conn, async () => {
      expect(currentUserConn()).toBe(conn);
      const fromNested = await nested();
      return fromNested;
    });
    expect(seen).toBe(conn);
    closeUserDb(conn);
  });

  it("the context is gone once runWithUserDb has returned", async () => {
    const conn = openUserDb(path.join(dir(), "1.db"), dek());
    await runWithUserDb(conn, async () => {
      expect(hasUserDb()).toBe(true);
    });
    expect(hasUserDb()).toBe(false);
    closeUserDb(conn);
  });

  it("TWO OVERLAPPING calls never see each other's connection, even interleaved - the real correctness property this whole design depends on", async () => {
    const d = dir();
    const a = openUserDb(path.join(d, "a.db"), dek());
    const b = openUserDb(path.join(d, "b.db"), dek());
    const seenInA: unknown[] = [];
    const seenInB: unknown[] = [];

    const taskA = runWithUserDb(a, async () => {
      seenInA.push(currentUserConn());
      await sleep(15); // b's task runs its own checks WHILE this is suspended
      seenInA.push(currentUserConn());
      await (await currentUserConn()).db.insert(categories).values({ name: "from A" });
    });
    const taskB = runWithUserDb(b, async () => {
      seenInB.push(currentUserConn());
      await sleep(5);
      seenInB.push(currentUserConn());
      await (await currentUserConn()).db.insert(categories).values({ name: "from B" });
    });
    await Promise.all([taskA, taskB]);

    expect(seenInA.every((c) => c === a)).toBe(true);
    expect(seenInB.every((c) => c === b)).toBe(true);
    expect(await a.db.select().from(categories)).toHaveLength(1);
    expect((await a.db.select().from(categories))[0].name).toBe("from A");
    expect((await b.db.select().from(categories))[0].name).toBe("from B");
    closeUserDb(a);
    closeUserDb(b);
  });

  it("nesting runWithUserDb (a sub-task for a DIFFERENT user) restores the outer one afterwards", async () => {
    const d = dir();
    const outer = openUserDb(path.join(d, "o.db"), dek());
    const inner = openUserDb(path.join(d, "i.db"), dek());
    await runWithUserDb(outer, async () => {
      expect(currentUserConn()).toBe(outer);
      await runWithUserDb(inner, async () => {
        expect(currentUserConn()).toBe(inner);
      });
      expect(currentUserConn()).toBe(outer);
    });
    closeUserDb(outer);
    closeUserDb(inner);
  });
});

describe("pool", () => {
  beforeEach(() => closeAllForTests());
  afterEach(() => closeAllForTests());

  it("reuses the same connection for the same user, opens a new one for a new user", () => {
    process.env.DATABASE_PATH = path.join(dir(), "tally.db");
    const first = getOrOpenUserDb(1, dek());
    const second = getOrOpenUserDb(1, dek()); // key is ignored once already open
    expect(second).toBe(first);
    const other = getOrOpenUserDb(2, dek());
    expect(other).not.toBe(first);
  });

  it("each user's file lives under USERS_DB_DIR, named by id", () => {
    const base = dir();
    process.env.USERS_DB_DIR = base;
    getOrOpenUserDb(42, dek());
    expect(fs.existsSync(path.join(base, "42.db"))).toBe(true);
  });
});
