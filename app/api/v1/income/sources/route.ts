import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { addIncomeSource } from "@/lib/db/queries";

// POST { name }
export const POST = apiRoute(async (request) => {
  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const created = await addIncomeSource(body.name.trim());
  return NextResponse.json(created, { status: 201 });
});
