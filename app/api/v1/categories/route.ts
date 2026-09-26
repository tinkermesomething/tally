import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { addCategory } from "@/lib/db/queries";

// POST { name, parentId?, groupName?, isAnnual?, annualMonth? }
export const POST = apiRoute(async (request) => {
  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const created = await addCategory({
    name: body.name.trim(),
    parentId: body.parentId ?? null,
    groupName: body.groupName ?? null,
    isAnnual: !!body.isAnnual,
    annualMonth: body.isAnnual ? (body.annualMonth ?? null) : null,
  });
  return NextResponse.json(created, { status: 201 });
});
