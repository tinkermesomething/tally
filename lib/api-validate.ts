import { NextResponse } from "next/server";

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Months are 1-12 everywhere: the DB, the grid and API.md. */
export function isMonth(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 12;
}

export function isYear(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1900 && (value as number) <= 9999;
}

/** A finite pounds amount; `allowZero` for planned amounts, which can be 0. */
export function isPounds(value: unknown, allowZero = false): value is number {
  return typeof value === "number" && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
}

/** Validates the {year, month} pair every month-scoped route takes. */
export function checkYearMonth(body: { year?: unknown; month?: unknown }): string | null {
  if (!isYear(body.year) || !isMonth(body.month)) return "year and month are required (month is 1-12)";
  return null;
}
