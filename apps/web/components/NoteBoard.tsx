"use client";
// Keep-style masonry board: left-to-right order, each card dropped into the shortest column.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Note, NoteType } from "../lib/types";
import { TYPES } from "../lib/types";
import { noteSurface } from "../lib/colors";
import Menu from "./Menu";
import ColorPalette from "./ColorPalette";
import TypePill from "./TypePill";
import BucketPill from "./BucketPill";
import IconButton, { I, TYPE_ICON } from "./IconButton";

export const noteAnchor = (id: string) => `note-${id}`;

type Props = {
  notes: Note[];
  batch?: number;            // stagger restarts each loaded batch, so card #300 doesn't wait 10s to appear
  sel: string | null;
  highlightIds?: string[] | null;
  refreshing: Set<string>;   // text edited → waiting on re-enrichment
  palette: string[];
  onOpen: (id: string) => void;
  onSetColor: (id: string, color: string) => void;
  onSetType: (id: string, t: NoteType) => void;
  onAddCustom: (hex: string) => void;
  onRemoveCustom: (hex: string) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
};

const GAP = 12;
const colsFor = (w: number) => (w < 560 ? 1 : w < 860 ? 2 : w < 1100 ? 3 : 4);

export default function NoteBoard({ notes, batch = 30, sel, highlightIds, refreshing, ...p }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [cols, setCols] = useState(3);
  const [layout, setLayout] = useState<string[][]>([]);

  // Greedy masonry: walk notes in order, each into the currently shortest column.
  const place = () => {
    const h = Array(cols).fill(0);
    const out: string[][] = Array.from({ length: cols }, () => []);
    notes.forEach(n => {
      const i = h.indexOf(Math.min(...h));
      out[i].push(n.id);
      h[i] += (cards.current.get(n.id)?.offsetHeight ?? 160) + GAP;
    });
    setLayout(prev => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCols(colsFor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // First pass uses estimates; card heights don't depend on which column they land in, so one re-place settles it.
  useLayoutEffect(place, [notes, cols]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); });
    cards.current.forEach(el => ro.observe(el));
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }); // re-bind every render: the card set grows as batches load

  const byId = new Map(notes.map(n => [n.id, n]));
  const order = new Map(notes.map((n, i) => [n.id, i]));
  const hot = highlightIds ? new Set(highlightIds) : null;
  const columns = layout.length === cols ? layout : Array.from({ length: cols }, (_, c) => notes.filter((_, i) => i % cols === c).map(n => n.id));

  return (
    <div ref={host} className="flex items-start" style={{ gap: GAP }}>
      {columns.map((ids, c) => (
        <div key={c} className="stagger flex-1 min-w-0 flex flex-col" style={{ gap: GAP }}>
          {ids.map(id => {
            const n = byId.get(id);
            return n ? (
              <NoteCard key={id} note={n} i={(order.get(id) ?? 0) % batch} sel={sel === id} match={!!hot?.has(id)}
                refreshing={refreshing.has(id)} {...p}
                setRef={el => { if (el) cards.current.set(id, el); else cards.current.delete(id); }} />
            ) : null;
          })}
        </div>
      ))}
    </div>
  );
}

function NoteCard({ note: n, i, sel, match, refreshing, palette, onOpen, onSetColor, onSetType, onAddCustom, onRemoveCustom, onCopy, onDelete, setRef }:
  Omit<Props, "notes" | "batch" | "sel" | "highlightIds" | "refreshing"> & { note: Note; i: number; sel: boolean; match: boolean; refreshing: boolean; setRef: (el: HTMLElement | null) => void }) {
  const title = (n.title || "").trim();
  const body = n.raw_text.trim();
  const tags = n.tags || [];
  const s = noteSurface(n);
  const open = () => onOpen(n.id);

  return (
    <article ref={setRef} id={noteAnchor(n.id)} tabIndex={0} aria-haspopup="dialog" aria-label={title || body.slice(0, 60)}
      onClick={open}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
      style={{ "--i": i, background: s.background, borderColor: s.borderColor } as CSSProperties}
      className={`group on-tint scroll-anchor relative rounded-xl border cursor-pointer outline-none has-[[data-popover]]:z-30 has-[[role=menu]]:z-30
        transition-[box-shadow,transform,background-color] duration-200 hover:shadow-[0_8px_24px_-12px_rgb(var(--shadow)/.35)]
        focus-visible:shadow-[0_0_0_3px_var(--primary-100)]
        ${sel || match ? "shadow-[0_0_0_2px_var(--primary)]" : ""}`}>
      <div className="px-4 pt-3.5 pb-2">
        {title && <h3 className="font-sans text-[15.5px] font-semibold tracking-normal leading-snug text-ink mb-1.5 break-words">{title}</h3>}
        {body && body !== title && (
          <p className="text-[14px] leading-relaxed text-soft whitespace-pre-wrap break-words line-clamp-[10]">{body}</p>
        )}
        {refreshing && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-primary" role="status">
            <span className="animate-pulse">{I.sparkle}</span> {n.enrich_state === "pending" ? "Organizing…" : "Refreshing summary…"}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <TypePill type={n.type} size="sm" />
          {n.enrich_state !== "pending" && <BucketPill bucket={n.bucket} size="sm" />}
          {tags.slice(0, 3).map(t => <span key={t} className="wash text-[11px] text-muted h-5 px-1.5 rounded-md inline-flex items-center">#{t}</span>)}
          {tags.length > 3 && <span className="text-[11px] text-faint">+{tags.length - 3}</span>}
        </div>
      </div>

      {/* Keep-style hover toolbar; always shown on touch screens. */}
      <div className="h-9 px-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 has-[[data-popover]]:opacity-100 has-[[role=menu]]:opacity-100 transition-opacity duration-150"
        onClick={e => e.stopPropagation()}>
        <ColorPalette value={n.color || ""} type={n.type} custom={palette} onPick={c => onSetColor(n.id, c)}
          onAddCustom={onAddCustom} onRemoveCustom={onRemoveCustom}
          trigger={({ open: po, toggle }) => <IconButton label="Background options" size={30} aria-expanded={po} onClick={toggle}>{I.palette}</IconButton>} />
        <IconButton label="Edit note" size={30} onClick={open}>{I.edit}</IconButton>
        <Menu width={190} align="left"
          items={[
            { heading: "Change type" },
            ...(Object.keys(TYPES) as NoteType[]).map(k => ({
              label: <><span style={{ color: TYPES[k].hue }}>{TYPE_ICON[k]}</span>{TYPES[k].label}</>,
              active: (n.type || "note") === k, onClick: () => onSetType(n.id, k),
            })),
            "sep",
            { label: <>{I.copy} Copy text</>, onClick: () => onCopy(n.id) },
            { label: <>{I.trash} Delete</>, onClick: () => onDelete(n.id), danger: true },
          ]}
          trigger={({ open: mo, toggle }) => <IconButton label="More actions" size={30} aria-haspopup="menu" aria-expanded={mo} onClick={toggle}>{I.dots}</IconButton>} />
      </div>
    </article>
  );
}
