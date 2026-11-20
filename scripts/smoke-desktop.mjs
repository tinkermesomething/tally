// Starts the STAGED server (src-tauri/resources) the way the launcher does,
// with a throwaway data folder, and checks it answers. Proves the bundled
// Node and the platform's native sqlite addon load and the database opens -
// the part a green compile can't tell you. Run after stage-desktop.mjs.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const resources = path.resolve(import.meta.dirname, "..", "src-tauri", "resources");
const nodeBin = path.join(resources, "node", process.platform === "win32" ? "node.exe" : "node");
const appDir = path.join(resources, "app");

const port = await new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
const data = fs.mkdtempSync(path.join(os.tmpdir(), "tally-smoke-"));
const token = randomBytes(16).toString("hex");
const nonce = randomBytes(16).toString("hex");

const child = spawn(nodeBin, [path.join(appDir, "desktop-run.cjs")], {
  cwd: appDir,
  // stdin stays open: the server exits when it closes (see desktop-run.cjs).
  stdio: ["pipe", "inherit", "inherit"],
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TALLY_MODE: "desktop",
    AUTH_SECRET: randomBytes(32).toString("hex"),
    PORT: String(port),
    LAUNCH_TOKEN: token,
    HEALTH_NONCE: nonce,
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_PATH: path.join(data, "tally.db"),
    USERS_DB_DIR: path.join(data, "users"),
    SYSTEM_DB_PATH: path.join(data, "system.db"),
    BACKUP_DIR: path.join(data, "backups"),
  },
});
let exited = null;
child.on("exit", (code) => (exited = code ?? "signal"));

let finished = false;
function done(ok, message) {
  if (finished) return;
  finished = true;
  console.log(`${ok ? "smoke ok" : "SMOKE FAILED"}: ${message}`);
  child.kill();
  fs.rmSync(data, { recursive: true, force: true });
  setTimeout(() => process.exit(ok ? 0 : 1), 500);
}

const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  if (finished) break;
  if (exited !== null) {
    done(false, `server exited early (${exited})`);
    break;
  }
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    if (health.nonce !== nonce) {
      done(false, "health answered with the wrong nonce");
      break;
    }
    // The token-for-cookie swap needs the database open, so this goes past "it started".
    const enter = await fetch(`${base}/api/desktop/enter?t=${token}`, { redirect: "manual" });
    if (enter.status !== 303) {
      done(false, `enter returned ${enter.status}, wanted 303`);
      break;
    }
    done(true, `${process.platform}/${process.arch}, node ${process.version} host, server on :${port}`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!finished) done(false, "server did not become healthy in 90s");
