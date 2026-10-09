import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";
import { MAX_RESTORE_BYTES, restoreFromFile } from "@/lib/db/backup";
import { decryptBackup, isEncryptedBackup } from "@/lib/backup-crypto";
import { resolveCurrentUser } from "@/lib/db/current-user";
import { runWithUserDb } from "@/lib/db/context";
import type { UserConn } from "@/lib/db/connection";

export const dynamic = "force-dynamic";

/** Replaces all data with an uploaded backup file (see restoreFromFile for
 * the checks and the safety copy). A password-protected file needs its
 * password; a plain file is only taken when the caller says so
 * (`allowUnprotected=1`), so an unprotected file is never restored by
 * accident. Session-checked here as well as by middleware. */
export async function POST(request: Request) {
  // audit() writes straight to the always-open system keystore (see
  // lib/audit.ts) - no connection needs to be established first for a
  // rejected attempt to still be logged.
  let conn: UserConn;
  try {
    ({ conn } = await resolveCurrentUser());
  } catch {
    await audit("backup_restore_unauthenticated", undefined, clientIp(request));
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Choose a backup file." }, { status: 400 });
  }
  const upload = form.get("file");
  if (!(upload instanceof File) || upload.size === 0) {
    return NextResponse.json({ ok: false, error: "Choose a backup file." }, { status: 400 });
  }
  if (upload.size > MAX_RESTORE_BYTES) {
    return NextResponse.json({ ok: false, error: "That file is too large to be a Tally backup." }, { status: 400 });
  }

  return runWithUserDb(conn, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-restore-"));
    const file = path.join(dir, "upload.db");
    try {
      let bytes: Buffer = Buffer.from(await upload.arrayBuffer());
      if (isEncryptedBackup(bytes)) {
        const password = form.get("password");
        if (typeof password !== "string" || password === "") {
          return NextResponse.json({ ok: false, error: "This backup is password-protected. Enter its password." }, { status: 400 });
        }
        bytes = decryptBackup(bytes, password);
      } else if (form.get("allowUnprotected") !== "1") {
        return NextResponse.json(
          { ok: false, error: "This file has no password protection. Tick “This file has no password” to restore it anyway." },
          { status: 400 }
        );
      }
      fs.writeFileSync(file, bytes);
      const result = await restoreFromFile(file);
      revalidatePath("/", "layout");
      await audit("backup_restored", `${result.tables} tables, ${result.rows} rows, safety copy ${path.basename(result.safetyBackup)}`, clientIp(request));
      return NextResponse.json({ ok: true, rows: result.rows, tables: result.tables, safetyBackup: path.basename(result.safetyBackup) });
    } catch (err) {
      // Validation failures carry a plain-words reason; anything else is a bug.
      const known = err instanceof Error && !("code" in err);
      if (!known) console.error("[restore] failed:", err);
      await audit("backup_restore_failed", known ? (err as Error).message : "internal error", clientIp(request));
      return NextResponse.json(
        { ok: false, error: known ? (err as Error).message : "The restore failed and nothing was changed. Try again." },
        { status: 400 }
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
