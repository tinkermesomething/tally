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
