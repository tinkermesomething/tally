// pdfjs-dist ships types for its main build only. The worker module is handed
// to pdfjs as-is (see lib/pdf-statement.ts), so it needs no typing of its own.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
