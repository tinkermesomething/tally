import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { getAvailableYears } from "@/lib/db/queries";

export const GET = apiRoute(async () => {
  const years = await getAvailableYears();
  return NextResponse.json({ years });
});
