import { describe, expect, it } from "vitest";
import { daysUntil, nextDueDateAfter } from "@/lib/bills-math";

describe("bill cadence math", () => {
  it("weekly adds 7 days", () => {
    expect(nextDueDateAfter("2026-01-01", "weekly", null)).toBe("2026-01-08");
  });
  it("custom_days adds the given number of days, minimum 1", () => {
    expect(nextDueDateAfter("2026-01-01", "custom_days", 10)).toBe("2026-01-11");
    expect(nextDueDateAfter("2026-01-01", "custom_days", 0)).toBe("2026-01-02");
  });
  it("monthly adds a month, clamping overflow to the target month's last day", () => {
    expect(nextDueDateAfter("2026-01-15", "monthly", null)).toBe("2026-02-15");
    // Jan 31 -> Feb has no 31st, so it clamps to the 28th (2026 isn't a leap year).
    expect(nextDueDateAfter("2026-01-31", "monthly", null)).toBe("2026-02-28");
  });
  it("monthly rolls the year over at December", () => {
    expect(nextDueDateAfter("2026-12-15", "monthly", null)).toBe("2027-01-15");
  });
  it("yearly adds 12 months, same clamping rule", () => {
    expect(nextDueDateAfter("2024-02-29", "yearly", null)).toBe("2025-02-28"); // leap day -> non-leap year
  });
  it("daysUntil: negative means overdue, zero means today", () => {
    expect(daysUntil("2026-01-10", "2026-01-05")).toBe(5);
    expect(daysUntil("2026-01-01", "2026-01-05")).toBe(-4);
    expect(daysUntil("2026-01-05", "2026-01-05")).toBe(0);
  });
});
