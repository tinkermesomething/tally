import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

/** Points SYSTEM_DB_PATH (and so the app lock file beside it) at a fresh
 * temp folder. Returns the folder. Undo with vi.unstubAllEnvs(). */
export function stubTempSystemDir(prefix = "tally-desktop-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  vi.stubEnv("SYSTEM_DB_PATH", path.join(dir, "system.db"));
  return dir;
}
