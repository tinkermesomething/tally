import { describe, expect, it, vi } from "vitest";
import { runAction, toResult } from "@/lib/action-result";

describe("toResult", () => {
  it("ok on success", async () => expect(await toResult(async () => {})).toEqual({ ok: true }));

  it("turns a validation throw into a message", async () => {
    expect(await toResult(async () => { throw new Error("Name can't be empty."); })).toEqual({ ok: false, error: "Name can't be empty." });
  });

  it("never leaks a database error's text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dbErr = Object.assign(new Error("NOT NULL constraint failed: categories.name"), { code: "SQLITE_CONSTRAINT_NOTNULL" });
    const res = await toResult(async () => { throw dbErr; });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("categories");
  });
});

describe("runAction", () => {
  it("null on success, including actions that return nothing", async () => {
    expect(await runAction(async () => ({ ok: true }))).toBeNull();
    expect(await runAction(async () => undefined)).toBeNull();
  });
  it("returns the message from a failed result", async () => {
    expect(await runAction(async () => ({ ok: false, error: "bad" }))).toBe("bad");
  });
  it("also catches a throw", async () => {
    expect(await runAction(async () => { throw new Error("boom"); })).toBe("boom");
  });
});
