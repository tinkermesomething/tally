/** Display names for linked accounts. Two accounts can share a name (e.g.
 * two Revolut pots), so duplicates get their id appended to tell them apart. */
export function accountLabels(accounts: { id: number; displayName: string }[]): { id: number; name: string }[] {
  const count = new Map<string, number>();
  for (const a of accounts) count.set(a.displayName, (count.get(a.displayName) ?? 0) + 1);
  return accounts.map((a) => ({
    id: a.id,
    name: (count.get(a.displayName) ?? 0) > 1 ? `${a.displayName} (#${a.id})` : a.displayName,
  }));
}
