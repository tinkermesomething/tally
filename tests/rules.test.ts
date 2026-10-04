import { describe, expect, it } from "vitest";
import { payeesMatch, validateConditions, allConditionsMatch } from "@/lib/rules";
import { gcAmountToPence } from "@/lib/gocardless";

describe("payeesMatch", () => {
  it.each([
    ["TESCO STORES 5439", "TESCO STORES 5439 BRANCH GB"],
    ["CLR*Abokado", "CLR*ABOKADO LONDON GB"],
    ["Patreon* Membershi", "PATREON* MEMBERSHIPPAT INTERNET GB"],
    ["GoHenry Junior ISA", "GOHENRY JUNIOR ISALYMINGTON GB"],
    ["  tesco   stores ", "TESCO STORES 5439"],
  ])("%s ~ %s", (a, b) => {
    expect(payeesMatch(a, b)).toBe(true);
    expect(payeesMatch(b, a)).toBe(true);
  });

  it.each([
    ["TESCO STORES 5439", "SAINSBURYS LONDON GB"],
    ["Lunch", "CLR*ABOKADO"],
    ["TES", "TESCO STORES"], // stub too short
    [null, "TESCO"],
    ["TESCO", undefined],
  ])("%s !~ %s", (a, b) => expect(payeesMatch(a, b)).toBe(false));
});

describe("gcAmountToPence", () => {
  it.each([["-12.34", -1234], ["12.3", 1230], ["5", 500], ["-0.05", -5], ["1000.00", 100000], ["0.999", 99]])("%s", (s, p) =>
    expect(gcAmountToPence(s)).toBe(p));
});

describe("rule conditions", () => {
  const t = { payeeRaw: "AMAZON.CO.UK      IE9MD9", payeeClean: null, amountPence: -2500, bankAccountId: 1 };
  it("matches ignoring case and runs of spaces", () => {
    const c = validateConditions([{ field: "payee", operator: "contains", value: "amazon.co.uk ie9" }]);
    expect(allConditionsMatch(c, t)).toBe(true);
  });
  it("compares amounts by size, not sign", () => {
    expect(allConditionsMatch(validateConditions([{ field: "amount", operator: "gt", value: "2000" }]), t)).toBe(true);
    expect(allConditionsMatch(validateConditions([{ field: "amount", operator: "lt", value: "2000" }]), t)).toBe(false);
  });
  it("rejects bad input", () => {
    expect(() => validateConditions([])).toThrow();
    expect(() => validateConditions([{ field: "amount", operator: "contains", value: "1" }])).toThrow();
    expect(() => validateConditions([{ field: "amount", operator: "gt", value: "-5" }])).toThrow();
  });
});
