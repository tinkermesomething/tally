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
const NODE_VERSION = process.env.DESKTOP_NODE_VERSION ?? "20.20.2";

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

// Verify against nodejs.org's published checksums every time, cached or not.
const sums = await (await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`)).text();
const expected = sums.split("\n").find((l) => l.endsWith(`  ${base}.${ext}`))?.split(/\s+/)[0];
if (!expected) fail(`no checksum listed for ${base}.${ext}`);
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
