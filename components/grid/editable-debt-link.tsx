"use client";

import { useTransition } from "react";
import { UserRound } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { updateCategoryDebtLink } from "@/app/grid/actions";

const NONE = "none";

/** Links a category permanently to a debt person - any expense logged
 * against it auto-creates a ledger repayment, no per-transaction checkbox
 * needed. For categories that only ever mean "pay this one person back". */
export function EditableDebtLink({
  categoryId,
  linkedDebtPersonId,
  people,
}: {
  categoryId: number;
  linkedDebtPersonId: number | null;
  people: { id: number; name: string }[];
}) {
  const [, startTransition] = useTransition();

  function handleChange(value: string | null) {
    const next = !value || value === NONE ? null : parseInt(value, 10);
    if (next === linkedDebtPersonId) return;
    startTransition(() => updateCategoryDebtLink(categoryId, next));
  }

  return (
    <Select value={linkedDebtPersonId !== null ? String(linkedDebtPersonId) : NONE} onValueChange={handleChange}>
      <SelectTrigger
        size="sm"
        className={cn(
          "h-auto w-auto gap-1 rounded-full border-0 bg-transparent px-1.5 py-0.5 text-[0.65rem]",
          linkedDebtPersonId === null
            ? "border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-muted-foreground"
            : "text-muted-foreground hover:bg-accent"
        )}
      >
        <SelectValue>
          {(value: string) =>
            value === NONE ? (
              "+ link to debt person"
            ) : (
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3" />
                {people.find((p) => String(p.id) === value)?.name ?? "Unknown"}
              </span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Not linked to a debt person</SelectItem>
        {people.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
