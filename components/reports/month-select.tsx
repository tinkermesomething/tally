"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const LABELS: Record<string, string> = {
  all: "Full year",
  ...Object.fromEntries(MONTHS.map((m, i) => [String(i + 1), m])),
};

export function MonthSelect({
  year,
  month,
}: {
  year: number;
  month: string; // "all" | "1".."12"
}) {
  const router = useRouter();

  return (
    <Select
      value={month}
      onValueChange={(value) => {
        if (!value) return;
        router.push(`/reports?year=${year}&month=${value}`);
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
