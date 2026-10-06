// useNotesFeed: the stream list — first batch per view, cursor batches on scroll, in-place patches.
import { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import type { Note, NotesPage } from "../../../lib/types";
import type { Sort } from "../../../components/SortMenu";
import { MSG } from "../constants";
import { createdMs, listQuery, matchesView, type HttpError, type TypeFilter } from "../helpers";
import { useInfiniteScroll } from "./useInfiniteScroll";
import type { View } from "./useViewControls";

// What decides the stream: sort + filters (+ listGen to force a refetch); scoped/view pause scrolling.
type FeedOpts = {
  sort: Sort; filter: TypeFilter; bucket: string | null; listGen: number; scoped: boolean; view: View;
  authFail: (e: HttpError) => boolean; setNotice: (m: string) => void;
};
// Snapshot of the view that async callbacks read through live.current.
type LiveView = { sort: Sort; filter: TypeFilter; bucket: string | null; hasMore: boolean };

// Keep a note's place in step with the filter + sort: drop it when it no longer matches, slot it in
// by date when it newly does. A slot past the last loaded note is left to the next batch.
function placeNote(prev: Note[], n: Note, v: LiveView): Note[] {
  const at = prev.findIndex(x => x.id === n.id);
  if (!matchesView(n, v.filter, v.bucket)) return at < 0 ? prev : prev.filter(x => x.id !== n.id);
  if (at >= 0) return prev.map(x => (x.id === n.id ? { ...x, ...n } : x));
  const i = prev.findIndex(x => (v.sort === "new" ? createdMs(x) < createdMs(n) : createdMs(x) > createdMs(n)));
  if (i < 0) return v.hasMore ? prev : [...prev, n];
  return [...prev.slice(0, i), n, ...prev.slice(i)];
}

// Used by: useNotesPage. Returns the loaded notes, loading flags, loadMore + sentinel, and in-place updaters.
export function useNotesFeed(o: FeedOpts) {
  const { sort, filter, bucket } = o;
  const [items, setItems] = useState<Note[]>([]); // every batch loaded so far for this sort + filter
  const [cursor, setCursor] = useState<string | null>(null); // server position of the next batch
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true); // very first load of the page
  const [listLoading, setListLoading] = useState(false); // first batch of a new sort/filter
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreErr, setMoreErr] = useState(false);
  const viewRef = useRef(""); // batches for an older view are dropped
  const moreCtl = useRef<AbortController | null>(null);
  const busyMore = useRef(false); // sync guard: the observer can fire twice per render
  const viewKey = `${sort}|${filter}|${bucket ?? ""}|${o.listGen}`;
  // Live view for async callbacks (enrich polling, PUT round trips) that outlive their render.
  const live = useRef<LiveView>({ sort, filter, bucket, hasMore });
  live.current = { sort, filter, bucket, hasMore };

  // Replace the whole list (first batch or error) along with its cursor.
  const setBatch = (next: Note[], nextCursor: string | null) => { setItems(next); setCursor(nextCursor); setHasMore(!!nextCursor); };

  // First batch for this view. The loaded list survives searches and mutations (they patch it
  // in place), so scroll depth is never lost; only a view change resets it.
  useEffect(() => {
    const ctl = new AbortController();
    viewRef.current = viewKey;
    moreCtl.current?.abort(); moreCtl.current = null; busyMore.current = false;
    setLoadingMore(false); setMoreErr(false); setListLoading(true);
    api(`/notes?${listQuery(sort, filter, bucket)}`, { signal: ctl.signal }).then(
      (r: NotesPage) => {
        if (ctl.signal.aborted) return;
        setListLoading(false); setLoading(false);
        if (!Array.isArray(r?.items)) { o.setNotice(MSG.apiOutdated); return; } // pre-pagination API: bare array
        setBatch(r.items, r.next_cursor ?? null); // no next_cursor ends the list — never re-request page 1
      },
      (e: HttpError) => {
        if (ctl.signal.aborted) return;
        setListLoading(false); setLoading(false);
        setBatch([], null);
        if (!o.authFail(e)) o.setNotice(MSG.apiUnreachable);
      },
    );
    return () => ctl.abort();
  }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Next batch, appended. Dropped if the view changed meanwhile; ids already loaded are skipped.
  const loadMore = () => {
    const key = viewKey; // an observer left over from the previous view bails here
    if (busyMore.current || !hasMore || !cursor || key !== viewRef.current) return;
    busyMore.current = true;
    setLoadingMore(true); setMoreErr(false);
    const ctl = new AbortController();
    moreCtl.current = ctl;
    api(`/notes?${listQuery(sort, filter, bucket, cursor)}`, { signal: ctl.signal }).then(
      (r: NotesPage) => {
        if (ctl.signal.aborted || key !== viewRef.current) return;
        const got = Array.isArray(r?.items) ? r.items : [];
        setItems(prev => { const have = new Set(prev.map(n => n.id)); return [...prev, ...got.filter(n => !have.has(n.id))]; });
        const next = got.length ? r.next_cursor ?? null : null; // an empty batch can't advance — stop
        setCursor(next); setHasMore(!!next);
      },
      (e: HttpError) => {
        if (ctl.signal.aborted || key !== viewRef.current) return;
        if (!o.authFail(e)) setMoreErr(true);
      },
    ).finally(() => {
      if (moreCtl.current === ctl) { moreCtl.current = null; busyMore.current = false; setLoadingMore(false); }
    });
  };

  // Only the stream view scrolls for more; search mode shows /search rows instead.
  const canLoadMore = hasMore && !loadingMore && !moreErr && !listLoading && !o.scoped && o.view === "stream";
  const sentinel = useInfiniteScroll(canLoadMore, loadMore,
    [hasMore, loadingMore, moreErr, listLoading, o.scoped, o.view, cursor, items.length]);

  // Re-place one note after save/edit using the *current* view (not the one the request began in).
  const reconcile = (n: Note) => { const v = live.current; setItems(prev => placeNote(prev, n, v)); };
  // In-place updates: scroll depth and loaded batches survive edits and deletes.
  const patch = (id: string, p: Partial<Note>) => setItems(ns => ns.map(n => (n.id === id ? { ...n, ...p } : n)));
  const drop = (id: string) => setItems(ns => ns.filter(n => n.id !== id));
  // Undo a failed delete: back where it was, unless a refetch already brought it back.
  const restore = (at: number, n: Note) => setItems(prev => (prev.some(x => x.id === n.id) ? prev : [...prev.slice(0, at), n, ...prev.slice(at)]));

  return { items, hasMore, loading, listLoading, loadingMore, moreErr, loadMore, sentinel, reconcile, patch, drop, restore };
}

export type Feed = ReturnType<typeof useNotesFeed>;
