"use client";
// notes page: the whole app — stream list + map, search, voice tiers, infinite scroll.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import type { Note, NoteType, NotesPage, NoteStats } from "../../lib/types";
import { buildGraph, subgraph } from "../../lib/graph";
import { createVoice, supported as srSupported } from "../../lib/voice";
import { createWisprVoice, supported as wisprSupported } from "../../lib/voice-wispr";
import NoteInput from "../../components/NoteInput";
import NoteBoard, { noteAnchor } from "../../components/NoteBoard";
import NoteDialog, { type NoteEdits } from "../../components/NoteDialog";
import FilterChips from "../../components/FilterChips";
import GraphView from "../../components/GraphView";
import Notice from "../../components/Notice";
import Navbar from "../../components/Navbar";
import SortMenu, { type Sort } from "../../components/SortMenu";
import { I } from "../../components/IconButton";
import TypePill from "../../components/TypePill";
import { noteSurface, nodeColor } from "../../lib/colors";

const BATCH = 30; // notes per scroll batch
const ts = (n: Note) => (n.created_at ? new Date(n.created_at).getTime() : 0);

export default function Notes() {
  const router = useRouter();
  const [items, setItems] = useState<Note[]>([]); // every batch loaded so far for this sort + filter
  const [cursor, setCursor] = useState<string | null>(null); // server position of the next batch
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false); // first batch of a new sort/filter
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreErr, setMoreErr] = useState(false);
  const [stats, setStats] = useState<NoteStats>({ total: 0, counts: {}, connections: 0 });
  const [reloadKey, setReloadKey] = useState(0); // refetches the map after mutations
  const viewRef = useRef("");                         // batches for an older view are dropped
  const moreCtl = useRef<AbortController | null>(null);
  const busyMore = useRef(false);                     // sync guard: the observer can fire twice per render
  const sentinel = useRef<HTMLDivElement>(null);
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
  const recStart = useRef(0);                 // performance.now() at record start → duration_ms
  const recIds = useRef<string[]>([]);        // S3 clips behind the current draft, linked on Save
  const [retryId, setRetryId] = useState<string | null>(null); // clip saved but not transcribed
  const tier = useRef<null | "wispr" | "whisper" | "browser">(null);
  // Cut: restore the draft to what it was before recording and ignore any late transcript.
  const voiceBase = useRef("");
  const discard = useRef(false);
  const transcribeCtl = useRef<AbortController | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null); // feeds the waveform
  const listTop = useRef<HTMLDivElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  const input = useRef<{ focus: () => void }>(null);
  const [sort, setSort] = useState<Sort>("new");
  const [openId, setOpenId] = useState<string | null>(null);  // note shown in the Keep-style dialog
  const [extra, setExtra] = useState<Note | null>(null);       // dialog note that isn't loaded in the list
  const [palette, setPalette] = useState<string[]>([]);         // user's custom swatches
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set()); // text edits awaiting re-enrichment
  const [email, setEmail] = useState<string | null>(null);
  // Theme lives on this page's root only — /login never sees data-theme="dark".
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("theme"); } catch { /* storage blocked */ }
    setTheme(saved === "dark" || saved === "light" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    api("/auth/me").then(r => setEmail(r?.email || null), () => {});
    api("/palette").then(r => setPalette(Array.isArray(r?.colors) ? r.colors : []), () => {});
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
      const mime = mr.mimeType || "audio/webm";
      const blob = new Blob(recChunks.current, { type: mime });
      recChunks.current = [];
      setListening(false);
      if (!blob.size) return;
      const fd = new FormData();
      // Name the file by what the browser actually recorded (Safari = mp4, Firefox = ogg).
      const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
      fd.append("audio", blob, `note.${ext}`);
      fd.append("duration_ms", String(Math.round(performance.now() - recStart.current)));
      const ctl = new AbortController();
      transcribeCtl.current = ctl;
      setTranscribing(true);
      api("/voice/transcribe", { method: "POST", body: fd, signal: ctl.signal }).then(
        r => {
          if (ctl.signal.aborted) return;
          if (r?.recording_id) recIds.current.push(r.recording_id);
          if (r?.transcript) {
            const t = r.transcript.trim();
            setText(recBase.current ? `${recBase.current} ${t}`.trim() : t);
            setNotice("Transcript ready — review it and hit Save.");
          } else if (r?.error === "not_configured") setNotice("Voice upload isn't configured (no API key).");
        },
        (e: { status?: number; body?: { error?: string; recording_id?: string } }) => {
          if (ctl.signal.aborted) return;
          if (e?.body?.recording_id) { setRetryId(e.body.recording_id); setNotice("Couldn't transcribe — your audio is saved."); }
          else if (e?.status === 413) setNotice(`Recording too long — keep it under ${25} MB.`);
          else if (e?.status === 415) setNotice("This browser's audio format isn't supported — try Chrome.");
          else if (e?.status === 501) setNotice("Voice upload isn't configured (no API key).");
          else setNotice("Transcribe failed — check connection and try again.");
        },
      ).finally(() => {
        if (transcribeCtl.current === ctl) { transcribeCtl.current = null; setTranscribing(false); }
      });
    };
    try { mr.stop(); } catch { setListening(false); }
  };

  // Retry a clip whose transcription failed — the API pulls the audio back from S3.
  const retryTranscribe = async (id: string) => {
    if (transcribing) return;
    setTranscribing(true);
    try {
      const r = await api(`/voice/recordings/${id}/retry`, { method: "POST", body: "{}" });
      const t = (r?.transcript || "").trim();
      if (t) setText(cur => (cur.trim() ? `${cur.trim()} ${t}` : t));
      if (!recIds.current.includes(id)) recIds.current.push(id);
      setRetryId(null);
      setNotice(t ? "Transcript ready — review it and hit Save." : "Transcribed, but no speech was found in that clip.");
    } catch {
      setNotice("Still couldn't transcribe — your audio is saved, try again in a bit.");
    } finally { setTranscribing(false); }
  };

  // Draft cleared by hand → forget its clips (never linked; the prune job sweeps them).
  useEffect(() => {
    if (!text.trim() && !listening && !transcribing) recIds.current = [];
  }, [text, listening, transcribing]);

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
      recStart.current = performance.now();
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
  const scoped = !!q; // search mode: results come from /search, not the stream list

  // First batch of the stream for this sort + filter. The loaded list survives searches and
  // mutations (they patch it in place), so scroll depth is never lost; only a view change resets it.
  const viewKey = `${sort}|${filter}`;
  // Live view for async callbacks (enrich polling, PUT round trips) that outlive the render they began in.
  const live = useRef({ sort, filter, hasMore });
  live.current = { sort, filter, hasMore };
  useEffect(() => {
    const ctl = new AbortController();
    viewRef.current = viewKey;
    moreCtl.current?.abort(); moreCtl.current = null; busyMore.current = false;
    setLoadingMore(false); setMoreErr(false); setListLoading(true);
    const qs = new URLSearchParams({ per: String(BATCH), sort, ...(filter !== "all" ? { type: filter } : {}) });
    api(`/notes?${qs}`, { signal: ctl.signal }).then(
      (r: NotesPage) => {
        if (ctl.signal.aborted) return;
        setListLoading(false); setLoading(false);
        if (!Array.isArray(r?.items)) { // an API older than server pagination returns a bare array
          setNotice("The API is out of date — restart it (uvicorn … --reload) to load your notes.");
          return;
        }
        // No next_cursor (incl. an API without cursor support) ends the list — never re-request page 1.
        setItems(r.items); setCursor(r.next_cursor ?? null); setHasMore(!!r.next_cursor);
      },
      (e: { status?: number; name?: string }) => {
        if (ctl.signal.aborted) return;
        setListLoading(false); setLoading(false);
        setItems([]); setCursor(null); setHasMore(false);
        if (!authFail(e)) setNotice("Could not reach the API — showing an empty desk. Start the backend and reload.");
      },
    );
    return () => ctl.abort();
  }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Next batch, appended. Dropped if the view changed meanwhile; ids already loaded are skipped.
  const loadMore = () => {
    const key = viewKey; // this render's view — an observer left over from the previous view bails here
    if (busyMore.current || !hasMore || !cursor || key !== viewRef.current) return;
    busyMore.current = true;
    setLoadingMore(true); setMoreErr(false);
    const ctl = new AbortController();
    moreCtl.current = ctl;
    const qs = new URLSearchParams({ per: String(BATCH), sort, cursor, ...(filter !== "all" ? { type: filter } : {}) });
    api(`/notes?${qs}`, { signal: ctl.signal }).then(
      (r: NotesPage) => {
        if (ctl.signal.aborted || key !== viewRef.current) return;
        const got = Array.isArray(r?.items) ? r.items : [];
        setItems(prev => { const have = new Set(prev.map(n => n.id)); return [...prev, ...got.filter(n => !have.has(n.id))]; });
        const next = got.length ? r.next_cursor ?? null : null; // an empty batch can't advance — stop
        setCursor(next); setHasMore(!!next);
      },
      (e: { status?: number }) => {
        if (ctl.signal.aborted || key !== viewRef.current) return;
        if (!authFail(e)) setMoreErr(true);
      },
    ).finally(() => {
      if (moreCtl.current === ctl) { moreCtl.current = null; busyMore.current = false; setLoadingMore(false); }
    });
  };

  // Load the next batch as the end of the list nears. Re-created after every batch: observe()
  // reports the current state at once, so a list shorter than the screen keeps filling it.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loadingMore || moreErr || listLoading || scoped || view !== "stream") return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore(); }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, moreErr, listLoading, scoped, view, cursor, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Changing the view shortens the list — bring the toolbar back into view if we were below it.
  const toListTop = () => { if (listTop.current && listTop.current.getBoundingClientRect().top < 0) listTop.current.scrollIntoView({ block: "start" }); };
  const changeFilter = (f: "all" | NoteType) => { setFilter(f); setSel(null); toListTop(); };
  const changeSort = (v: Sort) => { setSort(v); setSel(null); toListTop(); };
  const changeQuery = (v: string) => { setQuery(v); setSel(null); };

  // Map needs every node, so it's fetched only while the map is open.
  const [serverGraph, setServerGraph] = useState<{ nodes: ReturnType<typeof buildGraph>["nodes"]; links: ReturnType<typeof buildGraph>["links"] } | null>(null);
  useEffect(() => {
    if (view !== "map") return;
    let live = true;
    api("/map").then(
      r => {
        if (!live || !Array.isArray(r?.nodes)) return;
        setServerGraph({
          nodes: r.nodes.map((n: { id: string; title: string; type: NoteType; summary: string; color?: string; deg: number; r: number }) => ({
            id: n.id, note: { id: n.id, raw_text: "", title: n.title, type: n.type, summary: n.summary, color: n.color || "" }, deg: n.deg, r: n.r,
          })),
          links: Array.isArray(r.edges) ? r.edges : [],
        });
      },
      () => { if (live) setServerGraph(null); },
    );
    return () => { live = false; };
  }, [view, reloadKey]);
  // B6.2 fallback: offline → graph of whatever notes are loaded.
  const gmap = useMemo(() => serverGraph ?? buildGraph(items), [serverGraph, items]);

  // Search results (small, capped server-side) are filtered/sorted here; the stream comes in batches.
  const searchRows = (remote ?? [])
    .filter(n => filter === "all" || (n.type || "note") === filter)
    .sort((a, b) => (sort === "new" ? ts(b) - ts(a) : ts(a) - ts(b)));
  const matched = remote ? remote.map(n => n.id) : null;
  const shown = scoped ? searchRows : items;
  const visibleKey = searchRows.map(n => n.id).join(",");
  // While searching, the map shows only the hits (and edges among them), not the whole graph dimmed.
  const mapGraph = useMemo(
    () => (scoped ? subgraph(gmap, visibleKey ? visibleKey.split(",") : []) : gmap),
    [scoped, gmap, visibleKey],
  );
  const mapNodes = useMemo(
    () => mapGraph.nodes.map(n => ({
      id: n.id, title: n.note.title || n.note.raw_text.slice(0, 60), type: (n.note.type || "note") as NoteType,
      color: nodeColor(n.note.color, n.note.type), deg: n.deg, r: n.r,
    })),
    [mapGraph],
  );
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

  // Refresh stats (+ map when open) after save/edit/delete/type change. The stream list is
  // patched in place (patchLocal/reconcile) instead — refetching would drop the scrolled batches.
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
      const ids = recIds.current;
      const n: Note = await api("/notes", { method: "POST", body: JSON.stringify({ raw_text: text, source: ids.length ? "voice" : "typed", recording_ids: ids }) });
      recIds.current = []; // kept on failure so the next Save still links them
      setRetryId(null);
      setText("");
      setQuery("");
      // The API replies before the AI step; show the note now and let watchEnrich fill it in.
      reconcile(n); // newest-first → top of the list; oldest-first → end, once that's loaded
      const k = n.type || "note";
      setStats(st => ({ ...st, total: st.total + 1, counts: { ...st.counts, [k]: (st.counts[k] || 0) + 1 } }));
      if (n?.id) { setRefreshing(r => new Set(r).add(n.id)); watchEnrich(n.id); }
    } catch {
      setNotice("Save failed — is the API running on :8000?");
    } finally { setBusy(false); }
  };

  // Poll one note until the background AI step lands (title/summary/tags/type), then settle once.
  const watchEnrich = (id: string) => {
    let tries = 0;
    const finish = () => { setRefreshing(r => { const x = new Set(r); x.delete(id); return x; }); reload(); };
    const tick = async () => {
      tries++;
      let gone = false;
      const n: Note | null = await api(`/notes/${id}`).catch((e: { status?: number }) => { gone = e?.status === 404; return null; });
      if (gone) { dropLocal(id); finish(); return; }                    // deleted meanwhile
      if (n && n.enrich_state !== "pending") { patchLocal(id, n); reconcile(n); finish(); return; }
      if (tries >= 16) { finish(); return; }                            // ~20s cap; the reload shows whatever landed
      setTimeout(tick, 1200);
    };
    setTimeout(tick, 1500);
  };

  const patchLocal = (id: string, patch: Partial<Note>) => {
    const f = (ns: Note[]) => ns.map(n => (n.id === id ? { ...n, ...patch } : n));
    setItems(f);
    setRemote(r => (r ? f(r) : r));
    setExtra(x => (x && x.id === id ? { ...x, ...patch } : x));
    // Map nodes carry their own copy of the note — repaint them now, not after the /map refetch.
    setServerGraph(g => g && ({ ...g, nodes: g.nodes.map(n => (n.id === id ? { ...n, note: { ...n.note, ...patch } } : n)) }));
  };

  const dropLocal = (id: string) => setItems(ns => ns.filter(n => n.id !== id));

  // Keep a note's place in the loaded list in step with the current filter + sort: drop it when its
  // type no longer matches, slot it in by date when it newly does. A slot past the last loaded note
  // is left to the next batch (the cursor brings it; loadMore skips duplicates).
  const reconcile = (n: Note) => {
    const { sort, filter, hasMore } = live.current;
    const fits = filter === "all" || (n.type || "note") === filter;
    setItems(prev => {
      const at = prev.findIndex(x => x.id === n.id);
      if (!fits) return at < 0 ? prev : prev.filter(x => x.id !== n.id);
      if (at >= 0) return prev.map(x => (x.id === n.id ? { ...x, ...n } : x));
      const i = prev.findIndex(x => (sort === "new" ? ts(x) < ts(n) : ts(x) > ts(n)));
      if (i < 0) return hasMore ? prev : [...prev, n];
      return [...prev.slice(0, i), n, ...prev.slice(i)];
    });
  };

  const mutate = async (id: string, body: Partial<Pick<Note, "raw_text" | "title" | "type" | "tags" | "color">>, patch: Partial<Note>, fail: string) => {
    patchLocal(id, patch);
    const enrich = body.raw_text !== undefined; // text edits re-run AI — show "refreshing" until the row is back
    if (enrich) setRefreshing(r => new Set(r).add(id));
    try {
      await api(`/notes/${id}`, { method: "PUT", body: JSON.stringify(body) });
      // Edits re-enrich server-side (title/summary/tags/related change) — pull the fresh row.
      const fresh: Note | null = await api(`/notes/${id}`).catch(() => null);
      if (fresh) { patchLocal(id, fresh); reconcile(fresh); } // a type change may leave this filter
      reload(); // counts + map
    } catch {
      setNotice(fail);
      // Put the server's version back over the optimistic patch (or drop it if it's gone).
      api(`/notes/${id}`).then(
        (n: Note) => { patchLocal(id, n); reconcile(n); },
        (e: { status?: number }) => { if (e?.status === 404) dropLocal(id); },
      );
      reload();
    }
    finally { if (enrich) setRefreshing(r => { const n = new Set(r); n.delete(id); return n; }); }
  };

  // Open the dialog; a note that isn't loaded in the list (map table, connected note) is fetched.
  // Always pulls the fresh row: list rows don't carry voice recordings, GET /notes/{id} does.
  const openNote = (id: string) => {
    setOpenId(id);
    const onPage = [...items, ...(remote || [])].some(n => n.id === id);
    api(`/notes/${id}`).then(
      (n: Note) => (onPage ? patchLocal(id, n) : setExtra(n)),
      () => { if (!onPage) { setOpenId(null); setNotice("That note no longer exists."); } },
    );
  };
  const dialogNote = openId ? (items.find(n => n.id === openId) || remote?.find(n => n.id === openId) || (extra?.id === openId ? extra : null)) : null;

  // Dialog closed (or hopped to a connected note): save title/text edits, hand focus back to the card.
  const closeNote = (edits: NoteEdits, next?: string) => {
    const id = openId;
    if (id && (edits.title !== undefined || edits.raw_text !== undefined)) {
      const patch: Partial<Note> = { ...edits };
      mutate(id, edits, patch, "Couldn't save the edit — is the API running?");
    }
    if (next) { openNote(next); return; }
    setOpenId(null);
    if (id) requestAnimationFrame(() => document.getElementById(noteAnchor(id))?.focus({ preventScroll: true }));
  };

  const setColor = (id: string, color: string) => mutate(id, { color }, { color }, "Couldn't save the color — is the API running?");
  const savePalette = (next: string[]) => {
    setPalette(next);
    api("/palette", { method: "PUT", body: JSON.stringify({ colors: next }) }).then(
      r => Array.isArray(r?.colors) && setPalette(r.colors), () => setNotice("Couldn't save your colors — is the API running?"));
  };
  const addCustom = (hex: string) => { if (!palette.includes(hex)) savePalette([...palette, hex].slice(-16)); };
  const removeCustom = (hex: string) => savePalette(palette.filter(c => c !== hex));
  const copyNote = async (id: string) => {
    const n = shown.find(x => x.id === id);
    if (!n) return;
    try { await navigator.clipboard.writeText(n.raw_text); setNotice("Note text copied."); }
    catch { setNotice("Couldn't copy — your browser blocked clipboard access."); }
  };

  const remove = async (id: string) => {
    if (openId === id) setOpenId(null);
    setSel(null);
    const at = items.findIndex(n => n.id === id);
    const gone = at >= 0 ? items[at] : null;
    dropLocal(id);
    setRemote(r => (r ? r.filter(n => n.id !== id) : r));
    try { await api(`/notes/${id}`, { method: "DELETE" }); }
    catch {
      setNotice("Couldn't delete — is the API running?");
      // Not deleted: put it back where it was (unless a refetch already brought it back).
      if (gone) setItems(prev => (prev.some(n => n.id === id) ? prev : [...prev.slice(0, at), gone, ...prev.slice(at)]));
    }
    reload(); // counts + map
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
      <div className="max-w-[1200px] mx-auto sm:px-5 sm:py-6">
        <div className="bg-bg sm:rounded-2xl sm:border border-line min-h-screen sm:min-h-0 shadow-[0_20px_50px_-24px_rgb(var(--shadow)/.22)]">
          <Navbar notes={stats.total} links={stats.connections} query={query} setQuery={changeQuery}
            theme={theme} onToggleTheme={toggleTheme} email={email} onLogout={logout} />
          <main className="px-4 sm:px-6 pt-5 pb-8">
            {notice && <Notice text={notice} onDismiss={() => { setNotice(""); setRetryId(null); }}
              action={retryId ? { label: transcribing ? "Retrying…" : "Retry", onClick: () => retryTranscribe(retryId), disabled: transcribing } : undefined} />}

            <section aria-label="New note" className="anim-pop max-w-[680px] mx-auto">
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
                <div ref={mapBox} className="relative anim-fade">
                  <GraphView
                    nodes={mapNodes}
                    links={mapGraph.links} sel={sel} onSelect={setSel} fit={scoped}
                    onHover={(id, x, y) => setHover(id ? { id, x, y } : null)} />
                  {(() => {
                    const h = hover && gmap.nodes.find(n => n.id === hover.id)?.note;
                    if (!h) return null;
                    // Shared terms across this note's links, most common first ("Linked via").
                    const via = new Map<string, number>();
                    mapGraph.links.forEach(l => { if (l.source === h.id || l.target === h.id) l.shared.forEach(t => via.set(t, (via.get(t) || 0) + 1)); });
                    const terms = Array.from(via).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
                    // Beside the cursor, flipping left/below near the edges so it never covers the node.
                    const W = mapBox.current?.clientWidth || 640, CW = 248;
                    const left = hover.x + 18 + CW < W ? hover.x + 18 : Math.max(4, hover.x - 18 - CW);
                    const top = hover.y - 140 > 4 ? hover.y - 140 : hover.y + 20;
                    return (
                      <div className="anim-enter absolute z-10 card p-3 pointer-events-none shadow-[0_12px_32px_-12px_rgb(var(--shadow)/.3)]"
                        style={{ left, top, width: CW, ...noteSurface(h) }}>
                        <div className="mb-1.5"><TypePill type={h.type} size="sm" /></div>
                        <h2 className="text-[15px] leading-snug">{h.title || h.raw_text.slice(0, 60)}</h2>
                        {h.summary && <p className="text-xs text-soft mt-1 line-clamp-2">{h.summary}</p>}
                        {!!terms.length && <p className="text-[11.5px] text-muted mt-1.5">Linked via <span className="text-primary">{terms.join(", ")}</span></p>}
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
                      <div key={s.id} className="anim-enter card on-tint p-5 mt-3" style={noteSurface(s)}>
                        <div className="flex items-start gap-3">
                          <h2 className="flex-1 min-w-0 text-[18px]">{s.title || s.raw_text.slice(0, 60)}</h2>
                          <button onClick={() => openNote(s.id)} className="btn btn-ghost h-8 px-3 text-[13px] shrink-0">{I.edit} Open note</button>
                        </div>
                        {s.summary && <p className="text-sm text-soft mt-1">{s.summary}</p>}
                        {rel.length ? (
                          <div className="mt-3">
                            <p className="text-[13px] text-soft font-medium mb-1">Connected to</p>
                            {rel.map(x => (
                              <button key={x.other.id} className="block w-full text-left py-1.5 px-1 -mx-1 rounded-md hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] transition-colors" onClick={() => setSel(x.other.id)}>
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
            ) : loading || (!scoped && listLoading) || (scoped && searching && shown.length === 0) ? (
              <div className="columns-1 min-[560px]:columns-2 min-[860px]:columns-3 min-[1100px]:columns-4 gap-3" aria-busy="true" aria-label={scoped ? "Searching" : "Loading notes"}>
                {[120, 180, 96, 150, 200, 110, 140, 170].map((h, i) => <div key={i} className="skeleton rounded-xl mb-3 break-inside-avoid" style={{ height: h }} />)}
              </div>
            ) : !scoped && filter === "all" && items.length === 0 && !hasMore ? (
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
                <NoteBoard key={`${filter}|${sort}|${q ? "q" : ""}`} notes={shown} batch={BATCH} sel={sel} highlightIds={matched}
                  refreshing={refreshing} palette={palette}
                  onOpen={openNote}
                  onSetColor={setColor}
                  onSetType={(id, t: NoteType) => mutate(id, { type: t }, { type: t }, "Couldn't save the type — is the API running?")}
                  onAddCustom={addCustom} onRemoveCustom={removeCustom}
                  onCopy={copyNote}
                  onDelete={remove} />
                {!scoped && (
                  <div ref={sentinel} className="mt-6 min-h-px">
                    {loadingMore ? (
                      <div className="grid grid-cols-1 min-[560px]:grid-cols-2 min-[860px]:grid-cols-3 min-[1100px]:grid-cols-4 gap-3" aria-busy="true" aria-label="Loading more notes">
                        {[0, 1, 2, 3].map(i => <div key={i} className={`skeleton rounded-xl h-[120px] ${i ? "hidden min-[560px]:block" : ""}`} />)}
                      </div>
                    ) : moreErr ? (
                      <p className="text-center text-[13px] text-muted" role="status">
                        Couldn't load more notes.{" "}
                        <button onClick={loadMore} className="btn btn-ghost h-8 px-3 text-[13px] ml-1">Retry</button>
                      </p>
                    ) : !hasMore && items.length > BATCH ? (
                      <p className="text-center text-xs text-faint" role="status">That's all {items.length} notes.</p>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>
      {dialogNote && (
        <NoteDialog key={dialogNote.id} note={dialogNote} palette={palette} refreshing={refreshing.has(dialogNote.id)}
          onDone={closeNote}
          onSetColor={c => setColor(dialogNote.id, c)}
          onSetType={t => mutate(dialogNote.id, { type: t }, { type: t }, "Couldn't save the type — is the API running?")}
          onSetTags={tags => mutate(dialogNote.id, { tags }, { tags }, "Couldn't save tags — is the API running?")}
          onRegenerate={() => mutate(dialogNote.id, { raw_text: dialogNote.raw_text }, {}, "Couldn't regenerate the summary — is the API running?")}
          onDelete={() => remove(dialogNote.id)}
          onTag={changeQuery}
          onNotice={setNotice}
          onAddCustom={addCustom} onRemoveCustom={removeCustom} />
      )}
    </div>
  );
}
