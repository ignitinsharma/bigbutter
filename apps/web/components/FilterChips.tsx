"use client";

import { TYPES, type NoteType } from "../lib/types";

type Props = {
  counts: Record<string, number>;
  total: number;
  active: "all" | NoteType;
  onPick: (t: "all" | NoteType) => void;
};

export default function FilterChips({ counts, total, active, onPick }: Props) {
  const kinds = (Object.keys(counts) as NoteType[]).filter(k => counts[k] > 0);
  return (
    <div className="flex flex-wrap gap-1.5">
      <button onClick={() => onPick("all")}
        className="chip-lift text-xs font-medium px-2.5 py-1.5 rounded"
        style={active === "all" ? { background: "#241C33", color: "#FAF9F6" } : { background: "#E5E1D6", color: "#241C33" }}>
        All {total}
      </button>
      {kinds.map(k => (
        <button key={k} onClick={() => onPick(k)}
          className="chip-lift text-xs font-medium px-2.5 py-1.5 rounded"
          style={active === k ? { background: TYPES[k].hue, color: "#FAF9F6" } : { background: TYPES[k].bg, color: TYPES[k].hue }}>
          {TYPES[k].label} {counts[k]}
        </button>
      ))}
    </div>
  );
}
