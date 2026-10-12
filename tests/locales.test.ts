import { describe, expect, it } from "vitest";
import { isLocale, SUPPORTED_LOCALES, LOCALE_LABELS, DEFAULT_LOCALE } from "@/lib/locales";

describe("isLocale", () => {
  it("accepts every supported locale", () => {
    for (const l of SUPPORTED_LOCALES) expect(isLocale(l)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isLocale("xx")).toBe(false);
    expect(isLocale("EN")).toBe(false); // case-sensitive - matches the exact codes messages/*.json is keyed by
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe("LOCALE_LABELS", () => {
  it("has a label for every supported locale, in its own language not English", () => {
    for (const l of SUPPORTED_LOCALES) expect(LOCALE_LABELS[l]).toBeTruthy();
    expect(LOCALE_LABELS.it).toBe("Italiano");
    expect(LOCALE_LABELS.fr).toBe("Français");
  });
});

it("DEFAULT_LOCALE is itself supported", () => {
  expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
});
