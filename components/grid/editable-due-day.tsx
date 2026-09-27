"use client";

import { useTransition } from "react";
import { CalendarClock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { updateCategoryDueDay } from "@/app/grid/actions";

const NONE = "none";
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function ordinalSuffix(day: number) {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function EditableDueDay({
  categoryId,
  dueDay,
}: {
  categoryId: number;
  dueDay: number | null;
}) {
  const [, startTransition] = useTransition();

  function handleChange(value: string | null) {
    const next = !value || value === NONE ? null : parseInt(value, 10);
    if (next === dueDay) return;
    startTransition(() => updateCategoryDueDay(categoryId, next));
  }

  return (
    <Select value={dueDay !== null ? String(dueDay) : NONE} onValueChange={handleChange}>
      <SelectTrigger
        size="sm"
        className={cn(
          "h-auto w-auto gap-1 rounded-full border-0 bg-transparent px-1.5 py-0.5 text-[0.65rem]",
          dueDay === null
            ? "border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-muted-foreground"
            : "text-muted-foreground hover:bg-accent"
        )}
      >
        <SelectValue>
          {(value: string) =>
            value === NONE ? (
              "+ due day"
            ) : (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3" />
                {`Due ${value}${ordinalSuffix(parseInt(value, 10))}`}
              </span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No due day</SelectItem>
        {DAYS.map((day) => (
          <SelectItem key={day} value={String(day)}>
            {day}
            {ordinalSuffix(day)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
