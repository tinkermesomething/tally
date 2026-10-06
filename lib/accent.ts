import { HEX_COLOR, PRIDE_FLAGS, RGB_COLORS, SPECIAL_DEFAULT_MAIN, flowGradient, type PrideFlag } from "./savings-math";

export const ACCENTS = [
  { id: "blue", label: "Blue", swatch: "#2a78d6" },
  { id: "aqua", label: "Aqua", swatch: "#1baf7a" },
  { id: "violet", label: "Violet", swatch: "#4a3aa7" },
  { id: "orange", label: "Orange", swatch: "#eb6834" },
  { id: "green", label: "Green", swatch: "#008300" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export const DEFAULT_ACCENT: AccentId = "blue";

export function isAccentId(value: string | null): value is AccentId {
  return ACCENTS.some((accent) => accent.id === value);
}

// ---- Extended accents: any colour, two colours, animated RGB, pride flags ----


/** What the user picked. Stored as one text value:
 *   "blue" ... (a preset), "solid:#rrggbb", "duo:#rrggbb,#rrggbb",
 *   "special:rgb" or "special:<pride flag>", each optionally followed by
 *   "|#rrggbb" - a static main colour for text, outlines and tints. */
export type AccentSpec =
  | { kind: "preset"; id: AccentId }
  | { kind: "solid"; color: string }
  | { kind: "duo"; colors: [string, string] }
  | { kind: "rgb"; main?: string }
  | { kind: "pride"; flag: PrideFlag; main?: string };

export function parseAccent(raw: string | null | undefined): AccentSpec | null {
  const v = raw?.trim();
  if (!v) return null;
  if (isAccentId(v)) return { kind: "preset", id: v };
  if (v.startsWith("solid:") && HEX_COLOR.test(v.slice(6))) return { kind: "solid", color: v.slice(6) };
  if (v.startsWith("duo:")) {
    const parts = v.slice(4).split(",");
    if (parts.length === 2 && HEX_COLOR.test(parts[0]) && HEX_COLOR.test(parts[1])) return { kind: "duo", colors: [parts[0], parts[1]] };
    return null;
  }
  if (v.startsWith("special:")) {
    const [name, main, ...rest] = v.slice(8).split("|");
    if (rest.length > 0 || (main !== undefined && !HEX_COLOR.test(main))) return null;
    if (name === "rgb") return { kind: "rgb", main };
    if (name in PRIDE_FLAGS) return { kind: "pride", flag: name as PrideFlag, main };
  }
  return null;
}

/** Text colour that stays readable on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#0b0b0b" : "#fcfcfb";
}

export const ACCENT_VARS = ["--primary", "--primary-foreground", "--ring", "--accent-gradient"] as const;

/** How an accent is applied to the page. Presets are plain CSS (data-accent);
 * everything else sets the same variables directly, plus a gradient that
 * accent-coloured surfaces (buttons, active tabs) paint when `gradient` is on. */
export type AccentApply = {
  attr: string;
  vars: Record<string, string>;
  gradient: boolean;
  animated: boolean;
};

export function accentApply(spec: AccentSpec): AccentApply {
  const solid = (color: string) => ({ "--primary": color, "--primary-foreground": readableOn(color), "--ring": color });
  switch (spec.kind) {
    case "preset":
      return { attr: spec.id, vars: {}, gradient: false, animated: false };
    case "solid":
      return { attr: "custom", vars: solid(spec.color), gradient: false, animated: false };
    case "duo":
      return {
        attr: "custom",
        vars: { ...solid(spec.colors[0]), "--accent-gradient": `linear-gradient(90deg, ${spec.colors[0]}, ${spec.colors[1]})` },
        gradient: true,
        animated: false,
      };
    // Specials always flow. The gradient only paints borders; the static main
    // colour (the user's, or a default for that special) drives text, row
    // outlines, tints and focus rings.
    case "rgb":
      return {
        attr: "custom",
        vars: { ...solid(spec.main ?? SPECIAL_DEFAULT_MAIN.rgb), "--accent-gradient": flowGradient(RGB_COLORS) },
        gradient: true,
        animated: true,
      };
    case "pride":
      return {
        attr: "custom",
        vars: { ...solid(spec.main ?? SPECIAL_DEFAULT_MAIN[spec.flag]), "--accent-gradient": flowGradient(PRIDE_FLAGS[spec.flag].colors) },
        gradient: true,
        animated: true,
      };
  }
}
