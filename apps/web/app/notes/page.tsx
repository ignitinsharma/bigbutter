"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import type { Note, NoteType } from "../../lib/types";
import { TYPES } from "../../lib/types";
import { buildGraph, linksOf } from "../../lib/graph";
import { createVoice, supported as srSupported } from "../../lib/voice";
import { createWisprVoice, supported as wisprSupported } from "../../lib/voice-wispr";
import NoteInput from "../../components/NoteInput";
import NoteList from "../../components/NoteList";
import FilterChips from "../../components/FilterChips";
import GraphView from "../../components/GraphView";
import Notice from "../../components/Notice";

export default function Notes() {
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false); // wired to SpeechRecognition in F3
  const [view, setView] = useState<"stream" | "map">("stream");
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | NoteType>("all");
  const [notice, setNotice] = useState("");
  const [remote, setRemote] = useState<Note[] | null>(null); // backend /search rows; null = local filter
  const [summary, setSummary] = useState("");
  const voice = useRef<{ stop: () => void } | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const recBase = useRef("");
  const recChunks = useRef<Blob[]>([]);
  const tier = useRef<null | "wispr" | "whisper" | "browser">(null);

  const stopVoice = () => {
    try { voice.current?.stop(); } catch { /* already stopped */ }
    voice.current = null;
    if (!rec.current) setListening(false);
  };

  // Stop the upload-recorder; commit=true transcribes audio into the (editable) draft.
  const stopRecorder = (commit: boolean) => {
    const mr = rec.current;
    rec.current = null;
    if (!mr) return;
    mr.onstop = () => {
      try { mr.stream.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
      if (!commit) { setListening(false); return; }
      const blob = new Blob(recChunks.current, { type: mr.mimeType || "audio/webm" });
      recChunks.current = [];
      setListening(false);
      if (!blob.size) return;
      const fd = new FormData();
      fd.append("audio", blob, "note.webm");
      api("/voice/transcribe", { method: "POST", body: fd }).then(
        r => {
          if (r?.transcript) {
            const t = r.transcript.trim();
            setText(recBase.current ? `${recBase.current} ${t}`.trim() : t);
            setNotice("Transcript ready — review it and hit Save.");
          } else if (r?.error === "not_configured") setNotice("Voice upload isn't configured (no API key).");
        },
        () => setNotice("Transcribe failed — check connection and try again."),
      );
    };
    try { mr.stop(); } catch { setListening(false); }
  };

  const toggleSpeak = async () => {
    if (listening) { stopVoice(); stopRecorder(true); return; }
    if (!tier.current) {
      try {
        const st = await api("/voice/status");
        tier.current = st?.wispr ? "wispr" : (st?.openai || st?.transcribe === "local") ? "whisper" : "browser";
      } catch { tier.current = "browser"; }
    }
    if (tier.current === "wispr") return startWispr();
    if (tier.current === "whisper") return startUpload();
    return startBrowser();
  };

  const startWispr = async () => {
    if (!wisprSupported()) { tier.current = "browser"; return startBrowser(); }
    setNotice("");
    let tok: { access_token?: string; ws_url?: string };
    try { tok = await api("/voice/token", { method: "POST", body: "{}" }); }
    catch { tier.current = "whisper"; return startUpload(); }
    if (!tok?.access_token) { tier.current = "whisper"; return startUpload(); }
    const v = createWisprVoice({
      token: tok.access_token, wsUrl: tok.ws_url || "",
      base: text,
      onText: setText,
      onError: code => {
        voice.current = null; setListening(false);
        if (code === "not-allowed") setNotice("Microphone blocked. Allow mic access in site settings, then try again.");
        else if (code === "audio-capture") setNotice("No microphone found. Check it's plugged in.");
        else setNotice("Streaming voice hit an error — falling back to typing.");
        tier.current = "browser";
      },
      onEnd: () => { voice.current = null; setListening(false); },
    });
    voice.current = v;
    v.start();
    setListening(true);
  };

  const startUpload = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      tier.current = "browser"; return startBrowser();
    }
    setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recBase.current = text;
      recChunks.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = e => { if (e.data.size) recChunks.current.push(e.data); };
      rec.current = mr;
      mr.start();
      setListening(true);
    } catch {
      setNotice("Microphone blocked. Allow mic access in site settings, then try again.");
    }
  };

  const startBrowser = () => {
    if (!srSupported()) { setNotice("This browser has no speech recognition — try Chrome, or type instead."); return; }
    if (!window.isSecureContext) { setNotice("Dictation is blocked on insecure origins — open this page via localhost or HTTPS."); return; }
    setNotice("");
    const v = createVoice({
      base: text,
      onText: setText,
      onError: code => {
        voice.current = null;
        setListening(false);
        if (code === "not-allowed") setNotice("Microphone blocked. Allow mic access in the browser site settings, then try again.");
        else if (code === "service-not-allowed") setNotice("Dictation is blocked here — use localhost or HTTPS (Chrome disables the mic on insecure origins).");
        else if (code === "audio-capture") setNotice("No microphone found. Check it's plugged in and not used by another app.");
        else if (code === "no-speech") setNotice("Didn't catch that — hit Speak and try again.");
        else if (code === "network") setNotice("Speech service unreachable — check connection, VPN, or ad-blocker. Typing still works.");
        else setNotice(`Microphone stopped (${code}). Check permissions and try again.`);
      },
      onEnd: () => { voice.current = null; setListening(false); },
    });
    voice.current = v;
    v.start();
    setListening(true);
  };

  useEffect(() => {
    api("/notes")
      .then(r => setNotes(Array.isArray(r) ? r : []))
      .catch((e: { status?: number }) => {
        // Stale/forged cookie sailed past the edge check — bounce to login.
        if (e?.status === 401) router.push("/login?next=/notes");
        else setNotice("Could not reach the API — showing an empty desk. Start the backend and reload.");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const graph = useMemo(() => buildGraph(notes), [notes]);
  // B6.2: prefer server /map, fall back to the local graph offline/on error.
  const [serverGraph, setServerGraph] = useState<{ nodes: typeof graph.nodes; links: typeof graph.links } | null>(null);
  useEffect(() => {
    let live = true;
    api("/map").then(
      r => {
        if (!live || !Array.isArray(r?.nodes)) return;
        setServerGraph({
          nodes: r.nodes.map((n: { id: string; title: string; type: NoteType; summary: string; deg: number; r: number }) => ({
            id: n.id, note: { id: n.id, raw_text: "", title: n.title, type: n.type, summary: n.summary }, deg: n.deg, r: n.r,
          })),
          links: Array.isArray(r.edges) ? r.edges : [],
        });
      },
      () => { if (live) setServerGraph(null); },
    );
    return () => { live = false; };
  }, [notes]);
  const gmap = serverGraph ?? graph;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    notes.forEach(n => { const t = n.type || "note"; c[t] = (c[t] || 0) + 1; });
    return c;
  }, [notes]);
  const q = query.trim().toLowerCase();
  const localVisible = notes.filter(n => {
    if (filter !== "all" && (n.type || "note") !== filter) return false;
    if (!q) return true;
    return `${n.title || ""} ${n.summary || ""} ${(n.tags || []).join(" ")} ${n.raw_text}`.toLowerCase().includes(q);
  });
  const visible = (remote ?? localVisible).filter(n => filter === "all" || (n.type || "note") === filter);
  const matched = remote ? remote.map(n => n.id) : null;

  // Backend search when available; 501/no-key falls back to the local filter above.
  useEffect(() => {
    if (!q) { setRemote(null); setSummary(""); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api(`/search?q=${encodeURIComponent(query.trim())}`);
        if (!live || r?.error) return;
        if (live) { setRemote(Array.isArray(r.notes) ? r.notes : []); setSummary(r.summary || ""); }
      } catch { /* offline → local filter */ }
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  const logout = async () => {
    stopVoice(); stopRecorder(false);
    try { await api("/auth/logout", { method: "POST", body: "{}" }); }
    finally { router.push("/login"); }
  };

  const save = async () => {
    if (!text.trim() || busy) return;
    if (rec.current) { stopRecorder(true); return; } // let the transcript land first, save after
    if (listening) stopVoice();
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
            <p className="text-[13px] text-muted mt-1">{notes.length} notes · {gmap.links.length} connections</p>
          </div>
          <button onClick={logout}
            className="btn-press rounded text-[13px] font-medium px-4 py-2 bg-white text-ink border border-line self-start">
            Log out
          </button>
        </header>

        {notice && <Notice text={notice} onDismiss={() => setNotice("")} />}

        <div className="grid gap-6 md:grid-cols-[320px_1fr]">
          <div className="md:sticky md:top-5 self-start">
            <NoteInput draft={text} setDraft={setText} onSave={save} busy={busy}
              listening={listening} onToggleSpeak={toggleSpeak} />
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
              notes.length === 0 ? (
                <div className="rounded bg-card border border-line p-7 text-center">
                  <h2 className="font-serif text-xl">Nothing filed yet</h2>
                  <p className="text-sm text-muted mt-2">Save a note first — the map draws itself from shared tags and people.</p>
                </div>
              ) : (
                <div className="relative">
                  <GraphView
                    nodes={gmap.nodes.map(n => ({ id: n.id, title: n.note.title || n.note.raw_text.slice(0, 24), type: (n.note.type || "note") as NoteType, deg: n.deg, r: n.r }))}
                    links={gmap.links} sel={sel} onSelect={setSel} focusIds={matched}
                    onHover={(id, x, y) => setHover(id ? { id, x, y } : null)} />
                  {(() => {
                    const h = hover && notes.find(n => n.id === hover.id);
                    if (!h) return null;
                    const t = TYPES[h.type || "note"] || TYPES.note;
                    return (
                      <div className="anim-enter absolute z-10 w-60 max-w-[240px] rounded bg-card border border-line p-3 pointer-events-none shadow-lg"
                        style={{ left: Math.min(Math.max(hover.x - 120, 4), 400), top: Math.max(hover.y - 110, 4) }}>
                        <span className="inline-block text-[11px] font-medium px-1.5 py-0.5 rounded mb-1"
                          style={{ color: t.hue, background: t.bg }}>{t.label}</span>
                        <h2 className="font-serif text-[15px] leading-snug">{h.title || h.raw_text.slice(0, 60)}</h2>
                        {h.summary && <p className="text-xs text-soft mt-1 line-clamp-2">{h.summary}</p>}
                      </div>
                    );
                  })()}
                  <p className="text-xs text-muted mt-2">
                    {gmap.nodes.filter(n => n.deg > 0).length} of {gmap.nodes.length} notes connected · {gmap.links.length} links · drag to rearrange, tap to trace
                  </p>
                  {(() => {
                    const s = notes.find(n => n.id === sel);
                    if (!s) return null;
                    const rel = linksOf(s.id, notes);
                    return (
                      <div className="anim-enter rounded bg-card border border-line p-4 mt-3">
                        <h2 className="font-serif text-lg">{s.title || s.raw_text.slice(0, 60)}</h2>
                        {s.summary && <p className="text-sm text-soft mt-1">{s.summary}</p>}
                        {rel.length ? (
                          <div className="mt-2">
                            <p className="text-[13px] text-muted mb-1">Connected to</p>
                            {rel.map(x => (
                              <button key={x.other.id} className="block w-full text-left py-1" onClick={() => setSel(x.other.id)}>
                                <span className="text-[13.5px] text-[#1F5E77]">{x.other.title}</span>
                                <span className="text-xs text-faint"> — via {x.shared.join(", ")}</span>
                              </button>
                            ))}
                          </div>
                        ) : <p className="text-sm text-faint mt-2">Nothing else touches this yet.</p>}
                      </div>
                    );
                  })()}
                </div>
              )
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
              <>
                {summary && (
                  <div className="anim-enter rounded bg-card border border-line p-4 mb-3" style={{ borderLeft: "3px solid var(--accent)" }}>
                    <p className="text-sm text-soft">{summary}</p>
                  </div>
                )}
                <NoteList notes={visible} sel={sel} highlightIds={matched}
                  onToggle={id => setSel(s => (s === id ? null : id))}
                onSetType={async (id, t: NoteType) => {
                  try {
                    await api(`/notes/${id}`, { method: "PUT", body: JSON.stringify({ type: t }) });
                    setNotes(ns => ns.map(n => (n.id === id ? { ...n, type: t } : n)));
                  } catch { setNotice("Couldn't save the type — is the API running?"); }
                }}
                onTag={t => setQuery(t)}
                onDelete={async id => { setSel(null); await api(`/notes/${id}`, { method: "DELETE" }).catch(() => {}); setNotes(await api("/notes").catch(() => notes)); }} />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
