"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Note, NoteType, Related } from "../lib/types";
import { TYPES, tint } from "../lib/types";
import { stamp } from "../lib/format";
import Menu from "./Menu";
import IconButton, { I } from "./IconButton";

type Handlers = {
  onToggle: (id: string) => void;
  onJump: (id: string) => void;   // open a related note, wherever it lives in the pages
  onSetType: (id: string, t: NoteType) => void;
  onTag: (tag: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, raw: string) => Promise<void>;
  onRegenerate: (id: string) => Promise<void>;
  onSetTags: (id: string, tags: string[]) => Promise<void>;
  onNotice: (msg: string) => void;
};

type Props = Handlers & {
  notes: Note[];          // the page being shown (server-paginated)
  sel: string | null;
  highlightIds?: string[] | null;
};

export const noteAnchor = (id: string) => `note-${id}`;

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export default function NoteList({ notes, sel, highlightIds, ...h }: Props) {
  const hot = highlightIds ? new Set(highlightIds) : null;

  return (
    <div className="stagger flex flex-col gap-2.5">
      {notes.map((e, i) => (
        <NoteItem key={e.id} note={e} i={i} open={sel === e.id} match={!!hot?.has(e.id)} rel={e.related || []} {...h} />
      ))}
    </div>
  );
}

