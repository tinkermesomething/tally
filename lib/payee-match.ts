/** Is this the same payee, written two ways? A bank's CSV and its PDF word
 * the same shop differently ("LIDL GB EALING" and "Lidl"). Used only to tell
 * that two file lines are the same transaction, and only after the date and
 * amount already agree. Pure. */

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

const isName = (w: string) => w.length >= 4 && !/^\d+$/.test(w);

export function samePayeeText(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return false;
  const joinedX = ` ${x.join(" ")} `;
  const joinedY = ` ${y.join(" ")} `;
  // One reads as a whole-word part of the other: "lidl" in "lidl gb ealing".
  // (The shorter one must hold a real word: "123456" is not "123456 Coffee".)
  if (y.some(isName) && joinedX.includes(` ${y.join(" ")} `)) return true;
  if (x.some(isName) && joinedY.includes(` ${x.join(" ")} `)) return true;
  // Or they open with the same real word: "transport for london (tfl)" and "transport for london tfl travel".
  return isName(x[0]) && x[0] === y[0];
}
