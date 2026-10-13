"use client";

import Link from "next/link";
import { Receipt, Plus } from "lucide-react";
import { BillDialog } from "@/components/bills/bill-dialog";
import type { BillWithStatus } from "@/lib/db/bills";

/** A category/subcategory with a bill linked gets a small badge pointing
 * to it (editing happens on the Bills page itself, not here) - without
 * one, a "+" opens the same dialog Bills' own "Add bill" uses, prefilled
 * with this category, so turning a due-day category into a properly
 * tracked bill doesn't mean going to Bills and re-finding/retyping it. */
export function CategoryBillLink({
  categoryId,
  categoryName,
  bills,
  categories,
}: {
  categoryId: number;
  categoryName: string;
  bills: BillWithStatus[];
  categories: { id: number; name: string }[];
}) {
  const linked = bills.filter((b) => b.categoryId === categoryId);

  if (linked.length === 0) {
    return (
      <BillDialog
        categories={categories}
        prefill={{ name: categoryName, categoryId }}
        trigger={
          <button
            type="button"
            title="Add a tracked bill for this category"
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        }
      />
    );
  }

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
