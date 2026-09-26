import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { getGridData } from "@/lib/db/queries";

export const GET = apiRoute(async (request) => {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? "", 10) || new Date().getFullYear();
  const data = await getGridData(year);
  return NextResponse.json(data);
});
