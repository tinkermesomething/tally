import { describe, expect, it } from "vitest";
import { samePayeeText } from "@/lib/payee-match";

describe("samePayeeText", () => {
  it.each([
    ["Lidl", "LIDL GB EALING"],
    ["LIDL GB EALING", "lidl"],
    ["Tesco", "TESCO STORES 3342"],
    ["Transport For London (TFL)", "TRANSPORT FOR LONDON TFL TRAVEL CH"],
    ["Sainsbury's", "SAINSBURYS S/MKTS"],
    ["  Gousto ", "gousto"],
  ])("%s ~ %s", (a, b) => expect(samePayeeText(a, b)).toBe(true));

  it.each([
    ["Lidl", "Aldi"],
    ["Apple", "Applebees"],
    ["TFL TRAVEL CH", "Transport For London (TFL)"],
    ["", "Lidl"],
    ["Mr A", "Mr B"],
    ["123456", "123456 Coffee"],
    ["Pay", "Payment"],
  ])("%s !~ %s", (a, b) => expect(samePayeeText(a, b)).toBe(false));
});
