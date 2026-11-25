// Runs in its own thread (see lib/pdf-run.ts). Opens a PDF and hands back the
// pieces of text with their positions - nothing else. A broken or hostile PDF
// can spin or eat memory here, and the thread is simply stopped.
import { parentPort, workerData } from "node:worker_threads";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// pdfjs looks for a canvas add-on we don't ship (it draws pages; we only read
// text) and complains about it, through console.log and console.warn. Drop
// only those complaints.
const quiet = (original) => (...args) => {
  if (/polyfill|napi-rs\/canvas/i.test(String(args[0]))) return;
  original(...args);
};
console.log = quiet(console.log);
console.warn = quiet(console.warn);

// Handed over directly so the worker module needs no computed path.
globalThis.pdfjsWorker = pdfjsWorker;

const { bytes, maxPages } = workerData;
try {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  if (doc.numPages > maxPages) {
    parentPort.postMessage({ ok: false, reason: "pages", pages: doc.numPages });
  } else {
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      const items = [];
      for (const it of content.items) {
        if ("str" in it) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height });
      }
      pages.push(items);
    }
    parentPort.postMessage({ ok: true, pages });
  }
} catch (err) {
  parentPort.postMessage({ ok: false, reason: err?.name === "PasswordException" ? "password" : "damaged" });
}
