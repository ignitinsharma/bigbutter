"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Note, NoteType } from "../../lib/types";
import { buildGraph } from "../../lib/graph";
import NoteInput from "../../components/NoteInput";
import NoteList from "../../components/NoteList";
import FilterChips from "../../components/FilterChips";
import Notice from "../../components/Notice";

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false); // wired to SpeechRecognition in F3
  const [view, setView] = useState<"stream" | "map">("stream");
  const [sel, setSel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | NoteType>("all");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api("/notes")
      .then(r => setNotes(Array.isArray(r) ? r : []))
      .catch(() => setNotice("Could not reach the API — showing an empty desk. Start the backend and reload."))
      .finally(() => setLoading(false));
  }, []);
  const graph = useMemo(() => buildGraph(notes), [notes]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    notes.forEach(n => { const t = n.type || "note"; c[t] = (c[t] || 0) + 1; });
    return c;
  }, [notes]);
  const q = query.trim().toLowerCase();
  const visible = notes.filter(n => {
    if (filter !== "all" && (n.type || "note") !== filter) return false;
    if (!q) return true;
    return `${n.title || ""} ${n.summary || ""} ${(n.tags || []).join(" ")} ${n.raw_text}`.toLowerCase().includes(q);
  });

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await api("/notes", { method: "POST", body: JSON.stringify({ raw_text: text }) });
      setText("");
      setNotes(await api("/notes"));
    } catch {
      setNotice("Save failed — is the API running on :8000?");
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

        {notice && <Notice text={notice} onDismiss={() => setNotice("")} />}

        <div className="grid gap-6 md:grid-cols-[320px_1fr]">
          <div className="md:sticky md:top-5 self-start">
            <NoteInput draft={text} setDraft={setText} onSave={save} busy={busy}
              listening={listening} onToggleSpeak={() => setListening(v => !v)} />
            <FilterChips counts={counts} total={notes.length} active={filter}
              onPick={t => setFilter(f => (f === t ? "all" : t))} />
          </div>

          <div>
            <div className="flex gap-2 mb-3 items-center">
              <div className="flex bg-[#E5E1D6] rounded p-0.5">
                {(["stream", "map"] as const).map(v => (
                  <button key={v} onClick={() => setView(v)}
                    className={`px-4 py-1.5 rounded-sm text-[13px] font-medium capitalize ${view === v ? "bg-card text-ink" : "text-muted"}`}>
                    {v}
                  </button>
                ))}
              </div>
              {view === "stream" && (
                <div className="relative flex-1">
                  <input value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="Search everything"
                    className="w-full text-sm bg-card border border-line rounded px-3 py-2 pr-8 placeholder:text-faint" />
                  {query && (
                    <button onClick={() => setQuery("")} aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-faint text-lg leading-none">×</button>
                  )}
                </div>
              )}
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
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted">Nothing matches that.</p>
            ) : (
              <NoteList notes={visible} sel={sel}
                onToggle={id => setSel(s => (s === id ? null : id))}
                onSetType={(id, t: NoteType) => setNotes(ns => ns.map(n => (n.id === id ? { ...n, type: t } : n)))}
                onTag={t => setQuery(t)}
                onDelete={async id => { setSel(null); await api(`/notes/${id}`, { method: "DELETE" }).catch(() => {}); setNotes(await api("/notes").catch(() => notes)); }} />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
