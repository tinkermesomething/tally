"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LOOKAHEAD_WEEK_OPTIONS } from "@/lib/bills-math";

const LABELS: Record<string, string> = Object.fromEntries(LOOKAHEAD_WEEK_OPTIONS.map((w) => [String(w), `${w} weeks ahead`]));

/** "How much in the future to look at" - URL-driven (?weeks=), same
 * pattern as Reports' own MonthSelect, so a reload or a shared link keeps
 * showing the same window. */
export function LookaheadSelect({ weeks }: { weeks: number }) {
  const router = useRouter();
  return (
    <Select
      value={String(weeks)}
      onValueChange={(value) => {
        if (!value) return;
        router.push(`/bills?${new URLSearchParams({ weeks: value })}`);
      }}
    >
      <SelectTrigger className="w-40">
        <SelectValue>{(value: string) => LABELS[value] ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {LOOKAHEAD_WEEK_OPTIONS.map((w) => (
          <SelectItem key={w} value={String(w)}>
            {w} weeks ahead
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
