// useNotesPage: the one hook notes/page.tsx calls — wires the feature hooks together, no logic of its own.
import { useRef, useState } from "react";
import type { Note } from "../../../lib/types";
import { useTheme } from "./useTheme";
import { useAccount } from "./useAccount";
import { useStats } from "./useStats";
import { useViewControls } from "./useViewControls";
import { usePalette } from "./usePalette";
import { useSearch } from "./useSearch";
import { useNotesFeed } from "./useNotesFeed";
import { useMapView } from "./useMapView";
import { useNoteDialog } from "./useNoteDialog";
import { useRefreshing } from "./useRefreshing";
import { useVoice } from "./useVoice";
import { useNoteEdits } from "./useNoteEdits";
import { useNoteActions } from "./useNoteActions";
import { useSaveNote } from "./useSaveNote";

export function useNotesPage() {
  const [notice, setNotice] = useState("");
  const [text, setText] = useState(""); // the draft in the note input
  const input = useRef<{ focus: () => void }>(null);
  const { theme, toggleTheme } = useTheme();
  const account = useAccount();
  const { stats, loadStats, countNew } = useStats(account.authFail);
  const view = useViewControls();
  const palette = usePalette(setNotice);
  const search = useSearch(view.query, view.filter, view.bucket, view.sort);
  const feed = useNotesFeed({ sort: view.sort, filter: view.filter, bucket: view.bucket, listGen: view.listGen,
    scoped: search.scoped, view: view.view, authFail: account.authFail, setNotice });
  const shown = search.scoped ? search.searchRows : feed.items;
  const map = useMapView({ view: view.view, scoped: search.scoped, items: feed.items, searchRows: search.searchRows, sel: view.sel });
  const dialog = useNoteDialog(feed.items, search.remote);
  const { refreshing, startRefresh, endRefresh } = useRefreshing();
  const voice = useVoice({ text, setText, setNotice });

  // Stats (+ map when open) after any mutation; the stream list is patched in place instead.
  const reload = () => { map.refetch(); loadStats(); };
  // One note changed: update every copy (list, search rows, dialog, map node).
  const patchLocal = (id: string, p: Partial<Note>) => { feed.patch(id, p); search.patch(id, p); dialog.patch(id, p); map.patch(id, p); };

  const edits = useNoteEdits({ feed, patchLocal, startRefresh, endRefresh, reload, setNotice });
  const actions = useNoteActions({ feed, search, dialog, edits, shown, bucket: view.bucket, setBucket: view.setBucket,
    setSel: view.setSel, refetchList: view.refetchList, patchLocal, reload, setNotice, authFail: account.authFail });
  const saver = useSaveNote({ text, setText, setQuery: view.setQuery, voice, feed, countNew, patchLocal,
    startRefresh, endRefresh, reload, setNotice });

  return {
    theme, toggleTheme, email: account.email, logout: () => account.logout(voice.stopAll),
    notice, setNotice, dismissNotice: () => { setNotice(""); voice.clearRetry(); },
    text, setText, input, focusInput: () => { window.scrollTo({ top: 0, behavior: "smooth" }); input.current?.focus(); },
    stats, view, palette, search, feed, shown, map, dialog, refreshing, voice, edits, actions, saver,
  };
}
