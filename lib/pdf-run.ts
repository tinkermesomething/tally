import path from "node:path";
import { Worker } from "node:worker_threads";
import type { PdfItem } from "./pdf-statement";

/** Opens a PDF in a separate thread, with a time limit and a memory limit.
 * The PDF is untrusted input and the reader is a big parser: on a shared
 * server one bad file must not be able to stall everyone, so it runs where
 * it can be stopped. Files are read one at a time. */

export const PDF_TIME_LIMIT_MS = 30_000;
export const PDF_MEMORY_LIMIT_MB = 384;
export const MAX_PDF_PAGES = 200;

export type PdfItemsResult = { ok: true; pages: PdfItem[][] } | { ok: false; error: string };

type FromWorker = { ok: true; pages: PdfItem[][] } | { ok: false; reason: "pages" | "password" | "damaged"; pages?: number };

/** The worker is a plain file shipped next to the server (workers/pdf-worker.mjs;
 * next.config.ts adds it to the standalone output). A bundler can't be asked to
 * start it: it would rewrite the path into something Node can't open. The
 * standalone server always runs from its own folder, and so do dev and tests
 * from the project's. */
function workerFile(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), "workers", "pdf-worker.mjs");
}

function openInThread(bytes: Uint8Array, timeoutMs: number): Promise<PdfItemsResult> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      // A copy: the thread owns what it is given, and the caller keeps its bytes.
      worker = new Worker(workerFile(), {
        workerData: { bytes: new Uint8Array(bytes), maxPages: MAX_PDF_PAGES },
        resourceLimits: { maxOldGenerationSizeMb: PDF_MEMORY_LIMIT_MB },
      });
    } catch {
      return resolve({ ok: false, error: "Tally can't read PDFs on this computer." });
    }
    let done = false;
    const finish = (r: PdfItemsResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: `Reading this PDF took more than ${timeoutMs / 1000} seconds, so Tally stopped. It may be damaged or not a bank statement.` }),
      timeoutMs,
    );
    worker.once("message", (m: FromWorker) => {
      if (m.ok) return finish(m);
      if (m.reason === "password") return finish({ ok: false, error: "This PDF is locked with a password. Save an unlocked copy from your bank and use that." });
      if (m.reason === "pages") return finish({ ok: false, error: `This PDF has more than ${MAX_PDF_PAGES} pages. Download a shorter period from your bank.` });
      finish({ ok: false, error: "Tally can't open this PDF. It may be damaged." });
    });
    worker.once("error", (err: NodeJS.ErrnoException) =>
      finish({
        ok: false,
        error: err.code === "ERR_WORKER_OUT_OF_MEMORY" ? "This PDF needs more memory than Tally allows for one file, so it was stopped. It may be damaged or not a bank statement." : "Tally can't open this PDF. It may be damaged.",
      }),
    );
    worker.once("exit", () => finish({ ok: false, error: "Tally can't open this PDF. It may be damaged." }));
  });
}

// On globalThis because Next can load this file twice (server actions and the
// ingest check are bundled apart); one queue must cover both.
const holder = globalThis as { __tallyPdfQueue?: Promise<unknown> };

export function readPdfItemsIsolated(bytes: Uint8Array, timeoutMs: number = PDF_TIME_LIMIT_MS): Promise<PdfItemsResult> {
  const run = (holder.__tallyPdfQueue ?? Promise.resolve()).then(() => openInThread(bytes, timeoutMs));
  holder.__tallyPdfQueue = run.catch(() => undefined);
  return run;
}
