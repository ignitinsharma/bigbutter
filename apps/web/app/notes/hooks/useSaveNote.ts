// useSaveNote: save the draft as a note, then poll until the background AI step fills it in.
import { useState } from "react";
import { api } from "../../../lib/api";
import type { Note } from "../../../lib/types";
import { MSG } from "../constants";
import type { HttpError } from "../helpers";
import type { Feed } from "./useNotesFeed";
import type { Voice } from "./useVoice";

// The draft, the voice state it must wait on, and the list/stat updaters a new note touches.
type SaveOpts = {
  text: string; setText: (v: string) => void; setQuery: (v: string) => void;
  voice: Voice; feed: Feed; countNew: (type: string) => void;
  patchLocal: (id: string, p: Partial<Note>) => void;
  startRefresh: (id: string) => void; endRefresh: (id: string) => void;
  reload: () => void; setNotice: (m: string) => void;
};

// Used by: useNotesPage → NoteInput's Save. Returns { busy, save }.
export function useSaveNote(o: SaveOpts) {
  const [busy, setBusy] = useState(false);

  // Poll one note until the AI step lands (title/summary/tags/type), then settle once (~20s cap).
  const watchEnrich = (id: string) => {
    let tries = 0;
    const finish = () => { o.endRefresh(id); o.reload(); };
    const tick = async () => {
      tries++;
      let gone = false;
      const n: Note | null = await api(`/notes/${id}`).catch((e: HttpError) => { gone = e?.status === 404; return null; });
      if (gone) { o.feed.drop(id); finish(); return; } // deleted meanwhile
      if (n && n.enrich_state !== "pending") { o.patchLocal(id, n); o.feed.reconcile(n); finish(); return; }
      if (tries >= 16) { finish(); return; } // the reload shows whatever landed
      setTimeout(tick, 1200);
    };
    setTimeout(tick, 1500);
  };

  // Waits for any pending transcript first; the API replies before the AI step runs.
  const save = async () => {
    const v = o.voice;
    if (!o.text.trim() || busy || v.transcribing) return;
    if (v.isRecording()) { v.stopRecorder(true); return; } // let the transcript land first, save after
    if (v.listening) v.stopVoice();
    setBusy(true);
    o.setNotice("");
    try {
      const ids = v.recordingIds();
      const n: Note = await api("/notes", { method: "POST", body: JSON.stringify({ raw_text: o.text, source: ids.length ? "voice" : "typed", recording_ids: ids }) });
      v.clearRecordingIds(); // kept on failure so the next Save still links them
      v.clearRetry();
      o.setText("");
      o.setQuery("");
      o.feed.reconcile(n); // newest-first → top of the list; oldest-first → end, once that's loaded
      o.countNew(n.type || "note");
      if (n?.id) { o.startRefresh(n.id); watchEnrich(n.id); }
    } catch {
      o.setNotice(MSG.saveFailed);
    } finally { setBusy(false); }
  };

  return { busy, save };
}
