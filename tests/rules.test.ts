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

import { filterByFuzzy } from "@/lib/fuzzy";

describe("filterByFuzzy", () => {
  const rows = [
    { id: 1, texts: ["Shop groceries", "Food"] },
    { id: 2, texts: ["Thames Water", "Bills"] },
    { id: 3, texts: ["Go Henry ISA", "GoHenry", "Roberto"] },
  ];
  const ids = (q: string) => filterByFuzzy(rows, q, (r) => r.texts).map((r) => r.id);

  it("empty query keeps everything, in order", () => expect(ids("  ")).toEqual([1, 2, 3]));
  it("tolerates a typo", () => expect(ids("thmes watr")).toEqual([2]));
  it("matches on any text of the row, any word order", () => expect(ids("food groceries")).toEqual([1]));
  it("matches letters in order", () => expect(ids("ghnry")).toEqual([3]));
  it("returns nothing for a miss", () => expect(ids("zzzzzz")).toEqual([]));
  it("keeps original order, not score order", () => expect(ids("o")).toEqual(ids("o").slice().sort((a, b) => a - b)));
});
