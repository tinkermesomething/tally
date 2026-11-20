import { describe, expect, it } from "vitest";
import { HELP } from "@/lib/help/content";

const entries = Object.entries(HELP) as [string, { title: string; tip: string }][];
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);
const words = (text: string) => text.trim().split(/\s+/).length;

describe("help content", () => {
  it("has entries", () => {
    expect(entries.length).toBeGreaterThan(0);
  });
  it.each(entries)("%s is short and plain: at most two sentences, at most 45 words", (_id, { title, tip }) => {
    expect(title.trim()).not.toBe("");
    expect(tip.trim()).not.toBe("");
    expect(sentences(tip).length).toBeLessThanOrEqual(2);
    expect(words(tip)).toBeLessThanOrEqual(45);
  });
  it("uses each screen word the way the screen spells it", () => {
    const all = entries.map(([, e]) => e.tip).join(" ");
    expect(all).not.toMatch(/\bleft-to-spend\b|\bbudgetted\b|\bavailible\b/i);
  });
});
