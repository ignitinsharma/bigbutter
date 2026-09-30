"use client";
// notes page: the whole app — stream list + map, search, voice tiers, pagination.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import type { Note, NoteType, NotesPage, NoteStats } from "../../lib/types";
import { TYPES, tint } from "../../lib/types";
import { buildGraph, subgraph } from "../../lib/graph";
import { createVoice, supported as srSupported } from "../../lib/voice";
import { createWisprVoice, supported as wisprSupported } from "../../lib/voice-wispr";
import NoteInput from "../../components/NoteInput";
import NoteList, { noteAnchor } from "../../components/NoteList";
import FilterChips from "../../components/FilterChips";
import GraphView from "../../components/GraphView";
import Notice from "../../components/Notice";
import Navbar from "../../components/Navbar";
import Pagination from "../../components/Pagination";
import SortMenu, { type Sort } from "../../components/SortMenu";
import { I } from "../../components/IconButton";

const PER_PAGE = 10;
const ts = (n: Note) => (n.created_at ? new Date(n.created_at).getTime() : 0);

export default function Notes() {
  const router = useRouter();
  const [items, setItems] = useState<Note[]>([]); // current server page only
  const [pageInfo, setPageInfo] = useState({ total: 0, pages: 1 });
  const [stats, setStats] = useState<NoteStats>({ total: 0, counts: {}, connections: 0 });
  const [pageLoading, setPageLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const pendingScroll = useRef<string | null>(null);
  const loadedView = useRef("");
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
  const [searching, setSearching] = useState(false); // AI /search in flight for the current query
  const voice = useRef<{ stop: () => void } | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const recBase = useRef("");
  const recChunks = useRef<Blob[]>([]);
  const tier = useRef<null | "wispr" | "whisper" | "browser">(null);
  // Cut: restore the draft to what it was before recording and ignore any late transcript.
  const voiceBase = useRef("");
  const discard = useRef(false);
  const transcribeCtl = useRef<AbortController | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null); // feeds the waveform
  const [page, setPage] = useState(1);
  const listTop = useRef<HTMLDivElement>(null);
  const input = useRef<{ focus: () => void }>(null);
  const [sort, setSort] = useState<Sort>("new");
  const [email, setEmail] = useState<string | null>(null);
  // Theme lives on this page's root only — /login never sees data-theme="dark".
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("theme"); } catch { /* storage blocked */ }
    setTheme(saved === "dark" || saved === "light" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    api("/auth/me").then(r => setEmail(r?.email || null), () => {});
  }, []);
  const toggleTheme = () => setTheme(t => {
    const n = t === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", n); } catch { /* storage blocked */ }
    return n;
  });

  // Stop the live voice engine (Wispr or browser) without touching any recording.
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
    setMicStream(null);
    mr.onstop = () => {
      try { mr.stream.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
      if (!commit || discard.current) { setListening(false); return; }
      const blob = new Blob(recChunks.current, { type: mr.mimeType || "audio/webm" });
      recChunks.current = [];
      setListening(false);
      if (!blob.size) return;
      const fd = new FormData();
      fd.append("audio", blob, "note.webm");
      const ctl = new AbortController();
      transcribeCtl.current = ctl;
      setTranscribing(true);
      api("/voice/transcribe", { method: "POST", body: fd, signal: ctl.signal }).then(
        r => {
          if (ctl.signal.aborted) return;
          if (r?.transcript) {
            const t = r.transcript.trim();
            setText(recBase.current ? `${recBase.current} ${t}`.trim() : t);
            setNotice("Transcript ready — review it and hit Save.");
          } else if (r?.error === "not_configured") setNotice("Voice upload isn't configured (no API key).");
        },
        () => { if (!ctl.signal.aborted) setNotice("Transcribe failed — check connection and try again."); },
      ).finally(() => {
        if (transcribeCtl.current === ctl) { transcribeCtl.current = null; setTranscribing(false); }
      });
    };
    try { mr.stop(); } catch { setListening(false); }
  };

  // Cut: drop the recording (or the pending transcript) and put the draft back as it was.
  const cancelVoice = () => {
    discard.current = true;
    transcribeCtl.current?.abort();
    transcribeCtl.current = null;
    setTranscribing(false);
    stopVoice();
    stopRecorder(false);
    setListening(false);
    setText(voiceBase.current);
  };

  // Pick the best voice tier (Wispr → Whisper upload → browser) and start it.
  const toggleSpeak = async () => {
    if (transcribing) return;
    if (listening) { stopVoice(); stopRecorder(true); return; }
    voiceBase.current = text;
    discard.current = false;
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

  // Tier 1: live Wispr streaming; any failure steps down to upload, then browser.
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
      onText: t => { if (!discard.current) setText(t); },
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

  // Tier 2: record mic audio for one-shot upload transcription (review-before-save).
  const startUpload = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      tier.current = "browser"; return startBrowser();
    }
    setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recBase.current = text;
      recChunks.current = [];
      setMicStream(stream);
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = e => { if (e.data.size) recChunks.current.push(e.data); };
      rec.current = mr;
      mr.start();
      setListening(true);
    } catch {
      setNotice("Microphone blocked. Allow mic access in site settings, then try again.");
    }
  };

  // Tier 3: free browser dictation straight into the draft (no server round-trip).
  const startBrowser = () => {
    if (!srSupported()) { setNotice("This browser has no speech recognition — try Chrome, or type instead."); return; }
    if (!window.isSecureContext) { setNotice("Dictation is blocked on insecure origins — open this page via localhost or HTTPS."); return; }
    setNotice("");
    const v = createVoice({
      base: text,
      onText: t => { if (!discard.current) setText(t); },
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

  // 401 anywhere (stale cookie) → bounce to login, preserving the return path.
  const authFail = (e: { status?: number }) => {
    // Stale/forged cookie sailed past the edge check — bounce to login.
    if (e?.status === 401) { router.push("/login?next=/notes"); return true; }
    return false;
  };

  // Refresh navbar totals + filter counts after any mutation.
  const loadStats = () => api("/notes/stats").then(
    (r: NoteStats) => { if (r && typeof r.total === "number") setStats({ total: r.total, counts: r.counts || {}, connections: r.connections || 0 }); },
    (e: { status?: number }) => { authFail(e); },
  );
  useEffect(() => { loadStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const qRaw = query.trim();
  const q = qRaw.toLowerCase();
  const scoped = !!q; // search mode: results come from /search, not the paged list

  // Server pagination: fetch just the page being viewed. A newer request aborts the older one.
  useEffect(() => {
    if (scoped) return;
    const ctl = new AbortController();
    const viewKey = `${page}|${sort}|${filter}`;
    if (viewKey !== loadedView.current) setPageLoading(true);
    const qs = new URLSearchParams({ page: String(page), per: String(PER_PAGE), sort, ...(filter !== "all" ? { type: filter } : {}) });
    api(`/notes?${qs}`, { signal: ctl.signal }).then(
      (r: NotesPage) => {
        if (!Array.isArray(r?.items)) { // an API older than server pagination returns a bare array
          setPageLoading(false); setLoading(false);
          setNotice("The API is out of date — restart it (uvicorn … --reload) to load your notes.");
          return;
        }
        if (page > r.pages) { setPage(r.pages); return; } // a delete emptied the last page
        setItems(r.items); setPageInfo({ total: r.total, pages: r.pages });
        loadedView.current = viewKey;
        setPageLoading(false); setLoading(false);
        const id = pendingScroll.current;
        if (id && r.items.some(n => n.id === id)) {
          pendingScroll.current = null;
          setTimeout(() => document.getElementById(noteAnchor(id))?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
        }
      },
      (e: { status?: number; name?: string }) => {
        if (ctl.signal.aborted) return;
        setPageLoading(false); setLoading(false);
        if (!authFail(e)) setNotice("Could not reach the API — showing an empty desk. Start the backend and reload.");
      },
    );
    return () => ctl.abort();
  }, [page, sort, filter, reloadKey, scoped]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resets live in the handlers (not an effect) so a jump can set filter + page together.
  const changeFilter = (f: "all" | NoteType) => { setFilter(f); setPage(1); setSel(null); };
  const changeSort = (v: Sort) => { setSort(v); setPage(1); setSel(null); };
  const changeQuery = (v: string) => { setQuery(v); setPage(1); setSel(null); };

  // Open any note by id: find its page on the server, go there, expand + scroll to it.
  const jumpTo = async (id: string, keepFilter = true) => {
    const loc = (type?: string) => api(`/notes/${id}/page?${new URLSearchParams({ per: String(PER_PAGE), sort, ...(type ? { type } : {}) })}`);
    let r: { page: number };
    let nextFilter = filter;
    try { r = await loc(keepFilter && filter !== "all" ? filter : undefined); }
    catch {
      try { r = await loc(); nextFilter = "all"; } // not in the current filter → show all
      catch { setNotice("That note no longer exists."); return; }
    }
    pendingScroll.current = id;
    setQuery(""); setView("stream"); setFilter(nextFilter);
    setPage(r.page); setSel(id);
    setReloadKey(k => k + 1); // same page? still refetch so the scroll fires
  };

  // Copied links open /notes#note-<id>.
  useEffect(() => {
    const id = location.hash.startsWith("#note-") ? location.hash.slice(6) : "";
    if (id) jumpTo(id, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Map needs every node, so it's fetched only while the map is open.
  const [serverGraph, setServerGraph] = useState<{ nodes: ReturnType<typeof buildGraph>["nodes"]; links: ReturnType<typeof buildGraph>["links"] } | null>(null);
  useEffect(() => {
    if (view !== "map") return;
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
  }, [view, reloadKey]);
  // B6.2 fallback: offline → graph of whatever page is loaded.
  const gmap = useMemo(() => serverGraph ?? buildGraph(items), [serverGraph, items]);

  // Search results (small, capped server-side) are filtered/sorted/paged here; the stream is paged by the server.
  const searchRows = (remote ?? [])
    .filter(n => filter === "all" || (n.type || "note") === filter)
    .sort((a, b) => (sort === "new" ? ts(b) - ts(a) : ts(a) - ts(b)));
  const matched = remote ? remote.map(n => n.id) : null;
  const pages = scoped ? Math.max(1, Math.ceil(searchRows.length / PER_PAGE)) : pageInfo.pages;
  const cur = Math.min(page, pages);
  const shown = scoped ? searchRows.slice((cur - 1) * PER_PAGE, cur * PER_PAGE) : items;
  const listTotal = scoped ? searchRows.length : pageInfo.total;
  const visibleKey = searchRows.map(n => n.id).join(",");
  // While searching, the map shows only the hits (and edges among them), not the whole graph dimmed.
  const mapGraph = useMemo(
    () => (scoped ? subgraph(gmap, visibleKey ? visibleKey.split(",") : []) : gmap),
    [scoped, gmap, visibleKey],
  );
  const mapNodes = useMemo(
    () => mapGraph.nodes.map(n => ({ id: n.id, title: n.note.title || n.note.raw_text.slice(0, 24), type: (n.note.type || "note") as NoteType, deg: n.deg, r: n.r })),
    [mapGraph],
  );
  const goPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), pages));
    setSel(null);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Backend search; 501/no-key/offline → no remote rows ("No notes found").
  // Debounced 400ms on the trimmed query; a newer query aborts the older request.
  useEffect(() => {
    setRemote(null); setSummary(""); // never show the previous query's hits
    if (!qRaw) { setSearching(false); return; }
    setSearching(true);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await api(`/search?q=${encodeURIComponent(qRaw)}`, { signal: ctl.signal });
        setRemote(!r?.error && Array.isArray(r.notes) ? r.notes : []);
        setSummary(r?.summary || "");
      } catch { if (!ctl.signal.aborted) setRemote([]); }
      if (!ctl.signal.aborted) setSearching(false);
    }, 400);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [qRaw]);

  // Reload current page + stats (+ map when open) after save/edit/delete/type change.
  const reload = () => { setReloadKey(k => k + 1); loadStats(); };

  // End the session server-side, then go to login regardless of the outcome.
  const logout = async () => {
    stopVoice(); stopRecorder(false);
    try { await api("/auth/logout", { method: "POST", body: "{}" }); }
    finally { router.push("/login"); }
  };

  // Save the draft as a note (waits for any pending transcript first), then reload.
  const save = async () => {
    if (!text.trim() || busy) return;
    if (transcribing) return;
    if (rec.current) { stopRecorder(true); return; } // let the transcript land first, save after
    if (listening) stopVoice();
    setBusy(true);
    setNotice("");
    try {
      await api("/notes", { method: "POST", body: JSON.stringify({ raw_text: text }) });
      setText("");
      setQuery("");
      if (sort === "new") setPage(1); // the new note is at the top
      reload();
    } catch {
      setNotice("Save failed — is the API running on :8000?");
    } finally { setBusy(false); }
  };

  const patchLocal = (id: string, patch: Partial<Note>) => {
    const f = (ns: Note[]) => ns.map(n => (n.id === id ? { ...n, ...patch } : n));
    setItems(f);
    setRemote(r => (r ? f(r) : r));
  };

  const mutate = async (id: string, body: object, patch: Partial<Note>, fail: string) => {
    patchLocal(id, patch);
    try {
      await api(`/notes/${id}`, { method: "PUT", body: JSON.stringify(body) });
      // Edits re-enrich server-side (title/summary/tags/related change) — pull the fresh row.
      const fresh: Note | null = await api(`/notes/${id}`).catch(() => null);
      if (fresh) patchLocal(id, fresh);
      reload(); // page order/filter membership + counts
    } catch { setNotice(fail); reload(); }
  };

  const remove = async (id: string) => {
    setSel(null);
    setItems(ns => ns.filter(n => n.id !== id));
    setRemote(r => (r ? r.filter(n => n.id !== id) : r));
    await api(`/notes/${id}`, { method: "DELETE" }).catch(() => setNotice("Couldn't delete — is the API running?"));
    reload(); // the page refills from the next page; an emptied last page steps back
  };

  const empty = (title: string, body: string, cta?: boolean) => (
    <div className="anim-enter rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      <svg className="mx-auto mb-4 text-primary" width="72" height="56" viewBox="0 0 72 56" fill="none" aria-hidden>
        <rect x="14" y="6" width="44" height="44" rx="10" fill="var(--primary-50)" stroke="var(--primary-100)" strokeWidth="1.5" />
        <path d="M24 20h24M24 28h18M24 36h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".7" />
        <circle cx="60" cy="12" r="3" fill="currentColor" opacity=".35" /><circle cx="8" cy="42" r="2" fill="currentColor" opacity=".3" />
      </svg>
      <h2 className="text-[18px]">{title}</h2>
      <p className="text-sm text-muted mt-1.5 max-w-sm mx-auto">{body}</p>
      {cta && (
        <button onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); input.current?.focus(); }}
          className="btn btn-primary h-9 px-4 text-[13px] mt-5">Write your first note</button>
      )}
    </div>
  );

  return (
    <div data-theme={theme} className="min-h-screen text-ink"
      style={{ background: "radial-gradient(1200px 500px at 50% -10%, var(--primary-50), transparent 70%), var(--page)" }}>
      <div className="max-w-[880px] mx-auto sm:px-5 sm:py-6">
        <div className="bg-bg sm:rounded-2xl sm:border border-line min-h-screen sm:min-h-0 shadow-[0_20px_50px_-24px_rgb(var(--shadow)/.22)]">
          <Navbar notes={stats.total} links={stats.connections} query={query} setQuery={changeQuery}
            theme={theme} onToggleTheme={toggleTheme} email={email} onLogout={logout} />
          <main className="px-4 sm:px-6 pt-5 pb-8">
            {notice && <Notice text={notice} onDismiss={() => setNotice("")} />}

            <section aria-label="New note" className="anim-pop">
              <NoteInput ref={input} draft={text} setDraft={setText} onSave={save} busy={busy}
                listening={listening} transcribing={transcribing} stream={micStream}
                onToggleSpeak={toggleSpeak} onCancelVoice={cancelVoice} />
            </section>

            <div ref={listTop} className="scroll-anchor mt-5 mb-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="seg shrink-0 self-start" role="tablist" aria-label="View">
                <span className="seg-pill" aria-hidden
                  style={{ width: "calc(50% - 3px)", transform: view === "map" ? "translateX(100%)" : "none" }} />
                {(["stream", "map"] as const).map(v => (
                  <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                    className={`relative z-10 inline-flex items-center justify-center gap-2 px-4 h-8 rounded-[7px] text-[13px] font-medium capitalize transition-colors duration-200 ${view === v ? "text-ink" : "text-muted hover:text-soft"}`}>
                    {v === "stream" ? I.list : I.map}{v}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex-1 min-w-0">
                  {stats.total > 0 && (
                    <FilterChips counts={stats.counts} total={stats.total} active={filter}
                      onPick={t => changeFilter(filter === t ? "all" : t)} />
                  )}
                </div>
                {view === "stream" && <div className="shrink-0"><SortMenu sort={sort} onSort={changeSort} /></div>}
              </div>
            </div>

            {view === "map" ? (
              stats.total === 0 && !loading ? empty("No notes to map", "Save a note first. The map draws itself from the tags and people your notes share.", true) :
              scoped && mapGraph.nodes.length === 0 && searching ? <div className="skeleton h-[340px] rounded-[14px]" aria-busy="true" aria-label="Searching" /> :
              scoped && mapGraph.nodes.length === 0 ? empty("No notes found", `Nothing on the map matches "${query.trim()}". Clear the search to see the whole map.`) : (
                <div className="relative anim-fade">
                  <GraphView
                    nodes={mapNodes}
                    links={mapGraph.links} sel={sel} onSelect={setSel} fit={scoped}
                    onHover={(id, x, y) => setHover(id ? { id, x, y } : null)} />
                  {(() => {
                    const h = hover && gmap.nodes.find(n => n.id === hover.id)?.note;
                    if (!h) return null;
                    const t = TYPES[h.type || "note"] || TYPES.note;
                    return (
                      <div className="anim-enter absolute z-10 w-60 max-w-[240px] card p-3 pointer-events-none shadow-[0_12px_32px_-12px_rgb(var(--shadow)/.25)]"
                        style={{ left: Math.min(Math.max(hover.x - 120, 4), 400), top: Math.max(hover.y - 110, 4) }}>
                        <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full mb-1.5"
                          style={{ color: t.hue, background: tint(t.hue) }}>{t.label}</span>
                        <h2 className="text-[15px] leading-snug">{h.title || h.raw_text.slice(0, 60)}</h2>
                        {h.summary && <p className="text-xs text-soft mt-1 line-clamp-2">{h.summary}</p>}
                      </div>
                    );
                  })()}
                  <p className="text-xs text-muted mt-3">
                    {scoped && <>Showing {mapGraph.nodes.length} of {gmap.nodes.length} notes for this search. </>}
                    {mapGraph.nodes.filter(n => n.deg > 0).length} of {mapGraph.nodes.length} notes connected by {mapGraph.links.length} links. Drag to rearrange, tap a note to trace it.
                  </p>
                  {(() => {
                    const s = gmap.nodes.find(n => n.id === sel)?.note;
                    if (!s) return null;
                    const rel = gmap.links.flatMap(l => {
                      const other = l.source === s.id ? l.target : l.target === s.id ? l.source : null;
                      const o = other ? gmap.nodes.find(n => n.id === other)?.note : null;
                      return o ? [{ other: o, shared: l.shared }] : [];
                    }).sort((a, b) => b.shared.length - a.shared.length);
                    return (
                      <div key={s.id} className="anim-enter card p-5 mt-3">
                        <h2 className="text-[18px]">{s.title || s.raw_text.slice(0, 60)}</h2>
                        {s.summary && <p className="text-sm text-soft mt-1">{s.summary}</p>}
                        {rel.length ? (
                          <div className="mt-3">
                            <p className="text-[13px] text-soft font-medium mb-1">Connected to</p>
                            {rel.map(x => (
                              <button key={x.other.id} className="block w-full text-left py-1.5 px-1 -mx-1 rounded-md hover:bg-surface transition-colors" onClick={() => setSel(x.other.id)}>
                                <span className="text-[13.5px] text-primary">{x.other.title}</span>
                                <span className="text-xs text-faint"> via {x.shared.join(", ")}</span>
                              </button>
                            ))}
                          </div>
                        ) : <p className="text-sm text-faint mt-2">Nothing else touches this yet.</p>}
                      </div>
                    );
                  })()}
                </div>
              )
            ) : loading || (!scoped && pageLoading) || (scoped && searching && shown.length === 0) ? (
              <>
                <div className="flex flex-col gap-2.5" aria-busy="true" aria-label={scoped ? "Searching" : "Loading notes"}>
                  {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-14 rounded-xl" />)}
                </div>
                {!scoped && !loading && <Pagination page={cur} pages={pages} total={listTotal} per={PER_PAGE} onPage={goPage} />}
              </>
            ) : !scoped && filter === "all" && pageInfo.total === 0 ? (
              empty("No notes yet", "Type a thought above, or tap the mic and say it. Each note gets a title, tags and connections.", true)
            ) : shown.length === 0 ? (
              empty("No notes found", q ? `Nothing matches "${query.trim()}". Try another word, or clear the filter.` : "No notes of this type yet.")
            ) : (
              <>
                {searching && (
                  <p className="anim-fade mb-3 flex items-center gap-2 text-[13px] text-primary" role="status">
                    {I.sparkle} Searching with AI<span className="w-1.5 h-1.5 rounded-full bg-primary pulse" aria-hidden />
                  </p>
                )}
                {summary && (
                  <div className="anim-enter rounded-xl bg-primary-50 border border-primary-100 px-4 py-3 mb-3 flex gap-2.5">
                    <span className="text-primary mt-0.5">{I.sparkle}</span>
                    <p className="text-sm text-soft">{summary}</p>
                  </div>
                )}
                <NoteList key={`${cur}|${filter}|${sort}|${q ? "q" : ""}`} notes={shown} sel={sel} highlightIds={matched}
                  onToggle={id => setSel(s => (s === id ? null : id))}
                  onJump={id => { if (shown.some(n => n.id === id)) setSel(id); else jumpTo(id); }}
                  onSetType={(id, t: NoteType) => mutate(id, { type: t }, { type: t }, "Couldn't save the type — is the API running?")}
                  onEdit={(id, raw) => mutate(id, { raw_text: raw }, { raw_text: raw }, "Couldn't save the edit — is the API running?")}
                  onRegenerate={async id => {
                    const n = shown.find(x => x.id === id);
                    if (n) await mutate(id, { raw_text: n.raw_text }, {}, "Couldn't regenerate the summary — is the API running?");
                  }}
                  onSetTags={(id, tags) => mutate(id, { tags }, { tags }, "Couldn't save tags — is the API running?")}
                  onTag={changeQuery}
                  onNotice={setNotice}
                  onDelete={remove} />
                <Pagination page={cur} pages={pages} total={listTotal} per={PER_PAGE} onPage={goPage} />
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
