// useViewControls: what the user is looking at — stream/map, type + bucket filter, sort, query, selection.
import { useRef, useState } from "react";
import type { Sort } from "../../../components/SortMenu";
import type { TypeFilter } from "../helpers";

// Board of cards, or the connection map.
export type View = "stream" | "map";

// Used by: useNotesPage. Every change* also clears the map selection so a stale panel never lingers.
export function useViewControls() {
  const [view, setView] = useState<View>("stream");
  const [sel, setSel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [bucket, setBucket] = useState<string | null>(null); // null = every bucket
  const [sort, setSort] = useState<Sort>("new");
  const [listGen, setListGen] = useState(0); // bump to refetch the stream (bucket renames/deletes rewrite many notes)
  const listTop = useRef<HTMLDivElement>(null);

  // Changing the view shortens the list — bring the toolbar back into view if we were below it.
  const toListTop = () => { if (listTop.current && listTop.current.getBoundingClientRect().top < 0) listTop.current.scrollIntoView({ block: "start" }); };
  const changeFilter = (f: TypeFilter) => { setFilter(f); setSel(null); toListTop(); };
  // Tapping the active chip again goes back to every type.
  const toggleFilter = (t: TypeFilter) => changeFilter(filter === t ? "all" : t);
  const changeBucket = (b: string | null) => { setBucket(b); setSel(null); toListTop(); };
  const changeSort = (v: Sort) => { setSort(v); setSel(null); toListTop(); };
  const changeQuery = (v: string) => { setQuery(v); setSel(null); };
  // Bucket renames/deletes rewrite many notes at once — refetch instead of patching.
  const refetchList = () => setListGen(g => g + 1);

  return { view, setView, sel, setSel, query, setQuery, changeQuery, filter, toggleFilter, bucket, setBucket, changeBucket,
    sort, changeSort, listGen, refetchList, listTop };
}
