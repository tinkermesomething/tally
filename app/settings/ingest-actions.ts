"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireSession } from "@/lib/session";
import { toResult, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { assertWritable } from "@/lib/assert-writable";
import { isDesktopMode } from "@/lib/desktop/mode";
import { getIngestStored, setIngestStored } from "@/lib/db/settings";
import { readIngestFile, runIngest } from "@/lib/ingest-run";
import { parseStored, validateDesktopDir, type StoredIngestConfig } from "@/lib/ingest-settings";

async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip")?.trim() ?? "unknown";
}

/** Saves the ingest choices. On desktop the person picks the folder; on a
 * server only the on/off switch is theirs - the folder comes from the
 * administrator's INGEST_DIR (see lib/ingest-settings.ts for why). */
export async function saveIngestSettings(input: { enabled: boolean; dir?: string }): Promise<ActionResult> {
  return requireSession(() =>
    toResult(async () => {
      const next: StoredIngestConfig = { ...parseStored(await getIngestStored()), enabled: !!input.enabled };
      if (isDesktopMode()) {
        if (input.enabled || input.dir) {
          next.dir = validateDesktopDir(input.dir);
          assertWritable(next.dir, "Tally can't write to that folder. Check the path and that you may write there.");
        }
      }
      await setIngestStored(JSON.stringify(next));
      await audit("ingest_settings_changed", `enabled=${next.enabled}${next.dir ? ` dir=${next.dir}` : ""}`, await requestIp());
      revalidatePath("/settings");
    })
  );
}

export type CheckNowResult = { ok: true; message: string } | { ok: false; error: string };

/** The "Check now" button: one pass over the person's folder, right away. */
export async function checkIngestNow(): Promise<CheckNowResult> {
  return requireSession(async (user) => {
    try {
      const res = await runIngest(user.email);
      revalidatePath("/settings");
      revalidatePath("/review");
      if (res.state !== "ran") {
        const why = { off: "The ingest folder is switched off.", unset: res.problem ?? "No folder is set up yet.", missing: `The folder ${res.dir} doesn't exist.`, busy: "A check is already running. Try again in a moment." };
        return { ok: false, error: why[res.state] };
      }
      const o = res.report.outcomes;
      const done = o.filter((x) => x.state === "imported").length;
      const failed = o.filter((x) => x.state === "failed").length;
      const waiting = o.filter((x) => x.state === "waiting" || x.state === "settling").length;
      if (o.length === 0) return { ok: true, message: "Nothing to import." };
      return { ok: true, message: [`${done} imported`, failed ? `${failed} failed` : "", waiting ? `${waiting} waiting` : ""].filter(Boolean).join(", ") + "." };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "The check failed." };
    }
  });
}

/** Loads a waiting file so the person can confirm its columns and pick the account. */
export async function loadIngestFile(folder: string, name: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  return requireSession(async (user) => {
    try {
      return await readIngestFile(user.email, String(folder), String(name));
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Could not read the file." };
    }
  });
}
