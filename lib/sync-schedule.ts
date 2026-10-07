/** When the scheduled bank sync runs: fixed clock times, not "N hours after
 * the last one". An interval measured from the last sync drifts with every
 * restart and manual sync, so the real time was unpredictable (it often
 * landed the night before). Slots start at SYNC_START_HOUR and repeat every
 * `frequencyHours` (24 = once a day at 05:00; 12 = 05:00 and 17:00). */
export const SYNC_START_HOUR = 5;

export function syncTimeZone(): string {
  return process.env.APP_TIMEZONE || "Europe/London";
}

/** Local hours (0-23, ascending) at which a sync slot starts. */
export function syncSlotHours(frequencyHours: number, startHour = SYNC_START_HOUR): number[] {
  const hours = new Set<number>();
  for (let h = startHour; h < startHour + 24; h += frequencyHours) hours.add(h % 24);
  return [...hours].sort((a, b) => a - b);
}

function parts(ms: number, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** How far the zone is ahead of UTC at this instant, in ms (DST-aware). */
function offsetMs(ms: number, timeZone: string): number {
  const p = parts(ms, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** The instant a local wall-clock time happens in `timeZone`. */
function localToUtc(y: number, mo: number, d: number, h: number, timeZone: string): number {
  const guess = Date.UTC(y, mo - 1, d, h);
  let utc = guess - offsetMs(guess, timeZone);
  const again = guess - offsetMs(utc, timeZone);
  if (again !== utc) utc = again;
  return utc;
}

/** Slot start times (UTC ms) around `now`: yesterday, today and tomorrow. */
function slotsAround(now: number, frequencyHours: number, timeZone: string, startHour: number): number[] {
  const p = parts(now, timeZone);
  const out: number[] = [];
  for (const dayShift of [-1, 0, 1]) {
    const day = new Date(Date.UTC(p.y, p.mo - 1, p.d + dayShift));
    for (const h of syncSlotHours(frequencyHours, startHour)) {
      out.push(localToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, timeZone));
    }
  }
  return out.sort((a, b) => a - b);
}

/** The most recent slot start at or before `now`. `startHour` lets other
 * daily jobs (the automatic backup) share the same clock maths. */
export function lastSyncSlot(now: number, frequencyHours: number, timeZone = syncTimeZone(), startHour = SYNC_START_HOUR): number {
  const past = slotsAround(now, frequencyHours, timeZone, startHour).filter((s) => s <= now);
  return past[past.length - 1];
}

/** The next slot start after `now`. */
export function nextSyncSlot(now: number, frequencyHours: number, timeZone = syncTimeZone(), startHour = SYNC_START_HOUR): number {
  return slotsAround(now, frequencyHours, timeZone, startHour).find((s) => s > now)!;
}

/** Day of the week in the zone: 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(ms: number, timeZone = syncTimeZone()): number {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(new Date(ms));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** "Mon 7 Oct, 05:00" in the app's time zone. */
export function formatSyncTime(ms: number, timeZone = syncTimeZone()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(ms))
    .replace(",", "");
}
