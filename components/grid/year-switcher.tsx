"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function YearSwitcher({ year, years }: { year: number; years: number[] }) {
  const router = useRouter();

  return (
    <Select
      value={String(year)}
      onValueChange={(value) => {
        if (!value) return;
        router.push(`/grid?year=${value}`);
      }}
    >
      <SelectTrigger className="w-28">
        <SelectValue>{(value: string) => value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {years.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {y}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
