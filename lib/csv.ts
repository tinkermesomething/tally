/** A small, dependency-free CSV reader: quoted fields, "" escapes, commas,
 * semicolons, tabs or pipes, CRLF or LF, a leading BOM, blank lines. Pure,
 * so the exact same code runs in the browser (the mapping screen) and in
 * tests. */

export type Delimiter = "," | ";" | "\t" | "|";
export const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ",", label: "Comma ( , )" },
  { value: ";", label: "Semicolon ( ; )" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe ( | )" },
];

/** Picks the delimiter that splits the first lines into the most consistent
 * number of columns (outside quotes). Falls back to a comma. */
export function detectDelimiter(text: string): Delimiter {
  const lines = stripBom(text).split(/\r\n|\n|\r/).filter((l) => l.trim() !== "").slice(0, 10);
  let best: Delimiter = ",";
  let bestScore = 0;
  for (const d of DELIMITERS.map((x) => x.value)) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    // consistent across lines is worth far more than merely frequent
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 1000 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let inQuotes = false;
  let n = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === d && !inQuotes) n++;
  }
  return n;
}

const stripBom = (t: string) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

/** Parses the whole text into rows of cells (trimmed of surrounding spaces,
 * not of inner ones). Completely blank lines are dropped. */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const endCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else cell += ch;
    i++;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}
