import { BillRow } from "@/components/bills/bill-row";
import type { BillWithStatus } from "@/lib/db/bills";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** One heading per actual due date, not a week bucket - overdue bills all
 * sit together (the point is "deal with these now", not which exact day
 * each one slipped), then "Today"/"Tomorrow" where that's the clearer
 * label, then the weekday + date for everything else. Replaces the
 * earlier List/Timeline toggle - there was never a second way to look at
 * this data worth having, the rows are always the same, forward-looking
 * list either way. */
function dateLabel(nextDueDate: string, daysUntilDue: number): string {
  if (daysUntilDue < 0) return "Overdue";
  if (daysUntilDue === 0) return "Today";
  if (daysUntilDue === 1) return "Tomorrow";
  const [y, m, d] = nextDueDate.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${weekday} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

export function BillsAgenda({ bills, categories }: { bills: BillWithStatus[]; categories: { id: number; name: string }[] }) {
  const groups = new Map<string, BillWithStatus[]>();
  for (const bill of bills) {
    const key = dateLabel(bill.nextDueDate, bill.daysUntilDue);
    const list = groups.get(key);
    if (list) list.push(bill);
    else groups.set(key, [bill]);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([label, group]) => (
        <div key={label} className="space-y-2">
          <h2 className={label === "Overdue" ? "text-sm font-medium text-status-critical" : "text-sm font-medium text-muted-foreground"}>
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
