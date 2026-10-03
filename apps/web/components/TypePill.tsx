"use client";
// Type badge: icon + label in the type's own color, tinted to read in both themes.
import { TYPES, tint, type NoteType } from "../lib/types";
import { TYPE_ICON } from "./IconButton";

export default function TypePill({ type, size = "md" }: { type?: NoteType; size?: "sm" | "md" }) {
  const k: NoteType = type && TYPES[type] ? type : "note";
  const t = TYPES[k];
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 font-medium rounded-full ${size === "sm" ? "text-[11px] h-5 px-1.5" : "text-xs h-6 px-2"}`}
      style={{ color: t.hue, background: tint(t.hue) }}>
      {TYPE_ICON[k]}{t.label}
    </span>
  );
}
