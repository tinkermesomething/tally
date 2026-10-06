"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ACCENT_VARS, DEFAULT_ACCENT, accentApply, parseAccent, type AccentApply } from "@/lib/accent";

const STORAGE_KEY = "tally-accent";
// What was last applied, precomputed: the no-flash script below only has to
// copy it onto the page - no colour logic is duplicated outside the app code.
const APPLIED_KEY = "tally-accent-applied";

/** Writes an accent onto <html>: the attribute, the variables, and the two
 * flags the CSS reads for gradient and animated accent surfaces. Clears
 * anything a previous accent left behind. */
export function applyAccentToDocument(applied: AccentApply) {
  const root = document.documentElement;
  root.setAttribute("data-accent", applied.attr);
  for (const v of ACCENT_VARS) root.style.removeProperty(v);
  for (const [k, val] of Object.entries(applied.vars)) root.style.setProperty(k, val);
  if (applied.gradient) root.setAttribute("data-accent-gradient", "");
  else root.removeAttribute("data-accent-gradient");
  if (applied.animated) root.setAttribute("data-accent-anim", "flow");
  else root.removeAttribute("data-accent-anim");
}

// Keeps the accent applied before first paint (no flash of the default
// colour), mirroring next-themes' own no-flash approach for `.dark`.
export function AccentNoFlashScript() {
  const script = `(function(){try{var d=document.documentElement;var j=localStorage.getItem(${JSON.stringify(
    APPLIED_KEY
  )});var a=j?JSON.parse(j):null;if(!a||!a.attr){var p=localStorage.getItem(${JSON.stringify(
    STORAGE_KEY
  )});a={attr:p||${JSON.stringify(DEFAULT_ACCENT)},vars:{},gradient:false,animated:false};}d.setAttribute("data-accent",a.attr);for(var k in a.vars){d.style.setProperty(k,a.vars[k]);}if(a.gradient){d.setAttribute("data-accent-gradient","");}if(a.animated){d.setAttribute("data-accent-anim","flow");}}catch(e){document.documentElement.setAttribute("data-accent",${JSON.stringify(
    DEFAULT_ACCENT
  )});}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

type AccentContextValue = {
  /** The stored accent value: a preset id, "solid:#..", "duo:#..,#..", "special:..". */
  accent: string;
  setAccent: (accent: string) => void;
};

const AccentContext = createContext<AccentContextValue | null>(null);

export function AccentProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccentState] = useState<string>(DEFAULT_ACCENT);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (parseAccent(stored)) setAccentState(stored!);
    } catch {
      // localStorage unavailable (private mode, etc.) - fall back to default
    }
  }, []);

  const setAccent = useCallback((next: string) => {
    if (!parseAccent(next)) return;
    setAccentState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort only
    }
  }, []);

  // The one place that touches the document (and what the no-flash script reads).
  useEffect(() => {
    const spec = parseAccent(accent) ?? parseAccent(DEFAULT_ACCENT)!;
    const applied = accentApply(spec);
    applyAccentToDocument(applied);
    try {
      localStorage.setItem(APPLIED_KEY, JSON.stringify(applied));
    } catch {
      // best-effort only
    }
  }, [accent]);

  return <AccentContext.Provider value={{ accent, setAccent }}>{children}</AccentContext.Provider>;
}

export function useAccent() {
  const ctx = useContext(AccentContext);
  if (!ctx) throw new Error("useAccent must be used within AccentProvider");
  return ctx;
}
