// Fixed order, matches the dataviz skill's validated categorical palette.
// Shared between /grid (category tags) and /reports (pie chart) so a group
// always renders in the same color everywhere.
export const GROUP_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

export const UNGROUPED = "Ungrouped";

/** Assigns each group a stable color slot the first time it's seen, in the
 * given category order - never reassigned later, so a group's color doesn't
 * shift depending on which categories/months happen to be visible.
 *
 * `overrides` (lib/db/groups.ts's getGroupStyles) wins when a group has one -
 * a customized colour set on Settings > Groups always beats the auto-pick,
 * regardless of where that group happens to fall in this particular
 * category order. */
export function buildGroupColorMap(
  categories: { groupName: string | null }[],
  overrides?: Map<string, string>
): Map<string, string> {
  const order: string[] = [];
  for (const c of categories) {
    const group = c.groupName ?? UNGROUPED;
    if (!order.includes(group)) order.push(group);
  }
  return new Map(order.map((group, i) => [group, overrides?.get(group) ?? GROUP_PALETTE[i % GROUP_PALETTE.length]]));
}
