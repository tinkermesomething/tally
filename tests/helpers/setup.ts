// Runs before each test file's own imports, so lib/db/index.ts (which opens
// the sqlite file at import time) sees a throwaway DB - never a real one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
process.env.TALLY_API_TOKEN = "test-token";