function NoteItem({ note: e, i, open, match, rel, onToggle, onJump, onSetType, onTag, onDelete, onEdit, onRegenerate, onSetTags, onNotice }:
  Handlers & { note: Note; i: number; open: boolean; match: boolean; rel: Related[] }) {
  const t = TYPES[e.type || "note"] || TYPES.note;
  const title = e.title || e.raw_text.slice(0, 80);
  const tags = e.tags || [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(e.raw_text);
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const editBox = useRef<HTMLTextAreaElement>(null);

  // Collapsed body stays mounted for the height animation; keep it out of tab order.
  useEffect(() => { if (body.current) body.current.inert = !open; }, [open]);
  useEffect(() => { if (!open) setEditing(false); }, [open]);
  useEffect(() => { if (editing) { setDraft(e.raw_text); requestAnimationFrame(() => editBox.current?.focus()); } }, [editing, e.raw_text]);

  const link = () => `${location.origin}/notes#${noteAnchor(e.id)}`;
  const copyLink = async () => onNotice((await copy(link())) ? "Link copied." : "Couldn't copy — your browser blocked clipboard access.");
  const copyText = async () => onNotice((await copy(e.raw_text)) ? "Note text copied." : "Couldn't copy — your browser blocked clipboard access.");
  const copySummary = async () => {
    if (!e.summary || !(await copy(e.summary))) return;
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title, text: e.raw_text, url: link() }); } catch { /* dismissed */ }
    } else copyLink();
  };
  const regenerate = async () => { setRegen(true); try { await onRegenerate(e.id); } finally { setRegen(false); } };
  const saveEdit = async () => {
    const v = draft.trim();
    if (!v || v === e.raw_text) { setEditing(false); return; }
    setSaving(true);
    try { await onEdit(e.id, v); setEditing(false); } finally { setSaving(false); }
  };
  const addTags = (raw: string) => {
    const add = raw.split(",").map(s => s.trim().toLowerCase().replace(/^#/, "")).filter(Boolean);
    const next = Array.from(new Set([...tags, ...add]));
    setTagDraft("");
    if (next.length !== tags.length) onSetTags(e.id, next);
  };

  const pill = (
    <span className="shrink-0 inline-flex items-center gap-2">
      <span className="w-2 h-2 rounded-full" style={{ background: t.hue }} aria-hidden />
      <span className="text-xs font-medium px-2.5 h-6 inline-flex items-center rounded-full" style={{ color: t.hue, background: tint(t.hue) }}>{t.label}</span>
    </span>
  );

  return (
    <article id={noteAnchor(e.id)} style={{ "--i": i } as CSSProperties}
      className={`scroll-anchor rounded-xl border bg-bg transition-[border-color,box-shadow,background-color] duration-200
        ${open ? "border-primary shadow-[0_10px_30px_-14px_rgb(var(--shadow)/.25)]" : "border-line hover:border-line-strong hover:shadow-[0_4px_14px_-8px_rgb(var(--shadow)/.18)]"}
        ${match && !open ? "!border-primary shadow-[0_0_0_3px_var(--primary-100)]" : ""}`}>
      <div className={`flex items-center gap-3 px-4 cursor-pointer select-none ${open ? "pt-3.5" : "h-14"}`} onClick={() => onToggle(e.id)}>
        {pill}
        <h2 className={`min-w-0 flex-1 font-sans text-[15px] font-semibold tracking-normal ${open ? "invisible h-0" : ""}`}>
          <button onClick={ev => { ev.stopPropagation(); onToggle(e.id); }} aria-expanded={open} title={title}
            className="block w-full text-left truncate">
            {title}
          </button>
        </h2>
        {e.created_at && <time className="hidden sm:block text-xs text-muted whitespace-nowrap tabular-nums">{stamp(e.created_at)}</time>}
        <Menu width={190}
          items={[
            { heading: "Change type" },
            ...(Object.keys(TYPES) as NoteType[]).map(k => ({
              label: <><span className="w-2 h-2 rounded-full" style={{ background: TYPES[k].hue }} />{TYPES[k].label}</>,
              active: (e.type || "note") === k, onClick: () => onSetType(e.id, k),
            })),
            "sep",
            { label: <>{I.copy} Copy text</>, onClick: copyText },
            { label: <>{I.link} Copy link</>, onClick: copyLink },
            { label: <>{I.trash} Delete</>, onClick: () => onDelete(e.id), danger: true },
          ]}
          trigger={({ open: mo, toggle }) => <IconButton label="More actions" aria-haspopup="menu" aria-expanded={mo} onClick={toggle}>{I.dots}</IconButton>} />
        <IconButton label={open ? "Collapse" : "Expand"} aria-expanded={open} onClick={ev => { ev.stopPropagation(); onToggle(e.id); }}>
          <span className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}>{I.chevron}</span>
        </IconButton>
      </div>

      <div className="reveal" data-open={open}>
        <div ref={body}>
          <div className="px-4 pb-3">
            <h2 className="font-sans text-[16px] font-semibold tracking-normal leading-snug mt-1.5 mb-3">{title}</h2>
            {e.created_at && <time className="sm:hidden block -mt-2 mb-3 text-xs text-muted tabular-nums">{stamp(e.created_at)}</time>}

            <section className="rounded-lg bg-surface px-3.5 py-2.5">
              <p className="text-[11.5px] font-medium text-muted mb-1">Note content</p>
              {editing ? (
                <div>
                  <textarea ref={editBox} value={draft} onChange={ev => setDraft(ev.target.value)} rows={3}
                    onKeyDown={ev => {
                      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") saveEdit();
                      if (ev.key === "Escape") setEditing(false);
                    }}
                    className="field w-full resize-y text-[14px] leading-relaxed bg-bg border border-line rounded-lg px-2.5 py-2" />
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => setEditing(false)} className="btn btn-ghost h-8 px-3 text-[13px]">Cancel</button>
                    <button onClick={saveEdit} disabled={saving || !draft.trim()} className="btn btn-primary h-8 px-3 text-[13px]">
                      {saving && <span className="spinner" aria-hidden />}{saving ? "Saving" : "Save"}
                    </button>
                  </div>
                </div>
              ) : <p className="text-[14px] text-soft leading-relaxed whitespace-pre-wrap">{e.raw_text}</p>}
            </section>

            {(e.summary || regen) && (
              <section className="mt-2.5 rounded-lg bg-primary-50 px-3.5 py-2.5 flex gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-primary mb-1 flex items-center gap-1.5">{I.sparkle} AI summary</p>
                  <p className={`text-[14px] text-soft leading-relaxed transition-opacity ${regen ? "opacity-50" : ""}`}>{e.summary || "Regenerating…"}</p>
                </div>
                <div className="flex items-start gap-0.5 -mr-1.5">
                  <IconButton label={copied ? "Copied" : "Copy summary"} onClick={copySummary} className={copied ? "!text-primary" : ""}>{copied ? I.check : I.copy}</IconButton>
                  <IconButton label="Regenerate summary" onClick={regenerate} disabled={regen}>
                    <span className={regen ? "animate-spin" : ""}>{I.refresh}</span>
                  </IconButton>
                </div>
              </section>
            )}

            {(!!e.action_items?.length || !!e.people?.length || !!rel.length) && (
              <div className="mt-3 flex flex-col gap-2.5 text-[13.5px]">
                {!!e.action_items?.length && (
                  <ul className="flex flex-col gap-1.5">
                    {e.action_items.map(a => (
                      <li key={a} className="flex items-start gap-2 text-soft">
                        <span className="mt-[4px] w-3.5 h-3.5 rounded-[4px] border-[1.5px] border-line-strong shrink-0" aria-hidden />
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
                {!!e.people?.length && <p className="text-muted"><span className="text-soft font-medium">People</span> {e.people.join(", ")}</p>}
                {!!rel.length && (
                  <div>
                    <p className="text-soft font-medium mb-0.5">Connected to</p>
                    {rel.map(x => (
                      <button key={x.id} onClick={() => onJump(x.id)}
                        className="block w-full text-left py-1 rounded-md hover:bg-surface px-1 -mx-1 transition-colors">
                        <span className="text-primary">{x.title}</span>
                        <span className="text-xs text-faint"> via {x.shared.join(", ")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <footer className="flex items-center gap-2 border-t border-line px-4 py-2">
            <span className="text-muted shrink-0">{I.tag}</span>
            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
              {tags.map(tg => (
                <span key={tg} className="group inline-flex items-center h-6 rounded-md bg-surface border border-line text-xs text-muted">
                  <button onClick={() => onTag(tg)} title="Search this tag" className="pl-2 pr-1 hover:text-primary">#{tg}</button>
                  <button onClick={() => onSetTags(e.id, tags.filter(x => x !== tg))} aria-label={`Remove tag ${tg}`}
                    className="pr-1.5 text-faint hover:text-danger">×</button>
                </span>
              ))}
              <input value={tagDraft} onChange={ev => { const v = ev.target.value; v.endsWith(",") ? addTags(v) : setTagDraft(v); }}
                onKeyDown={ev => {
                  if (ev.key === "Enter" && tagDraft.trim()) { ev.preventDefault(); addTags(tagDraft); }
                  if (ev.key === "Backspace" && !tagDraft && tags.length) onSetTags(e.id, tags.slice(0, -1));
                }}
                onBlur={() => tagDraft.trim() && addTags(tagDraft)}
                aria-label="Add tags" placeholder="Add tags..."
                className="flex-1 min-w-[90px] h-8 bg-transparent text-[13px] outline-none placeholder:text-faint" />
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <IconButton label="Edit note" onClick={() => setEditing(v => !v)} className={editing ? "!text-primary bg-primary-50" : ""}>{I.edit}</IconButton>
              <IconButton label="Copy link" onClick={copyLink}>{I.link}</IconButton>
              <IconButton label="Share" onClick={share}>{I.share}</IconButton>
              <IconButton label="Delete note" tone="danger" onClick={() => onDelete(e.id)}>{I.trash}</IconButton>
            </div>
          </footer>
        </div>
      </div>
    </article>
  );
}
