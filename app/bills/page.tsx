import { Receipt } from "lucide-react";
import { getBills } from "@/lib/db/bills";
import { getCategoryTree } from "@/lib/db/category-tree";
import { AddBillButton } from "@/components/bills/bill-dialog";
import { BillRow } from "@/components/bills/bill-row";
import { BillsTimeline } from "@/components/bills/bills-timeline";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BILLS_LOOKAHEAD_DAYS } from "@/lib/bills-math";
import { withCurrentUser } from "@/lib/db/current-user";

export const dynamic = "force-dynamic";

export default async function BillsPage() {
  return withCurrentUser(async () => {
    const [bills, categoryTree] = await Promise.all([getBills(), getCategoryTree()]);
    const categories = categoryTree.flatMap((c) => [
      { id: c.id, name: c.name },
      ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
    ]);
    const lookaheadWeeks = Math.round(BILLS_LOOKAHEAD_DAYS / 7);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Bills</h1>
            <p className="text-sm text-muted-foreground">
              A category with a due day shows up automatically once it has a budgeted amount for that month - no need to
              add it by hand. Covers the next {lookaheadWeeks} weeks; it reappears for the month after once this one&apos;s paid.
            </p>
          </div>
          <AddBillButton categories={categories} />
        </div>

        {bills.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
            <Receipt className="size-6" />
            <p>Nothing due in the next {lookaheadWeeks} weeks. Add a bill, or set a due day on a category in Settings.</p>
          </div>
        ) : (
          <Tabs defaultValue="list">
            <TabsList>
              <TabsTrigger value="list">List</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>
            <TabsContent value="list" className="space-y-2 pt-4">
              {bills.map((bill) => (
                <BillRow key={bill.id} bill={bill} categories={categories} />
              ))}
            </TabsContent>
            <TabsContent value="timeline" className="pt-4">
              <BillsTimeline bills={bills} categories={categories} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    );
  });
}
