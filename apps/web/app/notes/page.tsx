"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Note } from "../../lib/types";
import { buildGraph } from "../../lib/graph";

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"stream" | "map">("stream");

  useEffect(() => { api("/notes").then(r => setNotes(Array.isArray(r) ? r : [])).catch(() => {}).finally(() => setLoading(false)); }, []);
  const graph = useMemo(() => buildGraph(notes), [notes]);

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api("/notes", { method: "POST", body: JSON.stringify({ raw_text: text }) });
      setText("");
      setNotes(await api("/notes"));
    } finally { setBusy(false); }
  };

  return (
    <main className="bg-paper min-h-screen">
      <div className="max-w-[1060px] mx-auto px-5 py-7">
        <header className="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <h1 className="font-serif text-3xl">Everything you said</h1>
            <p className="text-[13px] text-muted mt-1">{notes.length} notes · {graph.links.length} connections</p>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-[320px_1fr]">
          <div className="md:sticky md:top-5 self-start">
            <div className="rounded bg-card border border-line p-4 mb-4">
              <textarea rows={5} value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save(); }}
                placeholder="Type the thought… (⌘+Enter to save)"
                className="w-full bg-transparent resize-y font-sans text-[15px] leading-relaxed outline-none placeholder:text-faint" />
              <div className="flex gap-2 mt-3">
                <button onClick={save} disabled={busy || !text.trim()}
                  className="btn-press flex-1 rounded text-[13px] font-medium px-4 py-2 bg-ink text-card disabled:opacity-40">
                  {busy ? "Filing…" : "Save"}
                </button>
              </div>
            </div>
          </div>

          <div>
            <div className="flex gap-2 mb-3">
              <div className="flex bg-[#E5E1D6] rounded p-0.5">
                {(["stream", "map"] as const).map(v => (
                  <button key={v} onClick={() => setView(v)}
                    className={`px-4 py-1.5 rounded-sm text-[13px] font-medium capitalize ${view === v ? "bg-card text-ink" : "text-muted"}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {view === "map" ? (
              <div className="rounded bg-card border border-line p-7 text-center">
                <h2 className="font-serif text-xl">Map arrives in F4</h2>
                <p className="text-sm text-muted mt-2">The force-directed graph plugs into this toggle once the entry cards land.</p>
              </div>
            ) : loading ? (
              <div className="flex flex-col gap-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-24 rounded" />)}</div>
            ) : notes.length === 0 ? (
              <div className="rounded bg-card border border-line p-7 text-center">
                <h2 className="font-serif text-xl">Nothing filed yet</h2>
                <p className="text-sm text-muted mt-2">Type a thought and save it. Search, voice, and map arrive in later phases.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {notes.map(n => (
                  <article key={n.id} className="anim-enter rounded bg-card border border-line p-4">
                    <h2 className="font-serif text-lg leading-snug">{n.title || n.raw_text.slice(0, 60)}</h2>
                    {n.summary && <p className="text-sm text-soft mt-1">{n.summary}</p>}
                    {!!n.tags?.length && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {n.tags.map(t => <span key={t} className="chip-lift text-xs text-muted">#{t}</span>)}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
