"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MONTH_NAMES as MONTHS } from "@/lib/months";

const LABELS: Record<string, string> = {
  all: "Full year",
  ...Object.fromEntries(MONTHS.map((m, i) => [String(i + 1), m])),
};

export function MonthSelect({
  year,
  month,
  basePath = "/reports",
  extraParams = {},
}: {
  year: number;
  month: string; // "all" | "1".."12"
  basePath?: string;
  /** Other query params to keep when the month changes (e.g. the report view). */
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();

  return (
    <Select
      value={month}
      onValueChange={(value) => {
        if (!value) return;
        router.push(`${basePath}?${new URLSearchParams({ year: String(year), month: value, ...extraParams })}`);
      }}
    >
      <SelectTrigger className="w-44">
        <SelectValue>{(value: string) => LABELS[value] ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Full year</SelectItem>
        {MONTHS.map((label, i) => (
          <SelectItem key={label} value={String(i + 1)}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
