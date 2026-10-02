"use client";

import { useState, useTransition, useRef } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";
import { pencilInPendingExpense } from "@/app/review/actions";

/** Lets the user log a pending-at-the-bank transaction as an expense ahead
 * of it settling, so "left to spend" reflects money the bank's already
 * earmarked. Expense-only - see PencilInButton's caller, which only
 * renders this for money-out preview rows. */
export function PencilInButton({
  amountPence,
  date,
  payeeRaw,
  categories,
}: {
  amountPence: number;
  date: string | null;
  payeeRaw: string;
  categories: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  if (done) {
    return <span className="text-xs text-muted-foreground">Pencilled in</span>;
  }

  function handlePencilIn() {
    if (!categoryId) return;
    startTransition(async () => {
      await pencilInPendingExpense({
        categoryId: parseInt(categoryId, 10),
        amountPence: Math.abs(amountPence),
        entryDate: date,
        note: payeeRaw,
      });
      setDone(true);
      setOpen(false);
    });
  }

  return (
    <>
      <Button ref={anchorRef} size="icon-xs" variant="ghost" title="Pencil in as an expense" onClick={() => setOpen((v) => !v)}>
        <Pencil className="size-3.5" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverPortal>
          <PopoverPositioner anchor={anchorRef} align="end" sideOffset={4}>
            <PopoverPopup>
              <div className="w-56 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Logs this now, before it settles. You&apos;ll get Confirm/Discard once the real transaction syncs in.
                </p>
                <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(value: string) =>
                        value ? (categories.find((c) => String(c.id) === value)?.name ?? value) : "Choose a category"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" className="w-full" onClick={handlePencilIn} disabled={pending || !categoryId}>
                  Pencil in
                </Button>
              </div>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </>
  );
}
