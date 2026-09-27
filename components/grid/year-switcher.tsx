"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function YearSwitcher({
  year,
  years,
  basePath = "/grid",
  extraParams = {},
}: {
  year: number;
  years: number[];
  /** Lets other pages (e.g. Reports) reuse this same switcher instead of
   * duplicating it - the grid page's own usage is unaffected by the defaults. */
  basePath?: string;
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();

  return (
    <Select
      value={String(year)}
      onValueChange={(value) => {
        if (!value) return;
        const params = new URLSearchParams({ year: value, ...extraParams });
        router.push(`${basePath}?${params.toString()}`);
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
