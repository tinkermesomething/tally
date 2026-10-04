/** Small typo-tolerant matcher for the Review and Entries filters. Pure, no
 * dependency. Every word you type must match somewhere in the row's texts,
 * in any order. A word scores higher the closer it is to the text:
 * exact word > word prefix > substring > one or two typos > letters in
 * order ("amzn" finds "amazon"). 0 means no match. */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(^|\s)\.+|\.+(\s|$)/g, " ") // stray dots, not decimals
    .trim();

/** Edit distance with transpositions, bailing out once it exceeds `max`. */
function withinDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return false;
    prev2.length = 0;
    prev2.push(...prev);
    prev = cur;
  }
  return prev[b.length] <= max;
}

function isSubsequence(token: string, word: string): boolean {
  let i = 0;
  for (const ch of word) if (ch === token[i]) i++;
  return i === token.length;
}

function tokenScore(token: string, hay: string, words: string[]): number {
  if (words.includes(token)) return 6;
  if (words.some((w) => w.startsWith(token))) return 5;
  if (hay.includes(token)) return 3;
  if (token.length >= 4) {
    const max = token.length >= 7 ? 2 : 1;
    if (words.some((w) => withinDistance(token, w.slice(0, token.length + max), max) || withinDistance(token, w, max))) return 2;
  }
  if (token.length >= 3 && words.some((w) => isSubsequence(token, w))) return 1;
  return 0;
}

/** Score of `query` against a row's texts. Empty query matches everything
 * (score 1); otherwise 0 when any word of the query finds nothing. */
export function fuzzyScore(query: string, texts: (string | null | undefined)[]): number {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return 1;
  const hay = norm(texts.filter(Boolean).join(" "));
  const words = hay.split(" ").filter(Boolean);
  let total = 0;
  for (const t of tokens) {
    const s = tokenScore(t, hay, words);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

/** The searchable text for an amount: "60.75" matches 6075 pence. */
export const amountText = (pence: number) => (Math.abs(pence) / 100).toFixed(2);

/** Keeps the items whose `texts` match `query`, in their ORIGINAL order -
 * for lists where order carries meaning (rules are first-match-wins, so
 * ranking by score would hide the order they actually run in). An empty
 * query keeps everything. */
export function filterByFuzzy<T>(items: T[], query: string, textsOf: (item: T) => (string | null | undefined)[]): T[] {
  if (!query.trim()) return items;
  return items.filter((item) => fuzzyScore(query, textsOf(item)) > 0);
}
