import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { writeBackup } from "@/lib/db/backup";
import { checkBackupPassword, encryptBackup } from "@/lib/backup-crypto";

export const dynamic = "force-dynamic";

/** Downloads a consistent copy of the whole database, password-protected by
 * default (AES-256-GCM, see lib/backup-crypto.ts). It is a POST so the
 * password travels in the body, never in a URL or the server log. The caller
 * must say `unprotected=1` to get a plain file - that is a deliberate choice,
 * not what happens when the password is simply left out.
 *
 * The page is behind the login already (middleware); this checks the session
 * itself too, because a route handler is a public HTTP endpoint like any
 * server action. */
export async function POST(request: Request) {
  if (!(await auth())) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Enter a password." }, { status: 400 });
  }
  const unprotected = form.get("unprotected") === "1";
  let password = "";
  if (!unprotected) {
    try {
      password = checkBackupPassword(form.get("password"));
    } catch (err) {
      return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
    }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-backup-"));
  const file = path.join(dir, "backup.db");
  try {
    await writeBackup(file);
    const plain = fs.readFileSync(file);
    const body = unprotected ? plain : encryptBackup(plain, password);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="tally-backup-${stamp}.${unprotected ? "db" : "tallybak"}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[backup] failed:", err);
    return NextResponse.json({ ok: false, error: "The backup failed. Try again." }, { status: 500 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
