// Runs before each test file's own imports, so lib/db/index.ts (which opens
// the sqlite file at import time) sees a throwaway DB - never a real one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
// Real per-user encrypted files (lib/db/pool.ts) land here instead of the
// app's real default - same throwaway-tmp-dir treatment as DATABASE_PATH.
process.env.USERS_DB_DIR = path.join(dir, "users");
process.env.TALLY_API_TOKEN = "test-token";
// lib/user-dek.ts and lib/backup-crypto.ts both seal secrets with this -
// tests that touch either (sign-in resolution, auto-backup passwords)
// need a value here, same as the real app needs one set for real.
process.env.AUTH_SECRET = "test-auth-secret";
