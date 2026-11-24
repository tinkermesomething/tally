import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** Proves the app can really write in a folder before a choice is saved, so
 * a typo or a missing mount shows up now, not as a failure at 3am. Creates
 * the folder if it is missing. Throws `message` when it can't. */
export function assertWritable(dir: string, message: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.tally-write-test-${randomBytes(4).toString("hex")}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
  } catch {
    throw new Error(message);
  }
}
