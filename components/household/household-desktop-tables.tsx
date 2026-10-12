"use client";

import { useEffect, useRef, useState } from "react";
import { HouseholdGridTable } from "@/components/household/household-grid-table";
import { HouseholdIncomeTable } from "@/components/household/household-income-table";
import { CATEGORY_COL_WIDTH, MONTH_COL_WIDTH, SUMMARY_COL_WIDTH } from "@/lib/grid-layout";
import type { HouseholdGridRow, HouseholdIncomeGridRow } from "@/lib/db/household";

/** The household budget table and the household income table are two
 * separate horizontally-scrollable regions sharing the same column layout -
 * same pairing DesktopGridTables (components/grid/desktop-grid-tables.tsx)
 * does for the real Grid's expense/income tables, built fresh here since
 * these two render cross-user, text-keyed, read-only rows instead of one
 * user's own editable ones. Keeping their scroll positions in sync (and
 * starting both near the current month instead of always January) makes
 * them read as one scrolling surface instead of two independently-drifting
 * tables. */
export function HouseholdDesktopTables({
  grid,
  incomeGrid,
  year,
  groupColors,
  currentMonthIndex,
}: {
  grid: HouseholdGridRow[];
  incomeGrid: HouseholdIncomeGridRow[];
  year: number;
  groupColors: Map<string, string>;
  currentMonthIndex: number;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const incomeRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  const [monthW, setMonthW] = useState(MONTH_COL_WIDTH);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () =>
      setMonthW(Math.max(MONTH_COL_WIDTH, Math.floor((el.clientWidth - CATEGORY_COL_WIDTH - SUMMARY_COL_WIDTH * 2) / 12)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function mirrorScroll(source: HTMLDivElement) {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    for (const ref of [gridRef, incomeRef]) {
      if (ref.current && ref.current !== source) ref.current.scrollLeft = source.scrollLeft;
    }
    isSyncingRef.current = false;
  }

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    // Same centering as DesktopGridTables' own effect - bring the current
    // month into view instead of always starting scrolled to January,
    // clamped to the valid scroll range (which naturally handles December
    // and January sitting flush against an edge instead of over-centering
    // past it).
    const visibleMonthWidth = el.clientWidth - CATEGORY_COL_WIDTH - SUMMARY_COL_WIDTH * 2;
    const monthCenter = currentMonthIndex * monthW + monthW / 2;
    const target = monthCenter - visibleMonthWidth / 2;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const clamped = Math.max(0, Math.min(target, maxScroll));
    for (const ref of [gridRef, incomeRef]) {
      if (ref.current) ref.current.scrollLeft = clamped;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthW]);

  return (
    <div className="space-y-4">
      <HouseholdGridTable
        rows={grid}
        year={year}
        groupColors={groupColors}
        categoryColWidth={CATEGORY_COL_WIDTH}
        monthColWidth={monthW}
        summaryColWidth={SUMMARY_COL_WIDTH}
        containerRef={gridRef}
        onScroll={mirrorScroll}
      />
      <HouseholdIncomeTable
        rows={incomeGrid}
        year={year}
        categoryColWidth={CATEGORY_COL_WIDTH}
        monthColWidth={monthW}
        summaryColWidth={SUMMARY_COL_WIDTH}
        containerRef={incomeRef}
        onScroll={mirrorScroll}
      />
    </div>
  );
}
