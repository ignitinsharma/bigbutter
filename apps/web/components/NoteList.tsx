"use client";

import type { Note, NoteType } from "../lib/types";
import { TYPES } from "../lib/types";
import { linksOf } from "../lib/graph";
import { when } from "../lib/format";

type Props = {
  notes: Note[];
  sel: string | null;
  highlightIds?: string[] | null;
  onToggle: (id: string) => void;
  onSetType: (id: string, t: NoteType) => void;
  onTag: (tag: string) => void;
  onDelete: (id: string) => void;
};

export default function NoteList({ notes, sel, highlightIds, onToggle, onSetType, onTag, onDelete }: Props) {
  const hot = highlightIds ? new Set(highlightIds) : null;
  return (
    <div className="flex flex-col gap-3">
      {notes.map(e => {
        const t = TYPES[e.type || "note"] || TYPES.note;
        const open = sel === e.id;
        const rel = linksOf(e.id, notes);
        return (
          <article key={e.id} className="anim-enter rounded bg-card border border-line p-4"
            style={{ borderLeft: `3px solid ${t.hue}`, ...(hot && hot.has(e.id) ? { boxShadow: "0 0 0 2px var(--accent)" } : null) }}>
            <div className="flex justify-between gap-3 items-baseline">
              <h2 className="font-serif text-lg leading-snug cursor-pointer" onClick={() => onToggle(e.id)}>{e.title || e.raw_text.slice(0, 60)}</h2>
              {e.created_at && <span className="text-xs text-faint whitespace-nowrap">{when(e.created_at)}</span>}
            </div>
            {e.summary && <p className="mt-2 text-sm text-soft">{e.summary}</p>}
            {!!e.action_items?.length && (
              <ul className="mt-2 pl-5 text-[13.5px]" style={{ color: "#5B3A7E" }}>
                {e.action_items.map(a => <li key={a}>{a}</li>)}
              </ul>
            )}
            <div className="flex flex-wrap gap-2 mt-3 items-center">
              <select value={e.type || "note"} onChange={ev => onSetType(e.id, ev.target.value as NoteType)}
                className="text-xs rounded px-1.5 py-1 cursor-pointer border-none"
                style={{ color: t.hue, background: t.bg }}>
                {(Object.keys(TYPES) as NoteType[]).map(k => <option key={k} value={k}>{TYPES[k].label}</option>)}
              </select>
              {(e.tags || []).map(tg => <button key={tg} className="text-xs text-muted" onClick={() => onTag(tg)}>#{tg}</button>)}
              {!!rel.length && (
                <button onClick={() => onToggle(e.id)} className="text-xs px-2 py-0.5 rounded bg-[#E5E1D6] text-[#4A4437]">
                  {rel.length} linked
                </button>
              )}
              <button onClick={() => onToggle(e.id)} className="ml-auto text-xs text-accent">{open ? "Less" : "More"}</button>
            </div>
            {open && (
              <div className="mt-3 pt-3 border-t border-[#E5E1D6] text-[13px] text-muted">
                {!!e.people?.length && <p className="mb-2">People: {e.people.join(", ")}</p>}
                {e.raw_text && <p className="mb-2 italic">{e.raw_text}</p>}
                {rel.length ? (
                  <div className="mt-2">
                    <p className="mb-1">Connected to</p>
                    {rel.map(x => (
                      <button key={x.other.id} className="block w-full text-left py-1 border-b border-paper" onClick={() => onToggle(x.other.id)}>
                        <span className="text-[13.5px] text-[#1F5E77]">{x.other.title}</span>
                        <span className="text-xs text-faint"> — via {x.shared.join(", ")}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-faint mt-2">Nothing else touches this yet.</p>
                )}
                <button onClick={() => onDelete(e.id)} className="text-xs mt-2" style={{ color: "#8C4426" }}>Delete this note</button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
