// Stages everything the desktop app ships into src-tauri/resources/:
//   app/   the Next.js standalone server (+ static assets, public, drizzle)
//   node/  an official Node binary for THIS platform
// Run after `npm run build`. Tauri bundles that folder as-is. The server is
// spawned as `node app/desktop-run.cjs` - an untouched standalone tree, so
// the native sqlite binding resolves exactly as it does in the Docker image.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Must match the Node major the native sqlite addon was compiled against
// (npm ci on the same runner) - the standalone build and this binary have
// to agree on the ABI, so bump both together.
const NODE_VERSION = "20.20.2"; // must match the PINNED checksums below

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "src-tauri", "resources");
const cache = path.join(root, ".desktop-cache");

function fail(msg) {
  console.error(`stage-desktop: ${msg}`);
  process.exit(1);
}

const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) fail("no .next/standalone - run `npm run build` first.");

fs.rmSync(out, { recursive: true, force: true });
const app = path.join(out, "app");
// `config/` holds the throwaway database `next build` opened - never ship it.
fs.cpSync(standalone, app, { recursive: true, filter: (src) => path.relative(standalone, src) !== "config" });
fs.cpSync(path.join(root, ".next", "static"), path.join(app, ".next", "static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(app, "public"), { recursive: true });
fs.cpSync(path.join(root, "drizzle"), path.join(app, "drizzle"), { recursive: true });

// The launcher keeps a pipe open to this process's stdin. If the app is
// force-quit (or crashes) the pipe closes and the server exits with it, so
// no orphaned Node process is left holding the database.
fs.writeFileSync(
  path.join(app, "desktop-run.cjs"),
  `process.chdir(__dirname);
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
require("./server.js");
`
);

const platforms = { darwin: "darwin", linux: "linux", win32: "win" };
const arches = { arm64: "arm64", x64: "x64" };
const plat = platforms[process.platform];
const arch = arches[process.arch];
if (!plat || !arch) fail(`unsupported platform ${process.platform}/${process.arch}`);

const ext = plat === "win" ? "zip" : plat === "linux" ? "tar.xz" : "tar.gz";
const base = `node-v${NODE_VERSION}-${plat}-${arch}`;
const archive = path.join(cache, `${base}.${ext}`);
fs.mkdirSync(cache, { recursive: true });

if (!fs.existsSync(archive)) {
  const res = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${base}.${ext}`);
  if (!res.ok) fail(`download failed: ${res.status}`);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
}

// Checksums committed here, so a compromised download host can't vouch for its own
// file. A version bump means replacing this table from that version's
// https://nodejs.org/dist/v<version>/SHASUMS256.txt.
const PINNED = {
  "node-v20.20.2-darwin-arm64.tar.gz": "466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6",
  "node-v20.20.2-darwin-x64.tar.gz": "8be6f5e4bb128c82774f8a0b8d7a1cc1365a7977d9657cece0ca647b3fe04e61",
  "node-v20.20.2-linux-arm64.tar.xz": "73093db209e4e9e09dd7d15a47aeaab1b74833830df03efa5f942a1122c5fa71",
  "node-v20.20.2-linux-x64.tar.xz": "df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d",
  "node-v20.20.2-win-x64.zip": "dc3700fdd57a63eedb8fd7e3c7baaa32e6a740a1b904167ff4204bc68ed8bf77",
};
const expected = PINNED[`${base}.${ext}`];
if (!expected) fail(`no pinned checksum for ${base}.${ext} - add it to PINNED`);
const actual = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
if (actual !== expected) {
  fs.rmSync(archive);
  fail(`checksum mismatch for ${base}.${ext}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tally-node-"));
execFileSync("tar", ["-xf", archive, "-C", tmp]);
const nodeDir = path.join(out, "node");
fs.mkdirSync(nodeDir, { recursive: true });
const exe = plat === "win" ? "node.exe" : "node";
fs.copyFileSync(path.join(tmp, base, plat === "win" ? exe : path.join("bin", exe)), path.join(nodeDir, exe));
fs.chmodSync(path.join(nodeDir, exe), 0o755);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`stage-desktop: staged app + node ${NODE_VERSION} (${plat}-${arch}) into src-tauri/resources`);
