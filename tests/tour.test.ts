import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { getAppSettings, updateAppSettings } from "@/lib/db/settings";
import { TOUR_STEPS, nextStep, previousStep, stepsToShow } from "@/lib/help/tour";

const ctx = { desktop: true, mobile: false, helpIcons: true };

describe("tour steps", () => {
  it("opens with a centred card and closes with one", () => {
    expect(TOUR_STEPS[0].anchor).toBeUndefined();
    expect(TOUR_STEPS.at(-1)!.anchor).toBeUndefined();
  });

  it("has unique ids and plain copy", () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    for (const s of TOUR_STEPS) {
      for (const c of [ctx, { desktop: false, mobile: true, helpIcons: false }]) {
        expect(s.title(c).trim(), s.id).not.toBe("");
        expect(s.body(c).split(/[.!?](?:\s|$)/).filter(Boolean).length, `${s.id} body length`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("uses the words on screen", () => {
    const text = TOUR_STEPS.map((s) => s.title(ctx) + " " + s.body(ctx)).join(" ");
    for (const w of ["Add income", "Log expense", "Mark paid", "Left to spend"]) expect(text).toContain(w);
  });

  it("only mentions the ? icons when they are on", () => {
    const pills = TOUR_STEPS.find((s) => s.id === "summary-pills")!;
    expect(pills.body(ctx)).toContain("?");
    expect(pills.body({ ...ctx, helpIcons: false })).not.toContain("?");
  });

  it("words the grid for cards on a phone and a table elsewhere", () => {
    const grid = TOUR_STEPS.find((s) => s.id === "grid")!;
    expect(grid.body({ ...ctx, mobile: true })).toContain("card");
    expect(grid.body(ctx)).toContain("row");
  });

  it("words the review step for the build", () => {
    const review = TOUR_STEPS.find((s) => s.id === "review")!;
    expect(review.body(ctx)).toContain("CSV");
    expect(review.body({ ...ctx, desktop: false })).not.toContain("CSV");
  });
});

describe("walking the tour", () => {
  it("drops a step whose anchor is not on screen, keeps anchorless ones", () => {
    const shown = stepsToShow(TOUR_STEPS, (a) => a !== "summary-pills");
    expect(shown.map((s) => s.id)).not.toContain("summary-pills");
    expect(shown[0].id).toBe("welcome");
    expect(shown.at(-1)!.id).toBe("done");
    expect(shown).toHaveLength(TOUR_STEPS.length - 1);
  });

  it("moves forward, finishes on the last step, and never goes below zero", () => {
    expect(nextStep(0, 3)).toEqual({ index: 1 });
    expect(nextStep(2, 3)).toEqual({ finished: true });
    expect(previousStep(2)).toEqual({ index: 1 });
    expect(previousStep(0)).toEqual({ index: 0 });
  });
});

describe("tour anchors", () => {
  const root = path.resolve(__dirname, "..");
  const read = (dir: string): string =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .map((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return read(p);
        return e.name.endsWith(".tsx") ? fs.readFileSync(p, "utf8") : "";
      })
      .join("\n");
  const source = read(path.join(root, "app")) + read(path.join(root, "components"));

  it("every step's data-tour anchor exists in the components", () => {
    for (const s of TOUR_STEPS) {
      if (!s.anchor) continue;
      // data-tour="x", or data-tour={cond ? "x" : undefined}
      const found = new RegExp(`data-tour=(?:"${s.anchor}"|\\{[^}]*"${s.anchor}"[^}]*\\})`);
      expect(source, s.anchor).toMatch(found);
    }
  });
});

describe("tour_seen", () => {
  beforeEach(() => resetDb());

  it("starts false for a new account, and marking it seen twice is harmless", async () => {
    expect((await getAppSettings()).tourSeen).toBe(false);
    await updateAppSettings({ tourSeen: true });
    await updateAppSettings({ tourSeen: true });
    expect((await getAppSettings()).tourSeen).toBe(true);
  });

  it("does not reset when another setting changes", async () => {
    await updateAppSettings({ tourSeen: true });
    await updateAppSettings({ currency: "EUR" });
    expect((await getAppSettings()).tourSeen).toBe(true);
  });
});
