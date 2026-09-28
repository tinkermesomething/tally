import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { getGridData } from "@/lib/db/queries";

export const GET = apiRoute(async (request) => {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  if (Number.isNaN(year)) {
    return NextResponse.json({ error: "year must be a valid number" }, { status: 400 });
  }
  const data = await getGridData(year);
  return NextResponse.json(data);
});
