"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/** Full-width mode for the Grid page and the Reports trend. The choice is kept in a cookie (not
 * localStorage) so the server renders the right width on the first paint -
 * no jump from narrow to wide after load. */
export const WIDE_COOKIE = "tally-grid-wide";

const PageWidthContext = createContext<{ wide: boolean; setWide: (next: boolean) => void }>({
  wide: false,
  setWide: () => {},
});

export function PageContainer({ initialWide, children }: { initialWide: boolean; children: React.ReactNode }) {
  const [wide, setWideState] = useState(initialWide);
  const pathname = usePathname();
  const view = useSearchParams().get("view");

  const setWide = useCallback((next: boolean) => {
    setWideState(next);
    try {
      document.cookie = `${WIDE_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // cookies blocked: the toggle still works for this visit
    }
  }, []);

  // Only the Grid and the Reports trend have a full-width mode; every other
  // page keeps the readable width.
  const expanded = wide && (pathname.startsWith("/grid") || (pathname.startsWith("/reports") && view === "trend"));
  return (
    <PageWidthContext.Provider value={{ wide, setWide }}>
      <main className={cn("mx-auto px-4 py-6", expanded ? "max-w-none" : "max-w-6xl")}>{children}</main>
    </PageWidthContext.Provider>
  );
}

export const usePageWidth = () => useContext(PageWidthContext);
