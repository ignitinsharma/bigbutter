// useNoteActions: open/close the dialog, delete, copy, and save the bucket list.
import { api } from "../../../lib/api";
import type { Note } from "../../../lib/types";
import type { NoteEdits } from "../../../components/NoteDialog";
import { MSG } from "../constants";
import type { HttpError } from "../helpers";
import type { Feed } from "./useNotesFeed";
import type { Search } from "./useSearch";
import type { Dialog } from "./useNoteDialog";
import type { Edits } from "./useNoteEdits";

// Everything the dialog, delete, copy and bucket-save flows touch.
type ActionOpts = {
  feed: Feed; search: Search; dialog: Dialog; edits: Edits; shown: Note[];
  bucket: string | null; setBucket: (b: string | null) => void; setSel: (id: string | null) => void; refetchList: () => void;
  patchLocal: (id: string, p: Partial<Note>) => void; reload: () => void;
  setNotice: (m: string) => void; authFail: (e: HttpError) => boolean;
};

// Used by: useNotesPage → NoteBoard, NoteDialog, BucketChips and the map panel.
export function useNoteActions(o: ActionOpts) {
  // Open the dialog; a note that isn't loaded in the list (map panel, connected note) is fetched.
  // Always pulls the fresh row: list rows don't carry voice recordings, GET /notes/{id} does.
  const openNote = (id: string) => {
    o.dialog.setOpenId(id);
    const onPage = [...o.feed.items, ...(o.search.remote || [])].some(n => n.id === id);
    api(`/notes/${id}`).then(
      (n: Note) => (onPage ? o.patchLocal(id, n) : o.dialog.setExtra(n)),
      () => { if (!onPage) { o.dialog.setOpenId(null); o.setNotice(MSG.noteGone); } },
    );
  };

  // Dialog closed (or hopped to a connected note): save title/text edits, hand focus back to the card.
  const closeNote = (edits: NoteEdits, next?: string) => {
    const id = o.dialog.openId;
    if (id && (edits.title !== undefined || edits.raw_text !== undefined)) o.edits.mutate(id, edits, { ...edits }, MSG.editFailed);
    if (next) { openNote(next); return; }
    o.dialog.close(id);
  };

  // Optimistic delete: gone from the list at once, restored in place if the API refuses.
  const remove = async (id: string) => {
    if (o.dialog.openId === id) o.dialog.setOpenId(null);
    o.setSel(null);
    const at = o.feed.items.findIndex(n => n.id === id);
    const gone = at >= 0 ? o.feed.items[at] : null;
    o.feed.drop(id);
    o.search.drop(id);
    try { await api(`/notes/${id}`, { method: "DELETE" }); }
    catch {
      o.setNotice(MSG.deleteFailed);
      if (gone) o.feed.restore(at, gone); // not deleted: put it back where it was
    }
    o.reload(); // counts + map
  };

  // Copy a card's raw text from whatever list is on screen (stream or search).
  const copyNote = async (id: string) => {
    const n = o.shown.find(x => x.id === id);
    if (!n) return;
    try { await navigator.clipboard.writeText(n.raw_text); o.setNotice(MSG.copied); }
    catch { o.setNotice(MSG.copyBlocked); }
  };

  // Bucket manager: save the list, keep the active filter pointing at the same bucket, refetch notes.
  const saveBuckets = async (names: string[], renames: Record<string, string>) => {
    try {
      const r: { buckets: string[] } = await api("/buckets", { method: "PUT", body: JSON.stringify({ buckets: names, renames }) });
      if (o.bucket && !r.buckets.includes(renames[o.bucket] ?? o.bucket)) o.setBucket(null);
      else if (o.bucket && renames[o.bucket]) o.setBucket(renames[o.bucket]);
      o.refetchList();
      o.reload();
    } catch (e) {
      if (!o.authFail(e as HttpError)) o.setNotice(MSG.bucketsFailed);
    }
  };

  return { openNote, closeNote, remove, copyNote, saveBuckets };
}
