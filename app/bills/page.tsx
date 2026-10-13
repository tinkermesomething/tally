import { Receipt } from "lucide-react";
import { getBills } from "@/lib/db/bills";
import { getCategoryTree } from "@/lib/db/category-tree";
import { AddBillButton } from "@/components/bills/bill-dialog";
import { BillsAgenda } from "@/components/bills/bills-agenda";
import { LookaheadSelect } from "@/components/bills/lookahead-select";
import { InfoTooltip } from "@/components/info-tooltip";
import { LOOKAHEAD_WEEK_OPTIONS } from "@/lib/bills-math";
import { withCurrentUser } from "@/lib/db/current-user";

export const dynamic = "force-dynamic";

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ weeks?: string }> }) {
  return withCurrentUser(async () => {
    const { weeks: weeksParam } = await searchParams;
    const parsedWeeks = weeksParam ? parseInt(weeksParam, 10) : NaN;
    const weeks = (LOOKAHEAD_WEEK_OPTIONS as readonly number[]).includes(parsedWeeks) ? parsedWeeks : 6;

    const [bills, categoryTree] = await Promise.all([getBills(undefined, weeks * 7), getCategoryTree()]);
    const categories = categoryTree.flatMap((c) => [
      { id: c.id, name: c.name },
      ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
    ]);

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Bills</h1>
            <InfoTooltip label="How this page works">
              A category with a due day shows up here automatically - no need to add it by hand. If next month isn&apos;t
              budgeted yet, it carries last month&apos;s amount forward (marked with ~) until it is.
            </InfoTooltip>
          </div>
          <div className="flex items-center gap-2">
            <LookaheadSelect weeks={weeks} />
            <AddBillButton categories={categories} />
          </div>
        </div>

        {bills.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
            <Receipt className="size-6" />
            <p>Nothing due in the next {weeks} weeks. Add a bill, or set a due day on a category in Settings.</p>
          </div>
        ) : (
          <BillsAgenda bills={bills} categories={categories} />
        )}
      </div>
    );
  });
}
