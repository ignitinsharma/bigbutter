"use client";
// Keep-style note dialog: read + edit in place, color/type/tags on the toolbar, AI insights below.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Note, NoteType } from "../lib/types";
import { TYPES } from "../lib/types";
import { noteSurface } from "../lib/colors";
import { stamp } from "../lib/format";
import Menu from "./Menu";
import ColorPalette from "./ColorPalette";
import TypePill from "./TypePill";
import BucketPill from "./BucketPill";
import { bucketOf, bucketTint } from "../lib/buckets";
import IconButton, { I, TYPE_ICON } from "./IconButton";

export type NoteEdits = { title?: string; raw_text?: string };

type Props = {
  note: Note;
  palette: string[];
  buckets: string[];         // the user's bucket list (Other last)
  refreshing: boolean;
  onDone: (edits: NoteEdits, next?: string) => void; // close (or hop to a connected note) — page saves edits
  onSetColor: (color: string) => void;
  onSetType: (t: NoteType) => void;
  onSetTags: (tags: string[]) => void;
  onSetBucket: (b: string) => void;
  onRegenerate: () => Promise<void>;
  onDelete: () => void;
  onTag: (tag: string) => void;
  onNotice: (msg: string) => void;
  onAddCustom: (hex: string) => void;
  onRemoveCustom: (hex: string) => void;
};

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export default function NoteDialog({ note: n, palette, buckets, refreshing, onDone, onSetColor, onSetType, onSetTags, onSetBucket, onRegenerate, onDelete, onTag, onNotice, onAddCustom, onRemoveCustom }: Props) {
  const [title, setTitle] = useState(n.title || "");
  const [text, setText] = useState(n.raw_text);
  const [tagDraft, setTagDraft] = useState("");
  const [insights, setInsights] = useState(true);
  const [regen, setRegen] = useState(false);
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const tags = n.tags || [];
  const rel = n.related || [];
  const s = noteSurface(n);

  // Diff against the stored note; empty text is never saved (the note would vanish).
  const edits = (): NoteEdits => {
    const out: NoteEdits = {};
    const t = text.trim();
    if (t && t !== n.raw_text.trim()) out.raw_text = t;
    if (title.trim() !== (n.title || "").trim() && title.trim()) out.title = title.trim();
    return out;
  };
  const done = (next?: string) => onDone(edits(), next);
  const dirty = Object.keys(edits()).length > 0;
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);

  // Lock page scroll, focus the text at its end.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = area.current;
    if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); }
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Auto-grow the textarea to its content.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Shortcuts live on document so they keep working after focus drops to <body>
  // (e.g. a menu item unmounts). Ref keeps the listener on the latest draft.
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const p = panel.current;
      if (!p) return;
      if (e.key === "Escape") {
        if (p.querySelector("[data-popover],[role=menu]")) return; // an open palette/menu closes first
        e.preventDefault(); doneRef.current(); return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); doneRef.current(); return; }
      if (e.key === "Tab") { // focus trap
        const f = Array.from(p.querySelectorAll<HTMLElement>("button:not(:disabled),input,textarea,[tabindex]:not([tabindex='-1'])"))
          .filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        const inside = p.contains(document.activeElement);
        if (!inside) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);


  const copyText = async () => onNotice((await copy(n.raw_text)) ? "Note text copied." : "Couldn't copy — your browser blocked clipboard access.");
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: n.title || "", text: n.raw_text }); } catch { /* dismissed */ } }
    else copyText();
  };
  const copySummary = async () => {
    if (!n.summary || !(await copy(n.summary))) return;
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };
  const regenerate = async () => { setRegen(true); try { await onRegenerate(); } finally { setRegen(false); } };
  const addTags = (raw: string) => {
    const add = raw.split(",").map(x => x.trim().toLowerCase().replace(/^#/, "")).filter(Boolean);
    const next = Array.from(new Set([...tags, ...add]));
    setTagDraft("");
    if (next.length !== tags.length) onSetTags(next);
  };

  const busy = refreshing || regen;
  const hasInsights = !!(n.summary || busy || n.action_items?.length || n.people?.length || rel.length);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-6 anim-fade"
      style={{ background: "rgb(var(--shadow) / .38)", backdropFilter: "blur(2px)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) done(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={n.title || "Note"}
        className="on-tint anim-pop w-full sm:max-w-[640px] max-h-[100dvh] sm:max-h-[86vh] flex flex-col sm:rounded-2xl border shadow-[0_28px_70px_-24px_rgb(var(--shadow)/.55)] transition-colors duration-200"
        style={{ background: s.background, borderColor: s.borderColor }}>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-2">
          <div className="flex items-start gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" aria-label="Title" maxLength={120}
              className="flex-1 min-w-0 bg-transparent outline-none font-display text-[21px] font-semibold tracking-tight text-ink placeholder:text-faint" />
            <div className="pt-1.5 flex items-center gap-1.5">
              {n.enrich_state !== "pending" && (
                <Menu width={180}
                  items={[
                    { heading: "Bucket" },
                    ...buckets.map(b => ({
                      label: <><span className="w-2.5 h-2.5 rounded-full border shrink-0" style={bucketTint(b)} aria-hidden />{b}</>,
                      active: bucketOf(n.bucket) === b, onClick: () => onSetBucket(b),
                    })),
                  ]}
                  trigger={({ open, toggle }) => (
                    <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Bucket: ${bucketOf(n.bucket)}. Change bucket`}
                      title="Change bucket" className="rounded-full hover:opacity-80">
                      <BucketPill bucket={n.bucket} />
                    </button>
                  )} />
              )}
              <TypePill type={n.type} />
            </div>
          </div>
          <textarea ref={area} value={text} onChange={e => setText(e.target.value)} placeholder="Take a note…" aria-label="Note text" rows={3}
            className="mt-2 w-full resize-none overflow-hidden bg-transparent outline-none text-[15px] leading-relaxed text-soft placeholder:text-faint" />

          {/* tags */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {tags.map(tg => (
              <span key={tg} className="wash inline-flex items-center h-6 rounded-md text-xs text-muted">
                <button onClick={() => { done(); onTag(tg); }} title="Search this tag" className="pl-2 pr-1 hover:text-primary">#{tg}</button>
                <button onClick={() => onSetTags(tags.filter(x => x !== tg))} aria-label={`Remove tag ${tg}`} className="pr-1.5 text-faint hover:text-danger">×</button>
              </span>
            ))}
            <input value={tagDraft} onChange={e => { const v = e.target.value; v.endsWith(",") ? addTags(v) : setTagDraft(v); }}
              onKeyDown={e => {
                if (e.key === "Enter" && tagDraft.trim()) { e.preventDefault(); e.stopPropagation(); addTags(tagDraft); }
                if (e.key === "Backspace" && !tagDraft && tags.length) onSetTags(tags.slice(0, -1));
              }}
              onBlur={() => tagDraft.trim() && addTags(tagDraft)}
              aria-label="Add tags" placeholder="+ Add tag"
              className="min-w-[90px] flex-1 h-7 bg-transparent text-[13px] outline-none placeholder:text-faint" />
          </div>

          {hasInsights && (
            <section className="wash mt-4 rounded-xl">
              <button onClick={() => setInsights(v => !v)} aria-expanded={insights}
                className="w-full flex items-center gap-2 px-3.5 h-10 text-[13px] font-semibold text-primary">
                {I.sparkle} AI insights
                {busy && <span className="font-normal text-muted">· refreshing…</span>}
                <span className={`ml-auto text-muted transition-transform duration-200 ${insights ? "rotate-180" : ""}`}>{I.chevron}</span>
              </button>
              <div className="reveal" data-open={insights}>
                <div>
                  <div className="px-3.5 pb-3.5 flex flex-col gap-3 text-[13.5px]">
                    {(n.summary || busy) && (
                      <div className="flex gap-2">
                        <p className={`flex-1 text-soft leading-relaxed transition-opacity ${busy ? "opacity-50" : ""}`}>{n.summary || "Summarizing…"}</p>
                        <div className="flex items-start gap-0.5 -mr-1.5 -mt-1">
                          <IconButton label={copied ? "Copied" : "Copy summary"} onClick={copySummary} className={copied ? "!text-primary" : ""}>{copied ? I.check : I.copy}</IconButton>
                          <IconButton label="Regenerate summary" onClick={regenerate} disabled={busy}>
                            <span className={regen ? "animate-spin" : ""}>{I.refresh}</span>
                          </IconButton>
                        </div>
                      </div>
                    )}
                    {!!n.action_items?.length && (
                      <ul className="flex flex-col gap-1.5">
                        {n.action_items.map(a => (
                          <li key={a} className="flex items-start gap-2 text-soft">
                            <span className="mt-[4px] w-3.5 h-3.5 rounded-[4px] border-[1.5px] border-[color-mix(in_srgb,var(--ink)_35%,transparent)] shrink-0" aria-hidden />{a}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!!n.people?.length && <p className="text-muted"><span className="text-soft font-medium">People</span> {n.people.join(", ")}</p>}
                    {!!rel.length && (
                      <div>
                        <p className="text-soft font-medium mb-0.5">Connected to</p>
                        {rel.map(x => (
                          <button key={x.id} onClick={() => done(x.id)}
                            className="block w-full text-left py-1 px-1.5 -mx-1.5 rounded-md hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] transition-colors">
                            <span className="text-primary">{x.title}</span>
                            <span className="text-xs text-faint"> via {x.shared.join(", ")}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {(!!n.recordings?.length || n.updated_at || n.created_at) && (
            <div className="mt-3 flex items-center justify-end gap-3 text-[12px] text-muted tabular-nums">
              {!!n.recordings?.length && (() => {
                const s = Math.round(n.recordings.reduce((t, r) => t + (r.duration_ms || 0), 0) / 1000);
                const clips = n.recordings.length;
                return (
                  <span className="wash inline-flex items-center gap-1.5 h-6 px-2 rounded-md" title={`${clips} voice clip${clips > 1 ? "s" : ""} saved`}>
                    {I.mic} Voice · {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}{clips > 1 ? ` · ${clips} clips` : ""}
                  </span>
                );
              })()}
              {(n.updated_at || n.created_at) && <span>Edited {stamp((n.updated_at || n.created_at)!)}</span>}
            </div>
          )}
        </div>

        {/* Keep-style toolbar */}
        <div className="shrink-0 flex items-center gap-0.5 px-2.5 py-2 border-t" style={{ borderColor: s.borderColor }}>
          <ColorPalette up value={n.color || ""} type={n.type} custom={palette} onPick={onSetColor}
            onAddCustom={onAddCustom} onRemoveCustom={onRemoveCustom}
            trigger={({ open, toggle }) => <IconButton label="Background options" aria-expanded={open} onClick={toggle}>{I.palette}</IconButton>} />
          <Menu up width={180} align="left"
            items={[
              { heading: "Type" },
              ...(Object.keys(TYPES) as NoteType[]).map(k => ({
                label: <><span style={{ color: TYPES[k].hue }}>{TYPE_ICON[k]}</span>{TYPES[k].label}</>,
                active: (n.type || "note") === k, onClick: () => onSetType(k),
              })),
            ]}
            trigger={({ open, toggle }) => (
              <IconButton label="Change type" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                <span style={{ color: TYPES[n.type || "note"]?.hue }}>{TYPE_ICON[n.type || "note"]}</span>
              </IconButton>
            )} />
          <IconButton label="Share" onClick={share}>{I.share}</IconButton>
          <Menu up width={170} align="left"
            items={[
              { label: <>{I.copy} Copy text</>, onClick: copyText },
              { label: <>{I.trash} Delete note</>, onClick: onDelete, danger: true },
            ]}
            trigger={({ open, toggle }) => <IconButton label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>{I.dots}</IconButton>} />
          {dirty ? (
            <button onClick={() => done()} title={`Save and close (${mac ? "⌘" : "Ctrl"}+Enter)`}
              className="anim-fade btn btn-primary h-9 pl-4 pr-2 text-[14px] ml-auto">
              Save
              <span className="hidden sm:inline-flex items-center h-5 px-1.5 rounded-md bg-white/20 text-[11px] font-medium">{mac ? "⌘" : "Ctrl"} ↵</span>
            </button>
          ) : (
            <button onClick={() => done()} title="Close (Esc)" className="btn h-9 px-4 text-[14px] font-medium text-ink ml-auto">Close</button>
          )}
        </div>
      </div>
    </div>
  );
}
