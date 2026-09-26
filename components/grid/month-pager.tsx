"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function MonthPager({ year, month }: { year: number; month: number }) {
  const router = useRouter();

  function go(nextYear: number, nextMonth: number) {
    router.push(`/grid?year=${nextYear}&month=${nextMonth}`);
  }

  function prev() {
    if (month === 1) go(year - 1, 12);
    else go(year, month - 1);
  }

  function next() {
    if (month === 12) go(year + 1, 1);
    else go(year, month + 1);
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-full bg-muted px-1.5 py-1">
      <Button size="icon-sm" variant="ghost" onClick={prev} aria-label="Previous month">
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-[7.5rem] text-center text-sm font-medium tabular-nums">
        {MONTH_NAMES[month - 1]} {year}
      </span>
      <Button size="icon-sm" variant="ghost" onClick={next} aria-label="Next month">
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
