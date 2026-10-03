"use client";
// Keep-style background picker: type default, presets, and the user's own saved colors.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NoteType } from "../lib/types";
import { PRESETS, surface } from "../lib/colors";
import { I } from "./IconButton";

type Props = {
  value: string;                       // note.color ("" = type default)
  type?: NoteType;                     // paints the "Default" swatch
  custom: string[];                    // user palette (hex)
  onPick: (color: string) => void;
  onAddCustom: (hex: string) => void;
  onRemoveCustom: (hex: string) => void;
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  align?: "left" | "right";
  up?: boolean;                        // open above the trigger (dialog toolbar sits at the bottom)
};

export default function ColorPalette({ value, type, custom, onPick, onAddCustom, onRemoveCustom, trigger, align = "left", up }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const cur = (value || "").toLowerCase();

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  // Native "change" fires once the user commits a color (React's onChange fires while dragging).
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const commit = () => { const hex = el.value.toLowerCase(); onAddCustom(hex); onPick(hex); };
    el.addEventListener("change", commit);
    return () => el.removeEventListener("change", commit);
  }, [open, onAddCustom, onPick]);

  const swatch = (key: string, label: string, color: string, extra?: ReactNode) => {
    const on = cur === key;
    const s = surface(color, type);
    return (
      <span key={key || "default"} className="group/sw relative">
        <button type="button" onClick={() => onPick(key)} aria-label={label} title={label} aria-pressed={on}
          className={`w-8 h-8 rounded-full border-2 grid place-items-center transition-transform hover:scale-110 ${on ? "!border-primary" : ""}`}
          style={{ background: s.background, borderColor: s.borderColor }}>
          {on ? <span className="text-primary">{I.check}</span> : key === "" ? <span className="text-muted">{I.noColor}</span> : null}
        </button>
        {extra}
      </span>
    );
  };

  return (
    <div ref={box} className="relative" onClick={e => e.stopPropagation()}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <div role="dialog" aria-label="Background color" data-popover
          className={`anim-enter absolute z-50 ${up ? "bottom-full mb-2" : "top-full mt-2"} ${align === "right" ? "right-0" : "left-0"} w-[264px] rounded-xl border border-line bg-bg p-3 shadow-[0_16px_40px_-14px_rgb(var(--shadow)/.35)]`}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-faint mb-2">Colors</p>
          <div className="grid grid-cols-6 gap-2">
            {swatch("", "Default (type color)", "")}
            {PRESETS.map(p => swatch(p.key, p.label, p.key))}
          </div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-faint mt-3 mb-2">Your colors</p>
          <div className="grid grid-cols-6 gap-2">
            {custom.map(hex => swatch(hex, hex, hex,
              <button type="button" onClick={() => onRemoveCustom(hex)} aria-label={`Remove ${hex} from your colors`}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-bg border border-line text-[10px] leading-none text-muted hover:text-danger opacity-0 group-hover/sw:opacity-100 focus:opacity-100 transition-opacity">×</button>,
            ))}
            <label title="Add a color" className="relative w-8 h-8 rounded-full border-2 border-dashed border-line-strong grid place-items-center text-muted hover:text-primary hover:border-primary cursor-pointer transition-colors">
              {I.plus}
              <input ref={picker} type="color" aria-label="Add a color" className="sr-only" defaultValue="#a8d5ba" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
