import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { renameCategory, updateCategoryGroup } from "@/lib/db/queries";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { name?, groupName? }
export const PATCH = apiRoute<Ctx>(async (request, { params }) => {
  const { id } = await params;
  const categoryId = parseInt(id, 10);
  const body = await request.json();

  if (typeof body.name === "string" && body.name.trim()) {
    await renameCategory(categoryId, body.name.trim());
  }
  if ("groupName" in body) {
    await updateCategoryGroup(categoryId, body.groupName || null);
  }

  return NextResponse.json({ ok: true });
});
