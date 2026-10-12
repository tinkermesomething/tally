import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/lib/locales";

/** Every locale file must parse, and every key it DOES have must be a real
 * key in en.json (the authoritative source - see next-intl.d.ts) - a
 * MISSING key is fine by design (next-intl falls back to English for it,
 * exactly how an incomplete "ongoing work" translation is meant to
 * behave), but a key present with a different NAME (a typo, or one
 * renamed in en.json without updating the others) would silently never be
 * read by anything and never fall back either - this catches that class
 * of mistake, without blocking a locale file from legitimately lagging
 * behind en.json's key set. */
function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
}

describe("messages/*.json", () => {
  const en = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", "en.json"), "utf-8"));
  const enKeys = flattenKeys(en).sort();

  it("en.json is non-empty", () => {
    expect(enKeys.length).toBeGreaterThan(0);
  });

  for (const locale of SUPPORTED_LOCALES) {
    if (locale === "en") continue;
    it(`${locale}.json parses, and every key it has is a real key in en.json`, () => {
      const raw = fs.readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8");
      const parsed = JSON.parse(raw);
      const unknown = flattenKeys(parsed).filter((k) => !enKeys.includes(k));
      expect(unknown).toEqual([]);
    });

    // Right now every locale ships the full nav namespace (this change's
    // own proof-of-concept) - not a general requirement (see the comment
    // above), just confirming THIS specific delivery is actually complete
    // for the surface it claims to translate, not a silent partial.
    it(`${locale}.json has the full nav namespace`, () => {
      const raw = fs.readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8");
      const parsed = JSON.parse(raw);
      expect(flattenKeys(parsed.nav).sort()).toEqual(flattenKeys(en.nav).sort());
    });
  }
});
