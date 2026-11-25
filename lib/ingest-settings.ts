import path from "node:path";

/** Where a person's ingest folder is, and whether it is switched on. Pure.
 *
 * Desktop: any folder the person picks in Settings, saved in their database.
 * Self-hosted: the administrator maps ONE root into the container
 * (INGEST_DIR, in docker-compose.yml) and makes a subfolder per user named
 * after their email, like a consume folder per user. The person can't pick
 * a path there: if they could, one user could point at another's folder and
 * import their files. */

export type StoredIngestConfig = { dir?: string; enabled?: boolean };

/** Tolerant: a damaged or hand-edited value is ignored, never a crash. */
export function parseStored(json: string | null | undefined): StoredIngestConfig {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: StoredIngestConfig = {};
  if (typeof r.dir === "string" && r.dir.trim()) out.dir = r.dir;
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  return out;
}

/** Checks a folder typed in the desktop Settings. Returns the cleaned path or throws a plain-words reason. */
export function validateDesktopDir(input: unknown): string {
  const dir = typeof input === "string" ? input.trim() : "";
  if (!dir) throw new Error("Enter the folder to watch.");
  if (dir.includes("\0")) throw new Error("That folder isn't valid.");
  if (!path.isAbsolute(dir)) throw new Error("Use a full path (for example /Users/you/Tally ingest, or C:\\Users\\you\\Tally ingest).");
  const resolved = path.normalize(dir); // absolute, checked above
  if (resolved === path.parse(resolved).root) throw new Error("Choose a folder, not the top of the disk.");
  return resolved;
}

/** The folder name for a self-hosted user: their email, as the admin sees it
 * in Settings > Admin. Null if the email can't safely be a folder name. */
export function userFolderName(email: string): string | null {
  const name = email.trim().toLowerCase();
  if (!name || name.startsWith(".") || /[/\\\0]/.test(name)) return null;
  return name;
}

export type Location =
  | { dir: string; problem: null; source: "saved" | "env" }
  | { dir: null; problem: string | null; source: "none" };

/** Where this person's files are looked for. `problem` explains why there is no folder, when that is a fault rather than "not set up". */
export function resolveLocation(opts: { desktop: boolean; stored: StoredIngestConfig; email: string; env: Record<string, string | undefined> }): Location {
  if (opts.desktop) {
    return opts.stored.dir ? { dir: path.normalize(opts.stored.dir), problem: null, source: "saved" } : { dir: null, problem: null, source: "none" };
  }
  const root = opts.env.INGEST_DIR?.trim();
  if (!root) return { dir: null, problem: null, source: "none" };
  const name = userFolderName(opts.email);
  if (!name) return { dir: null, problem: "Your email can't be used as a folder name. Ask your administrator.", source: "none" };
  return { dir: path.join(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ root), name), problem: null, source: "env" };
}

export const isOn = (stored: StoredIngestConfig) => stored.enabled !== false;
