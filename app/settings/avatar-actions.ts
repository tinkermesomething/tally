"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { toResult, type ActionResult } from "@/lib/action-result";
import { setAvatarImage } from "@/lib/db/users";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Always `user.id` from the resolved session - never a passed-in id, same
 * rule as updateAvatarColor (app/settings/actions.ts). No resizing: stored
 * raw, up to the 10MB cap below - the <img> tag just scales it down. */
export async function uploadAvatarImageAction(formData: FormData): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image file.");
      if (!ALLOWED_TYPES.has(file.type)) throw new Error("That file type isn't supported - use PNG, JPEG, WebP or GIF.");
      if (file.size > MAX_BYTES) throw new Error("That image is too big - 10MB max.");
      const buffer = Buffer.from(await file.arrayBuffer());
      await setAvatarImage(user.id, buffer, file.type);
      revalidatePath("/", "layout");
    })
  );
}

// Hostname-pattern SSRF guard, not a DNS-resolving one - proportionate to
// this app's actual exposure (a small, admin-invited user list on a home
// LAN, not a public multi-tenant service). Blocks the obvious internal
// targets; does not defend against DNS rebinding.
const BLOCKED_HOSTS = /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?fd[0-9a-f]{2}:)/i;

function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That's not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http/https links are supported.");
  if (BLOCKED_HOSTS.test(url.hostname)) throw new Error("That address isn't reachable from here.");
  return url;
}

/** Fetches an image from a URL server-side and stores it the same way an
 * upload would - the form only ever offers one or the other, never both at
 * once (see components/settings/avatar-picker.tsx). */
export async function fetchAvatarFromUrlAction(rawUrl: string): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      const url = assertFetchableUrl(rawUrl.trim());
      // One deadline for the whole fetch, not just the connect/headers
      // phase - a slow-drip body (real or deliberately hostile) would
      // otherwise hang forever once the timeout below was cleared early.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        let res: Response;
        try {
          res = await fetch(url, { signal: controller.signal, redirect: "follow" });
        } catch {
          throw new Error("Couldn't reach that address.");
        }
        if (!res.ok) throw new Error(`That link returned ${res.status}.`);
        const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!ALLOWED_TYPES.has(contentType)) throw new Error("That link isn't a supported image type (PNG, JPEG, WebP or GIF).");
        const declaredLength = Number(res.headers.get("content-length") ?? "0");
        if (declaredLength > MAX_BYTES) throw new Error("That image is too big - 10MB max.");
        const buffer = await readCapped(res, MAX_BYTES);
        await setAvatarImage(user.id, buffer, contentType);
        revalidatePath("/", "layout");
      } finally {
        clearTimeout(timeout);
      }
    })
  );
}

/** Reads a response body up to `maxBytes`, cancelling the stream and
 * throwing the moment it's exceeded - never buffers more than that into
 * memory first. A lying or missing Content-Length header (checked by the
 * caller before this runs, as a cheap early rejection) is not a defense on
 * its own; this is the real enforcement. */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error("That image is too big - 10MB max.");
    return buffer;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("That image is too big - 10MB max.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

export async function removeAvatarImageAction(): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      await setAvatarImage(user.id, null, null);
      revalidatePath("/", "layout");
    })
  );
}
