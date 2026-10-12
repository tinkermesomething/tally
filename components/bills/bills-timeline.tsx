import { BillRow } from "@/components/bills/bill-row";
import { BILLS_LOOKAHEAD_DAYS } from "@/lib/bills-math";
import type { BillWithStatus } from "@/lib/db/bills";

/** Same rows as the List view, grouped into week buckets instead of one
 * flat column - the due-day lookahead (BILLS_LOOKAHEAD_DAYS) is what makes
 * "when" worth seeing at a glance instead of reading each date off a list.
 * Manually-tracked real bills have no lookahead cap of their own (see
 * getRealBills), so one further than 6 weeks out - a yearly bill, say -
 * still has somewhere to land instead of being dropped. */
function bucketFor(daysUntilDue: number): string {
  if (daysUntilDue < 0) return "Overdue";
  if (daysUntilDue <= 6) return "This week";
  if (daysUntilDue <= 13) return "Next week";
  if (daysUntilDue <= BILLS_LOOKAHEAD_DAYS - 1) return `Week ${Math.floor(daysUntilDue / 7) + 1}`;
  return "Later";
}

export function BillsTimeline({ bills, categories }: { bills: BillWithStatus[]; categories: { id: number; name: string }[] }) {
  const buckets = new Map<string, BillWithStatus[]>();
  for (const bill of bills) {
    const key = bucketFor(bill.daysUntilDue);
    const list = buckets.get(key);
    if (list) list.push(bill);
    else buckets.set(key, [bill]);
  }

  return (
    <div className="space-y-4">
      {[...buckets.entries()].map(([label, group]) => (
        <div key={label} className="space-y-2">
          <h2
            className={
              label === "Overdue" ? "text-sm font-medium text-status-critical" : "text-sm font-medium text-muted-foreground"
            }
          >
            {label}
          </h2>
          <div className="space-y-2">
            {group.map((bill) => (
              <BillRow key={bill.id} bill={bill} categories={categories} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
