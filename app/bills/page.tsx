import { Receipt } from "lucide-react";
import { getBills } from "@/lib/db/bills";
import { getCategoryTree } from "@/lib/db/category-tree";
import { AddBillButton } from "@/components/bills/bill-dialog";
import { BillRow } from "@/components/bills/bill-row";
import { withCurrentUser } from "@/lib/db/current-user";

export const dynamic = "force-dynamic";

export default async function BillsPage() {
  return withCurrentUser(async () => {
    const [bills, categoryTree] = await Promise.all([getBills(), getCategoryTree()]);
    const categories = categoryTree.flatMap((c) => [
      { id: c.id, name: c.name },
      ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
    ]);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Bills</h1>
          <AddBillButton categories={categories} />
        </div>

        {bills.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
            <Receipt className="size-6" />
            <p>No recurring bills yet. Add one to get reminders.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {bills.map((bill) => (
              <BillRow key={bill.id} bill={bill} categories={categories} />
            ))}
          </div>
        )}
      </div>
    );
  });
}
