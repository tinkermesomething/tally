import { describe, expect, it } from "vitest";
import { assertIsoDate, assertNonNegativePounds, assertPositivePence, assertPositivePounds } from "@/lib/validate";
import { defaultEntryDateFor, localIsoDate } from "@/lib/date";

describe("amount validation", () => {
  it.each([0, -1, NaN, Infinity, -Infinity])("positive pounds rejects %s", (n) => expect(() => assertPositivePounds(n)).toThrow());
  it("accepts a normal amount", () => expect(() => assertPositivePounds(12.5)).not.toThrow());
  it("non-negative accepts 0, rejects NaN/negative", () => {
    expect(() => assertNonNegativePounds(0)).not.toThrow();
    expect(() => assertNonNegativePounds(NaN)).toThrow();
    expect(() => assertNonNegativePounds(-0.01)).toThrow();
  });
  it.each([0, -5, 1.5, NaN])("positive pence rejects %s", (n) => expect(() => assertPositivePence(n)).toThrow());
});

describe("assertIsoDate", () => {
  it.each(["2026-10-04", "2024-02-29"])("accepts %s", (d) => expect(() => assertIsoDate(d)).not.toThrow());
  it.each(["2026-02-30", "2026-13-01", "2026-10-4", "tomorrow", "2026-02-29", ""])("rejects %s", (d) => expect(() => assertIsoDate(d)).toThrow());
});

describe("local dates (TZ-independent: built from local components)", () => {
  it("00:30 on 1 Oct is still 1 Oct, not 30 Sep", () => {
    expect(localIsoDate(new Date(2026, 9, 1, 0, 30))).toBe("2026-10-01");
  });
  it("defaultEntryDateFor uses today inside the cell's month, else that month's last day", () => {
    const now = new Date(2026, 9, 1, 0, 30);
    expect(defaultEntryDateFor(2026, 10, now)).toBe("2026-10-01");
    expect(defaultEntryDateFor(2026, 9, now)).toBe("2026-09-30");
    expect(defaultEntryDateFor(2026, 2, now)).toBe("2026-02-28");
  });
});

import { parsePounds } from "@/lib/money-input";

describe("parsePounds", () => {
  it.each([["12", 12], ["12.5", 12.5], [" 12.50 ", 12.5], [".5", 0.5], ["0", 0]])("%s", (raw, want) => expect(parsePounds(raw)).toBe(want));
  it.each(["12abc", "1e9", "-5", "", "  ", "1,000", "12.345", "NaN", "Infinity"])("rejects %j", (raw) => expect(parsePounds(raw)).toBeNull());
});
