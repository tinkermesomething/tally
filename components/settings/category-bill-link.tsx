import Link from "next/link";
import { Receipt } from "lucide-react";
import type { BillWithStatus } from "@/lib/db/bills";

/** Read-only - the reverse of the Bills page's own category picker
 * (components/bills/bill-dialog.tsx). A category/subcategory with a bill
 * linked gets a small badge pointing to it, so managing categories and
 * managing bills aren't two disconnected places you have to remember to
 * check both of. Editing happens on the Bills page itself, not here. */
export function CategoryBillLink({ categoryId, bills }: { categoryId: number; bills: BillWithStatus[] }) {
  const linked = bills.filter((b) => b.categoryId === categoryId);
  if (linked.length === 0) return null;

  return (
    <Link
      href="/bills"
      title={linked.map((b) => b.name).join(", ")}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:border-muted-foreground hover:text-foreground"
    >
      <Receipt className="size-3" />
      {linked.length === 1 ? linked[0].name : `${linked.length} bills`}
    </Link>
  );
}
