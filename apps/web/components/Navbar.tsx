"use client";
import { useEffect, useRef, useState } from "react";
import Brand from "./Brand";
import Menu from "./Menu";
import IconButton, { I } from "./IconButton";

type Props = {
  notes: number;
  links: number;
  query: string;
  setQuery: (q: string) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  email: string | null;
  onLogout: () => void;
};

export default function Navbar({ notes, links, query, setQuery, theme, onToggleTheme, email, onLogout }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [mac, setMac] = useState(true);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const search = (
    <div className="relative w-full sm:max-w-[300px] sm:focus-within:max-w-[380px] transition-[max-width] duration-300" style={{ transitionTimingFunction: "var(--ease)" }}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none">{I.search}</span>
      <input ref={input} value={query} onChange={e => setQuery(e.target.value)} aria-label="Search notes"
        onKeyDown={e => { if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); } }}
        placeholder="Search notes..."
        className="field w-full h-10 pl-9 pr-16 text-[13.5px] bg-bg border border-line rounded-xl placeholder:text-faint focus:shadow-[0_6px_20px_-8px_rgb(var(--shadow)/.25)]" />
      {query ? (
        <button onClick={() => setQuery("")} aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-faint hover:text-soft hover:bg-surface">
          {I.x}
        </button>
      ) : (
        <kbd className="kbd absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">{mac ? "⌘" : "Ctrl"} K</kbd>
      )}
    </div>
  );

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md border-b border-line rounded-t-2xl" style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}>
      <div className="px-4 sm:px-6 py-3 flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2.5 min-w-0 sm:flex-1">
          <Brand size={30} />
          <span className="font-display text-[16px] font-semibold tracking-tight truncate">Everything you said</span>
        </div>
        <div className="order-last sm:order-none basis-full sm:basis-auto sm:flex-[1.2] flex justify-center">{search}</div>
        <div className="flex items-center gap-2 ml-auto sm:ml-0 sm:flex-1 justify-end">
          <span className="hidden md:inline text-[12.5px] text-muted tabular-nums whitespace-nowrap mr-1">
            {notes} {notes === 1 ? "note" : "notes"} · {links} {links === 1 ? "connection" : "connections"}
          </span>
          <IconButton label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={onToggleTheme} size={36}>
            {theme === "dark" ? I.sun : I.moon}
          </IconButton>
          <Menu width={220}
            items={[
              ...(email ? [{ heading: email }, "sep" as const] : []),
              { label: "Log out", onClick: onLogout, danger: true },
            ]}
            trigger={({ open, toggle }) => (
              <button onClick={toggle} aria-label="Account" aria-haspopup="menu" aria-expanded={open}
                className="w-9 h-9 rounded-full bg-primary-100 text-primary font-semibold text-[14px] flex items-center justify-center hover:ring-2 hover:ring-primary-100 transition-shadow">
                {email ? email[0].toUpperCase() : I.user}
              </button>
            )} />
        </div>
      </div>
    </header>
  );
}
