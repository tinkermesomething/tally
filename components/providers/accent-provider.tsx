"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { ACCENTS, DEFAULT_ACCENT, isAccentId, type AccentId } from "@/lib/accent";

const STORAGE_KEY = "tally-accent";

// Keeps `data-accent` in sync with the OS/no-JS default before paint, mirroring
// next-themes' own no-flash approach for the `.dark` class.
export function AccentNoFlashScript() {
  const script = `(function(){try{var a=localStorage.getItem(${JSON.stringify(
    STORAGE_KEY
  )});var valid=${JSON.stringify(ACCENTS.map((a) => a.id))};if(a&&valid.indexOf(a)!==-1){document.documentElement.setAttribute("data-accent",a);}else{document.documentElement.setAttribute("data-accent",${JSON.stringify(
    DEFAULT_ACCENT
  )});}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

type AccentContextValue = {
  accent: AccentId;
  setAccent: (accent: AccentId) => void;
};

const AccentContext = createContext<AccentContextValue | null>(null);

export function AccentProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccentState] = useState<AccentId>(DEFAULT_ACCENT);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isAccentId(stored)) setAccentState(stored);
    } catch {
      // localStorage unavailable (private mode, etc.) - fall back to default
    }
  }, []);

  const setAccent = useCallback((next: AccentId) => {
    setAccentState(next);
    document.documentElement.setAttribute("data-accent", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort only
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-accent", accent);
  }, [accent]);

  return (
    <AccentContext.Provider value={{ accent, setAccent }}>
      {children}
    </AccentContext.Provider>
  );
}

export function useAccent() {
  const ctx = useContext(AccentContext);
  if (!ctx) throw new Error("useAccent must be used within AccentProvider");
  return ctx;
}
