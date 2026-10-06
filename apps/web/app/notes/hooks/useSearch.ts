// useSearch: backend /search for the query (debounced), filtered + sorted like the stream.
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import type { Note } from "../../../lib/types";
import type { Sort } from "../../../components/SortMenu";
import { createdMs, matchesView, type TypeFilter } from "../helpers";

// Used by: useNotesPage. Returns { qRaw, scoped, remote, summary, searching, searchRows, matched, patch, drop }.
export function useSearch(query: string, filter: TypeFilter, bucket: string | null, sort: Sort) {
  const [remote, setRemote] = useState<Note[] | null>(null); // /search rows; null = no search running
  const [summary, setSummary] = useState("");
  const [searching, setSearching] = useState(false); // AI /search in flight for the current query
  const qRaw = query.trim();
  const scoped = !!qRaw; // search mode: results come from /search, not the stream list

  // 501/no-key/offline → no remote rows ("No notes found"). Debounced 400ms on the trimmed
  // query; a newer query aborts the older request.
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

  // Search results are small (capped server-side), so filter + sort happen here.
  const searchRows = (remote ?? [])
    .filter(n => matchesView(n, filter, bucket))
    .sort((a, b) => (sort === "new" ? createdMs(b) - createdMs(a) : createdMs(a) - createdMs(b)));
  // Ids the board highlights; null when no search is running.
  const matched = remote ? remote.map(n => n.id) : null;

  // Keep search rows in step with edits/deletes made while searching.
  const patch = (id: string, p: Partial<Note>) => setRemote(r => (r ? r.map(n => (n.id === id ? { ...n, ...p } : n)) : r));
  const drop = (id: string) => setRemote(r => (r ? r.filter(n => n.id !== id) : r));

  return { qRaw, scoped, remote, summary, searching, searchRows, matched, patch, drop };
}

export type Search = ReturnType<typeof useSearch>;
