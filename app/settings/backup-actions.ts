"use server";

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { toResult, type ActionResult } from "@/lib/action-result";
import { sealSecret } from "@/lib/backup-crypto";
import { parseStored, validateSettingsInput, type BackupSettingsInput } from "@/lib/auto-backup-settings";
import { runAutoBackupNow } from "@/lib/auto-backup";
import { getAutoBackupStored, setAutoBackupStored } from "@/lib/db/settings";

/** Proves the app can really write there before the choice is saved, so a
 * typo or a missing mount shows up now, not as a failed backup at 3am. */
function assertWritable(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.tally-write-test-${randomBytes(4).toString("hex")}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
  } catch {
    throw new Error("Tally can't write to that folder. Check it exists (or can be created) and that the app's user (1000) may write to it.");
  }
}

/** Saves the automatic-backup choices from the edit panel. */
export async function saveAutoBackupSettings(input: BackupSettingsInput): Promise<ActionResult> {
  await requireSession();
  return toResult(async () => {
    const existing = parseStored(await getAutoBackupStored());
    const next = validateSettingsInput(input, existing, { seal: sealSecret, envHasPassword: !!process.env.BACKUP_PASSWORD });
    assertWritable(next.dir!);
    await setAutoBackupStored(JSON.stringify(next));
    revalidatePath("/settings");
  });
}

/** Forgets the saved choices, so the stack's .env (and the defaults) apply again. */
export async function resetAutoBackupSettings(): Promise<ActionResult> {
  await requireSession();
  return toResult(async () => {
    await setAutoBackupStored(null);
    revalidatePath("/settings");
  });
}

/** "Back up now": writes one automatic-style backup immediately. */
export async function backUpNow(): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  await requireSession();
  try {
    const file = await runAutoBackupNow();
    revalidatePath("/settings");
    return { ok: true, name: file.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The backup failed." };
  }
}
