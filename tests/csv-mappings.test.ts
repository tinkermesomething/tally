import { describe, expect, it } from "vitest";
import { guessMapping } from "@/lib/csv-import";
import { kindOfName, parseSavedMappings, withSavedMapping } from "@/lib/csv-mappings";

const a = guessMapping("Date,Description,Amount\n05/10/2026,TESCO,-12.50\n", ",");
const b = guessMapping("Date,Description,Type,Amount\n05/10/2026,TESCO,Card,-12.50\n", ",");

describe("saved mappings per file kind", () => {
  it("reads nothing, junk and damaged text as no mapping", () => {
    for (const v of [null, undefined, "", "{", "[]", '"x"', "{}"]) expect(parseSavedMappings(v)).toEqual({ csv: null, pdf: null });
  });
  it("reads the old shape (just a CSV mapping) as the CSV mapping", () => {
    expect(parseSavedMappings(JSON.stringify(a))).toEqual({ csv: a, pdf: null });
  });
  it("keeps the old shape for an account that only has CSVs, so nothing changes for it", () => {
    expect(withSavedMapping(null, "csv", a)).toBe(JSON.stringify(a));
    expect(withSavedMapping(JSON.stringify(a), "csv", b)).toBe(JSON.stringify(b));
  });
  it("adds a PDF mapping beside the CSV one, and each is replaced without touching the other", () => {
    const both = withSavedMapping(JSON.stringify(a), "pdf", b);
    expect(parseSavedMappings(both)).toEqual({ csv: a, pdf: b });
    const csvAgain = withSavedMapping(both, "csv", { ...a, flipSign: true });
    expect(parseSavedMappings(csvAgain)).toEqual({ csv: { ...a, flipSign: true }, pdf: b });
    const pdfAgain = withSavedMapping(csvAgain, "pdf", { ...b, dateCol: 1 });
    expect(parseSavedMappings(pdfAgain).csv).toEqual({ ...a, flipSign: true });
  });
  it("an account with only a PDF mapping works", () => {
    expect(parseSavedMappings(withSavedMapping(null, "pdf", b))).toEqual({ csv: null, pdf: b });
  });
  it("drops an invalid half and keeps the valid one", () => {
    expect(parseSavedMappings(JSON.stringify({ v: 2, csv: a, pdf: { nope: 1 } }))).toEqual({ csv: a, pdf: null });
  });
  it("tells the kind from the file name", () => {
    expect([kindOfName("a.pdf"), kindOfName("A.PDF"), kindOfName("a.csv"), kindOfName("a.txt")]).toEqual(["pdf", "pdf", "csv", "csv"]);
  });
});
