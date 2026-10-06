// useTheme: light/dark for the notes page root only — /login never sees data-theme="dark".
import { useEffect, useState } from "react";

// The two themes the notes page root can wear.
export type Theme = "light" | "dark";

// Used by: useNotesPage. Saved choice wins, else the OS preference; toggle persists to localStorage.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("theme"); } catch { /* storage blocked */ }
    setTheme(saved === "dark" || saved === "light" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);
  const toggleTheme = () => setTheme(t => {
    const n = t === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", n); } catch { /* storage blocked */ }
    return n;
  });
  return { theme, toggleTheme };
}
