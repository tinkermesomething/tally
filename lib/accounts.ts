/** The name to show for an account: the user's alias if they set one, else
 * the bank's own label. */
export function accountDisplayName(a: { displayName: string; alias?: string | null }): string {
  return a.alias?.trim() || a.displayName;
}

/** Display names for linked accounts. Two accounts can share a name (e.g.
 * two Revolut pots), so duplicates get their id appended to tell them apart. */
export function accountLabels(
  accounts: { id: number; displayName: string; alias?: string | null }[]
): { id: number; name: string }[] {
  const count = new Map<string, number>();
  for (const a of accounts) {
    const n = accountDisplayName(a);
    count.set(n, (count.get(n) ?? 0) + 1);
  }
  return accounts.map((a) => {
    const n = accountDisplayName(a);
    return { id: a.id, name: (count.get(n) ?? 0) > 1 ? `${n} (#${a.id})` : n };
  });
}
