/** Builds a tiny real PDF (Helvetica text at exact positions) so tests can
 * run the real reader without committing anyone's statement. */
export type Placed = { s: string; x: number; y: number };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/£/g, "\\243");

export function makePdf(pages: Placed[][]): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => (objs.push(body), objs.length);
  const catalog = add("");
  const tree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const items of pages) {
    const stream = items.map((i) => `BT /F1 9 Tf ${i.x} ${i.y} Td (${esc(i.s)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objs[tree - 1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// Helvetica 9pt, close enough to line amounts up under their titles.
export const width = (s: string) => [...s].reduce((n, c) => n + (/[0-9£]/.test(c) ? 5 : /[.,]/.test(c) ? 2.5 : c === "-" ? 3 : 4.5), 0);
export const right = (s: string, edge: number): Placed => ({ s, x: edge - width(s), y: 0 });

export type Line = { date: string; desc: string; type?: string; in?: string; out?: string; bal?: string; wrap?: string };

/** One page laid out like an online-banking PDF. y counts down from the title. */
export function page(lines: Line[], opts: { period?: boolean; balance?: boolean; footer?: string[]; top?: number } = {}): Placed[] {
  const out: Placed[] = [{ s: "Transactions-01", x: 250, y: 760 }];
  if (opts.period !== false) {
    out.push({ s: "From", x: 300, y: 720 }, { s: "To", x: 420, y: 720 }, { s: "30/07/2026", x: 300, y: 705 }, { s: "26/09/2026", x: 420, y: 705 });
    out.push({ s: "Date of creation", x: 300, y: 680 }, { s: "28/09/2026", x: 300, y: 665 });
  }
  let y = opts.top ?? 620;
  out.push({ s: "Date", x: 20, y }, { s: "Description", x: 100, y }, { s: "Type", x: 273, y }, { s: "Paid in", x: 440, y }, { s: "Paid out", x: 520, y });
  if (opts.balance) out.push({ s: "Balance", x: 570 - width("Balance"), y });
  const inEdge = 440 + width("Paid in");
  const outEdge = 520 + width("Paid out");
  for (const l of lines) {
    y -= 30;
    out.push({ s: l.date, x: 20, y }, { s: l.desc, x: 100, y }, { s: l.type ?? "Debit Card Transaction", x: 273, y });
    if (l.in) out.push({ ...right(l.in, inEdge), y });
    if (l.out) out.push({ ...right(l.out, outEdge), y });
    if (l.bal) out.push({ ...right(l.bal, 570), y });
    if (l.wrap) {
      y -= 11;
      out.push({ s: l.wrap, x: 100, y });
    }
  }
  for (const f of opts.footer ?? []) {
    y -= 40;
    out.push({ s: f, x: 20, y });
  }
  return out;
}

