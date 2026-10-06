/** Pure helpers for savings buckets - no DB, no React, so they are easy to
 * test and the same maths is used everywhere a bucket is shown. */

/** Categorical colours a bucket can take without choosing its own - the
 * same hues as the charts, in the same order. */
export const BUCKET_COLORS = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Pride flags, as their stripes top to bottom (drawn left to right on a bar). */
export const PRIDE_FLAGS = {
  rainbow: { colors: ["#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"] },
  trans: { colors: ["#5bcefa", "#f5a9b8", "#ffffff", "#f5a9b8", "#5bcefa"] },
  bi: { colors: ["#d60270", "#d60270", "#9b4f96", "#0038a8", "#0038a8"] },
  pan: { colors: ["#ff218c", "#ffd800", "#21b1ff"] },
  nonbinary: { colors: ["#fcf434", "#ffffff", "#9c59d1", "#2c2c2c"] },
  lesbian: { colors: ["#d52d00", "#ef7627", "#ff9a56", "#ffffff", "#d162a4", "#b55690", "#a30262"] },
  ace: { colors: ["#000000", "#a3a3a3", "#ffffff", "#800080"] },
} as const;
export type PrideFlag = keyof typeof PRIDE_FLAGS;

/** The animated "RGB lighting" colours; first and last match so it loops. */
export const RGB_COLORS = ["#ff0040", "#00e060", "#0080ff", "#ff0040"] as const;

/** A bucket's colour is one text value: "#rrggbb" (solid), "#rrggbb,#rrggbb"
 * (two colours), or a SPECIAL - "special:rgb" or "special:<flag>" - which always
 * flows (animated, smoothly blended). A special may carry an optional static
 * main colour after a "|": "special:rgb|#rrggbb". That main colour is what text,
 * outlines and tints use; the animation only ever paints stripes, dots, bars and
 * borders. Empty/null = a palette colour picked by id. */
export type BucketColorSpec =
  | { kind: "auto" }
  | { kind: "solid"; color: string }
  | { kind: "duo"; colors: [string, string] }
  | { kind: "rgb"; main?: string }
  | { kind: "pride"; flag: PrideFlag; main?: string };

export function parseBucketColor(raw: string | null | undefined): BucketColorSpec | null {
  const v = raw?.trim();
  if (!v) return { kind: "auto" };
  if (HEX_COLOR.test(v)) return { kind: "solid", color: v };
  const two = v.split(",");
  if (two.length === 2 && HEX_COLOR.test(two[0]) && HEX_COLOR.test(two[1])) return { kind: "duo", colors: [two[0], two[1]] };
  if (v.startsWith("special:")) {
    const [name, main, ...rest] = v.slice("special:".length).split("|");
    if (rest.length > 0) return null;
    if (main !== undefined && !HEX_COLOR.test(main)) return null;
    if (name === "rgb") return { kind: "rgb", main };
    if (name in PRIDE_FLAGS) return { kind: "pride", flag: name as PrideFlag, main };
  }
  return null; // not a colour we know
}

export const isValidBucketColor = (raw: string | null | undefined) => parseBucketColor(raw) !== null;

/** Colours blended smoothly and looped (the first colour is repeated at the
 * end), so a sliding background never shows a seam. */
export function flowGradient(colors: readonly string[]): string {
  const loop = colors[colors.length - 1] === colors[0] ? colors : [...colors, colors[0]];
  return `linear-gradient(90deg, ${loop.join(", ")})`;
}

/** The solid colour a special uses for text, outlines and focus rings when the
 * user has not chosen a main colour. */
export const SPECIAL_DEFAULT_MAIN: Record<"rgb" | PrideFlag, string> = {
  rgb: "#0080ff",
  rainbow: "#004dff",
  trans: "#5bcefa",
  bi: "#9b4f96",
  pan: "#ff218c",
  nonbinary: "#9c59d1",
  lesbian: "#d52d00",
  ace: "#800080",
};

export type BucketPaint = {
  /** One static colour - for borders, icons, text and anywhere a gradient can't go. */
  accent: string;
  /** CSS for filling a stripe, dot or bar. */
  fill: { backgroundColor?: string; backgroundImage?: string };
  /** Specials flow: add the `bucket-rgb` class to the filled element. */
  animated: boolean;
};

/** How to draw a bucket: its own colour setting if valid, else a palette
 * colour chosen by id (stable, so it never changes under the user). */
export function bucketPaint(bucket: { id: number; color: string | null }): BucketPaint {
  const spec = parseBucketColor(bucket.color);
  if (spec?.kind === "solid") return { accent: spec.color, fill: { backgroundColor: spec.color }, animated: false };
  if (spec?.kind === "duo")
    return { accent: spec.colors[0], fill: { backgroundImage: `linear-gradient(90deg, ${spec.colors[0]}, ${spec.colors[1]})` }, animated: false };
  if (spec?.kind === "rgb")
    return { accent: spec.main ?? SPECIAL_DEFAULT_MAIN.rgb, fill: { backgroundImage: flowGradient(RGB_COLORS) }, animated: true };
  if (spec?.kind === "pride")
    return { accent: spec.main ?? SPECIAL_DEFAULT_MAIN[spec.flag], fill: { backgroundImage: flowGradient(PRIDE_FLAGS[spec.flag].colors) }, animated: true };
  const auto = BUCKET_COLORS[Math.abs(bucket.id - 1) % BUCKET_COLORS.length];
  return { accent: auto, fill: { backgroundColor: auto }, animated: false };
}

/** Kept for callers that only need one colour. */
export const bucketColor = (bucket: { id: number; color: string | null }): string => bucketPaint(bucket).accent;

export function balanceOf(b: { openingPence: number; depositedPence: number; withdrawnPence: number }): number {
  return b.openingPence + b.depositedPence - b.withdrawnPence;
}

/** 0-100, or null when the bucket has no goal. Never above 100 and never
 * below 0 (an overdrawn bucket shows an empty bar, not a negative one). */
export function progressPercent(balancePence: number, goalPence: number | null): number | null {
  if (!goalPence || goalPence <= 0) return null;
  return Math.max(0, Math.min(100, (balancePence / goalPence) * 100));
}

const DAY_MS = 86_400_000;
const isoToUtc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export type GoalStatus =
  | { kind: "none" } // no goal date
  | { kind: "reached" } // goal amount already saved
  | { kind: "overdue"; daysLate: number; remainingPence: number }
  | { kind: "on-the-way"; daysLeft: number; remainingPence: number; perMonthPence: number };

/** Where a bucket stands against its goal date. `today` is an ISO date, so
 * tests don't depend on the clock. A goal date with no goal amount has
 * nothing to compute, so it only reports how many days are left (as
 * remaining 0). */
export function goalStatus(
  b: { balancePence: number; goalPence: number | null; goalDate: string | null },
  today: string
): GoalStatus {
  if (!b.goalDate) return { kind: "none" };
  const remainingPence = b.goalPence ? Math.max(0, b.goalPence - b.balancePence) : 0;
  if (b.goalPence && b.balancePence >= b.goalPence) return { kind: "reached" };
  const daysLeft = Math.round((isoToUtc(b.goalDate) - isoToUtc(today)) / DAY_MS);
  if (daysLeft < 0) return { kind: "overdue", daysLate: -daysLeft, remainingPence };
  // Whole months left, at least 1: "£X a month" must never divide by zero or
  // by a fraction that makes the number absurd in the last week.
  const months = Math.max(1, Math.ceil(daysLeft / 30.4375));
  return { kind: "on-the-way", daysLeft, remainingPence, perMonthPence: Math.ceil(remainingPence / months) };
}
