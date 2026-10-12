import Link from "next/link";
import { ArrowLeft, Tags } from "lucide-react";
import { getCategoryTree } from "@/lib/db/queries";
import { getGroupStyles } from "@/lib/db/groups";
import { buildGroupColorMap } from "@/lib/group-colors";
import { GroupRow } from "@/components/settings/group-row";
import { withCurrentUser } from "@/lib/db/current-user";

export const dynamic = "force-dynamic";

/** Groups aren't a stored entity (categories.groupName is free text, same
 * string shared across however many categories use it) - this page is
 * just every distinct name currently in use by a top-level category
 * (groups are a top-level-only concept - see category-settings-row.tsx,
 * subcategories inherit their parent's, there's no EditableGroupTag on a
 * child row), each with its colour (lib/db/groups.ts's stored override,
 * or the same auto-pick /grid and /reports already use) and a rename
 * control. UNGROUPED is the "no group" bucket, not a real group - left
 * out, there's nothing to rename or colour there. */
export default async function GroupsPage() {
  return withCurrentUser(async () => {
    const [categoryTree, groupStyles] = await Promise.all([getCategoryTree(), getGroupStyles()]);
    const colorByGroup = buildGroupColorMap(categoryTree, groupStyles);
    const names = Array.from(new Set(categoryTree.map((c) => c.groupName).filter((g): g is string => !!g))).sort();

    return (
      <div className="space-y-4">
        <div>
          <Link href="/settings?tab=categories" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            Back to Categories
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Groups</h1>
          <p className="text-sm text-muted-foreground">Rename a group, or give it its own colour instead of the automatic one.</p>
        </div>

        {names.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
            <Tags className="size-6" />
            <p>No categories have a group yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {names.map((name) => (
              // colorByGroup is built from this SAME categoryTree, so every
              // name here is guaranteed a real entry - never actually falls
              // through to the fallback, which exists only so this isn't a
              // non-null assertion.
              <GroupRow key={name} name={name} color={colorByGroup.get(name) ?? "var(--chart-1)"} custom={groupStyles.has(name)} />
            ))}
          </div>
        )}
      </div>
    );
  });
}
