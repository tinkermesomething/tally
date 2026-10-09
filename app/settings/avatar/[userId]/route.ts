import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAvatarImage } from "@/lib/db/users";

export const dynamic = "force-dynamic";

/** Streams a user's uploaded profile picture (lib/db/users.ts's
 * getAvatarImage) - never the generated initials avatar, which is drawn
 * client-side and needs no file at all. Any signed-in user can view any
 * other user's picture (the nav, the admin user list) - this is a profile
 * picture, not private data, so there's no per-owner check beyond "you're
 * signed in at all" (the page is already behind login via middleware; this
 * checks again itself, same reasoning as every other route handler in this
 * app - a route is a public HTTP endpoint regardless of what page links to
 * it). */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { userId } = await params;
  const id = Number(userId);
  if (!Number.isInteger(id)) return new NextResponse(null, { status: 400 });

  const image = await getAvatarImage(id);
  if (!image) return new NextResponse(null, { status: 404 });

  const etag = `"${image.updatedAt.getTime()}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      "Cache-Control": "private, max-age=86400",
      ETag: etag,
    },
  });
}
