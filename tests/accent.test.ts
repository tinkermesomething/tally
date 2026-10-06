import { describe, expect, it } from "vitest";
import { ACCENTS, accentApply, parseAccent, readableOn } from "@/lib/accent";
import { PRIDE_FLAGS, RGB_COLORS, SPECIAL_DEFAULT_MAIN } from "@/lib/savings-math";

describe("parseAccent", () => {
  it("accepts presets, a custom colour, two colours, RGB and every flag", () => {
    for (const a of ACCENTS) expect(parseAccent(a.id)).toEqual({ kind: "preset", id: a.id });
    expect(parseAccent("solid:#12ab34")).toEqual({ kind: "solid", color: "#12ab34" });
    expect(parseAccent("duo:#112233,#445566")).toEqual({ kind: "duo", colors: ["#112233", "#445566"] });
    expect(parseAccent("special:rgb")).toEqual({ kind: "rgb", main: undefined });
    for (const flag of Object.keys(PRIDE_FLAGS)) expect(parseAccent(`special:${flag}`)).toEqual({ kind: "pride", flag, main: undefined });
    expect(parseAccent("special:rgb|#112233")).toEqual({ kind: "rgb", main: "#112233" });
    expect(parseAccent("special:ace|#445566")).toEqual({ kind: "pride", flag: "ace", main: "#445566" });
  });
  it("rejects anything else, so a damaged stored value falls back to the default", () => {
    for (const bad of [null, undefined, "", "pink", "solid:red", "solid:#abc", "duo:#112233", "duo:#112233,nope", "duo:#112233,#445566,#778899", "special:", "special:nope", "rgb", "special:rgb|", "special:rgb|red", "special:rgb|#112233|#445566"]) {
      expect(parseAccent(bad as string | null)).toBeNull();
    }
  });
});

describe("readableOn", () => {
  it("dark text on light colours, light text on dark ones", () => {
    expect(readableOn("#ffffff")).toBe("#0b0b0b");
    expect(readableOn("#ffed00")).toBe("#0b0b0b");
    expect(readableOn("#000000")).toBe("#fcfcfb");
    expect(readableOn("#4a3aa7")).toBe("#fcfcfb");
  });
});

describe("accentApply", () => {
  it("a preset is plain CSS: no variables, no gradient", () => {
    expect(accentApply(parseAccent("aqua")!)).toEqual({ attr: "aqua", vars: {}, gradient: false, animated: false });
  });
  it("a custom colour sets primary, its readable foreground and the focus ring", () => {
    const a = accentApply(parseAccent("solid:#ffed00")!);
    expect(a).toMatchObject({ attr: "custom", gradient: false, animated: false });
    expect(a.vars).toEqual({ "--primary": "#ffed00", "--primary-foreground": "#0b0b0b", "--ring": "#ffed00" });
  });
  it("two colours: first is the solid accent, both make the gradient", () => {
    const a = accentApply(parseAccent("duo:#e34948,#2a78d6")!);
    expect(a.vars["--primary"]).toBe("#e34948");
    expect(a.vars["--accent-gradient"]).toBe("linear-gradient(90deg, #e34948, #2a78d6)");
    expect(a).toMatchObject({ gradient: true, animated: false });
  });
  it("RGB flows: animated, a smooth looping gradient on borders", () => {
    const a = accentApply(parseAccent("special:rgb")!);
    expect(a).toMatchObject({ gradient: true, animated: true });
    expect(RGB_COLORS[0]).toBe(RGB_COLORS.at(-1));
    expect(a.vars["--accent-gradient"]).toContain(RGB_COLORS[0]);
    expect(a.vars["--accent-gradient"]).not.toMatch(/%/);
  });
  it("EVERY colour combination flows too: animated, smooth and looping, with a readable solid main colour", () => {
    for (const flag of Object.keys(PRIDE_FLAGS) as (keyof typeof PRIDE_FLAGS)[]) {
      const a = accentApply(parseAccent(`special:${flag}`)!);
      expect(a).toMatchObject({ gradient: true, animated: true, attr: "custom" });
      expect(a.vars["--primary"]).toBe(SPECIAL_DEFAULT_MAIN[flag]);
      expect(["#0b0b0b", "#fcfcfb"]).toContain(a.vars["--primary-foreground"]);
      expect(a.vars["--accent-gradient"]).not.toMatch(/%/);
      for (const c of PRIDE_FLAGS[flag].colors) expect(a.vars["--accent-gradient"]).toContain(c);
    }
  });
  it("an optional static main colour drives text/outlines/ring; the flowing gradient is unchanged", () => {
    for (const special of ["rgb", "trans"]) {
      const plain = accentApply(parseAccent(`special:${special}`)!);
      const withMain = accentApply(parseAccent(`special:${special}|#ffed00`)!);
      expect(withMain.vars["--primary"]).toBe("#ffed00");
      expect(withMain.vars["--ring"]).toBe("#ffed00");
      expect(withMain.vars["--primary-foreground"]).toBe("#0b0b0b"); // readable on yellow
      expect(withMain.vars["--accent-gradient"]).toBe(plain.vars["--accent-gradient"]);
      expect(withMain).toMatchObject({ gradient: true, animated: true });
    }
  });
  it("no display name is attached to any flag (colour combinations only)", () => {
    for (const flag of Object.values(PRIDE_FLAGS)) expect(Object.keys(flag)).toEqual(["colors"]);
  });
});
