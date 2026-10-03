// Note backgrounds: type default, a named preset, or a user hex — all theme-aware via CSS tokens.
import type { Note, NoteType } from "./types";
import { TYPES } from "./types";

export const PRESETS = [
  { key: "coral", label: "Coral" }, { key: "peach", label: "Peach" }, { key: "sand", label: "Sand" },
  { key: "lemon", label: "Lemon" }, { key: "mint", label: "Mint" }, { key: "sage", label: "Sage" },
  { key: "sky", label: "Sky" }, { key: "mist", label: "Mist" }, { key: "lavender", label: "Lavender" },
  { key: "blush", label: "Blush" },
] as const;

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

// Background + border for a color value; "" falls back to the note type's tint.
export function surface(color: string | undefined, type: NoteType | undefined): { background: string; borderColor: string } {
  const c = (color || "").toLowerCase();
  if (PRESETS.some(p => p.key === c)) return { background: `var(--c-${c}-bg)`, borderColor: `var(--c-${c}-line)` };
  if (isHex(c)) return {
    background: `color-mix(in srgb, ${c} var(--cm-bg), var(--cm-base))`,
    borderColor: `color-mix(in srgb, ${c} var(--cm-line), var(--cm-base))`,
  };
  const t = TYPES[type || "note"] || TYPES.note;
  return { background: t.bg, borderColor: t.line };
}

export const noteSurface = (n: Pick<Note, "color" | "type">) => surface(n.color, n.type);

// Solid dot color for the map: a preset's mid tone, the raw hex, else the type hue.
export function nodeColor(color: string | undefined, type: NoteType | undefined): string {
  const c = (color || "").toLowerCase();
  if (PRESETS.some(p => p.key === c)) return `var(--c-${c}-line)`;
  if (isHex(c)) return c;
  return (TYPES[type || "note"] || TYPES.note).hue;
}
