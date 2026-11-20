import { describe, expect, it } from "vitest";
import { GUIDE } from "@/lib/help/guide";
import { HELP } from "@/lib/help/content";

const sectionIds = GUIDE.map((s) => s.id);

describe("help guide", () => {
  it("has unique section ids", () => {
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
  });

  it("every section has a title and content", () => {
    for (const s of GUIDE) {
      expect(s.title.trim(), s.id).not.toBe("");
      expect(s.blocks.length, s.id).toBeGreaterThan(0);
    }
  });

  it("every tip's Learn more link lands on a real section", () => {
    for (const [id, entry] of Object.entries(HELP)) {
      expect(sectionIds, id).toContain(entry.learnMore);
    }
  });

  it("every tip block names a real tip", () => {
    for (const s of GUIDE) {
      for (const b of s.blocks) if ("tip" in b) expect(HELP[b.tip], `${s.id}: ${b.tip}`).toBeDefined();
    }
  });

  it("a tip's section is visible in every build where the tip can show", () => {
    // settings.backup only renders on desktop, so its section may be desktop-only.
    for (const [id, entry] of Object.entries(HELP)) {
      const section = GUIDE.find((s) => s.id === entry.learnMore)!;
      if (section.only) expect(id, `${id} -> ${section.id}`).toBe(section.only === "desktop" ? "settings.backup" : "never");
    }
  });
});
