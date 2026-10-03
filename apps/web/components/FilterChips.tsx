"use client";

import { TYPES, tint, type NoteType } from "../lib/types";
import { TYPE_ICON } from "./IconButton";

type Props = {
  counts: Record<string, number>;
  total: number;
  active: "all" | NoteType;
  onPick: (t: "all" | NoteType) => void;
};

export default function FilterChips({ counts, total, active, onPick }: Props) {
  const kinds = (Object.keys(counts) as NoteType[]).filter(k => counts[k] > 0);
  const base = "chip-lift btn-press shrink-0 inline-flex items-center gap-1.5 text-[13px] font-medium h-8 pl-3 pr-1.5 rounded-full border";
  const badge = "tabular-nums text-[11px] min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center";
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto min-w-0 py-0.5" role="group" aria-label="Filter by type">
      <button onClick={() => onPick("all")} aria-pressed={active === "all"}
        className={`${base} pr-3 ${active === "all" ? "bg-primary-100 border-primary-100 text-primary" : "bg-bg border-line text-soft hover:border-line-strong"}`}>
        All ({total})
      </button>
      {kinds.map(k => {
        const on = active === k;
        const t = TYPES[k];
        return (
          <button key={k} onClick={() => onPick(k)} aria-pressed={on}
            className={`${base} ${on ? "" : "bg-bg border-line text-soft hover:border-line-strong"}`}
            style={on ? { background: tint(t.hue), borderColor: t.hue, color: t.hue } : undefined}>
            <span style={{ color: t.hue }}>{TYPE_ICON[k]}</span>
            {t.label}
            <span className={`${badge} ${on ? "" : "bg-surface text-muted"}`} style={on ? { background: tint(t.hue, 22) } : undefined}>{counts[k]}</span>
          </button>
        );
      })}
    </div>
  );
}
