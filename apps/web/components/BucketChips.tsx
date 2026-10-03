"use client";
// Bucket filter row (counts from /notes/stats) + a small manager to add, rename and delete buckets.
import { useEffect, useRef, useState } from "react";
import { OTHER, bucketTint } from "../lib/buckets";
import IconButton, { I } from "./IconButton";

type Props = {
  names: string[];                       // the user's list, Other last
  counts: Record<string, number>;
  active: string | null;                 // null = all buckets
  onPick: (b: string | null) => void;
  onSave: (names: string[], renames: Record<string, string>) => Promise<void>;
};

export default function BucketChips({ names, counts, active, onPick, onSave }: Props) {
  const shown = names.filter(b => (counts[b] || 0) > 0 || b === active);
  const base = "chip-lift btn-press shrink-0 inline-flex items-center gap-1.5 text-[13px] font-medium h-8 pl-3 pr-1.5 rounded-full border";
  const badge = "tabular-nums text-[11px] min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center bg-surface text-muted";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="no-scrollbar flex gap-2 overflow-x-auto min-w-0 py-0.5" role="group" aria-label="Filter by bucket">
        {shown.map(b => {
          const on = active === b;
          const t = bucketTint(b);
          return (
            <button key={b} onClick={() => onPick(on ? null : b)} aria-pressed={on}
              className={`${base} ${on ? "text-ink" : "bg-bg border-line text-soft hover:border-line-strong"}`}
              style={on ? t : undefined}>
              <span className="w-2.5 h-2.5 rounded-full border" style={t} aria-hidden />
              {b}
              <span className={badge}>{counts[b] || 0}</span>
            </button>
          );
        })}
      </div>
      <BucketManager names={names} onSave={onSave} />
    </div>
  );
}

// Popover editor. Each action saves at once; renames move their notes, deletes send notes to Other.
function BucketManager({ names, onSave }: { names: string[]; onSave: Props["onSave"] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const own = names.filter(b => b !== OTHER);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setEditing(null); setOpen(false); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const clash = (n: string, except?: string) =>
    n.toLowerCase() === OTHER.toLowerCase() || own.some(b => b !== except && b.toLowerCase() === n.toLowerCase());
  const save = async (list: string[], renames: Record<string, string> = {}) => {
    setBusy(true);
    try { await onSave(list, renames); } finally { setBusy(false); }
  };
  const add = async () => {
    const n = draft.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!n || clash(n)) return;
    setDraft("");
    await save([...own, n]);
  };
  const rename = async () => {
    if (!editing) return;
    const to = editing.to.trim().replace(/\s+/g, " ").slice(0, 24);
    setEditing(null);
    if (!to || to === editing.from || clash(to, editing.from)) return;
    await save(own.map(b => (b === editing.from ? to : b)), { [editing.from]: to });
  };
  const remove = (b: string) => save(own.filter(x => x !== b));

  return (
    <div ref={box} className="relative shrink-0">
      <IconButton label="Manage buckets" aria-expanded={open} onClick={() => setOpen(o => !o)}>{I.tag}</IconButton>
      {open && (
        <div data-popover className="anim-enter absolute z-40 right-0 mt-1.5 w-[260px] rounded-xl border border-line bg-bg p-2 shadow-[0_12px_32px_-12px_rgb(var(--shadow)/.3)]">
          <p className="px-1.5 pt-0.5 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Buckets</p>
          <ul className="max-h-[280px] overflow-y-auto flex flex-col gap-0.5" aria-busy={busy}>
            {own.map(b => (
              <li key={b} className="group/b flex items-center gap-2 h-8 px-1.5 rounded-lg hover:bg-surface">
                <span className="w-2.5 h-2.5 rounded-full border shrink-0" style={bucketTint(b)} aria-hidden />
                {editing?.from === b ? (
                  <input autoFocus value={editing.to} maxLength={24} aria-label={`Rename ${b}`}
                    onChange={e => setEditing({ from: b, to: e.target.value })}
                    onKeyDown={e => { if (e.key === "Enter") rename(); }}
                    onBlur={rename}
                    className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-ink border-b border-primary" />
                ) : (
                  <button className="flex-1 min-w-0 text-left text-[13px] text-soft truncate" title="Rename"
                    onClick={() => setEditing({ from: b, to: b })}>{b}</button>
                )}
                <button onClick={() => remove(b)} disabled={busy} aria-label={`Delete ${b}`} title="Delete (its notes move to Other)"
                  className="text-faint hover:text-danger opacity-0 group-hover/b:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100">{I.x}</button>
              </li>
            ))}
            <li className="flex items-center gap-2 h-8 px-1.5 text-[13px] text-faint">
              <span className="w-2.5 h-2.5 rounded-full border shrink-0" style={bucketTint(OTHER)} aria-hidden />{OTHER}
              <span className="ml-auto text-[11px]">always kept</span>
            </li>
          </ul>
          <div className="mt-1.5 pt-1.5 border-t border-line flex items-center gap-1">
            <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={24} placeholder="New bucket"
              onKeyDown={e => { if (e.key === "Enter") add(); }} aria-label="New bucket name"
              className="flex-1 min-w-0 h-8 px-1.5 bg-transparent outline-none text-[13px] placeholder:text-faint" />
            <IconButton label="Add bucket" onClick={add} disabled={busy || !draft.trim() || clash(draft.trim())}>{I.plus}</IconButton>
          </div>
          <p className="px-1.5 pt-1 text-[11px] text-faint leading-snug">AI sorts new notes into these. Renaming keeps notes; deleting moves them to Other.</p>
        </div>
      )}
    </div>
  );
}
