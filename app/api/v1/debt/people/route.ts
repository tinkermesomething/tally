import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { addPerson, getPeopleWithBalances } from "@/lib/db/debt";

export const GET = apiRoute(async () => {
  const people = await getPeopleWithBalances();
  return NextResponse.json({ people });
});

// POST { name }
export const POST = apiRoute(async (request) => {
  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const created = await addPerson(body.name.trim());
  return NextResponse.json(created, { status: 201 });
});
