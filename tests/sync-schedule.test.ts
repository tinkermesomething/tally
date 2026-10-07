import { describe, expect, it } from "vitest";
import { isSyncDue, shouldSyncNow } from "@/lib/scheduled-sync";
import { formatSyncTime, lastSyncSlot, nextSyncSlot, syncSlotHours } from "@/lib/sync-schedule";

const LON = "Europe/London";
const at = (iso: string) => new Date(iso).getTime();

describe("sync slots", () => {
  it("lists local slot hours", () => {
    expect(syncSlotHours(24)).toEqual([5]);
    expect(syncSlotHours(12)).toEqual([5, 17]);
    expect(syncSlotHours(6)).toEqual([5, 11, 17, 23]);
  });

  it("daily slot is 05:00 London time, in winter and summer", () => {
    // winter: GMT, so 05:00 local = 05:00Z
    expect(new Date(lastSyncSlot(at("2026-12-10T12:00:00Z"), 24, LON)).toISOString()).toBe("2026-12-10T05:00:00.000Z");
    // summer: BST, so 05:00 local = 04:00Z
    expect(new Date(lastSyncSlot(at("2026-07-10T12:00:00Z"), 24, LON)).toISOString()).toBe("2026-07-10T04:00:00.000Z");
  });

  it("before 05:00 the last slot is yesterday's; the next one is today's", () => {
    const now = at("2026-12-10T03:00:00Z");
    expect(new Date(lastSyncSlot(now, 24, LON)).toISOString()).toBe("2026-12-09T05:00:00.000Z");
    expect(new Date(nextSyncSlot(now, 24, LON)).toISOString()).toBe("2026-12-10T05:00:00.000Z");
  });

  it("handles the clocks changing", () => {
    // 2026-03-29 is the BST start: 05:00 local is 04:00Z
    expect(new Date(lastSyncSlot(at("2026-03-29T10:00:00Z"), 24, LON)).toISOString()).toBe("2026-03-29T04:00:00.000Z");
    // 2026-10-25 is the BST end: 05:00 local is 05:00Z
    expect(new Date(lastSyncSlot(at("2026-10-25T10:00:00Z"), 24, LON)).toISOString()).toBe("2026-10-25T05:00:00.000Z");
  });

  it("formats in the zone", () => {
    expect(formatSyncTime(at("2026-12-10T05:00:00Z"), LON)).toBe("Thu 10 Dec 05:00");
  });
});

describe("sync due", () => {
  const now = at("2026-12-10T12:00:00Z");
  it("is due when an account has not synced since this morning's slot", () => {
    expect(isSyncDue([{ lastSyncedAt: new Date("2026-12-10T04:59:00Z") }], 24, now, LON)).toBe(true);
    expect(isSyncDue([{ lastSyncedAt: new Date("2026-12-10T05:01:00Z") }], 24, now, LON)).toBe(false);
    expect(isSyncDue([{ lastSyncedAt: null }], 24, now, LON)).toBe(true);
  });

  it("a sync the night before does not count for today's slot", () => {
    expect(isSyncDue([{ lastSyncedAt: new Date("2026-12-09T23:30:00Z") }], 24, now, LON)).toBe(true);
  });

  it("one attempt per slot", () => {
    const accounts = [{ lastSyncedAt: null }];
    expect(shouldSyncNow(accounts, 24, at("2026-12-10T06:00:00Z"), now, LON)).toBe(false);
    expect(shouldSyncNow(accounts, 24, at("2026-12-09T06:00:00Z"), now, LON)).toBe(true);
  });
});
