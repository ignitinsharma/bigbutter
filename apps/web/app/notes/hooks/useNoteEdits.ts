// useNoteEdits: optimistic PUT /notes/{id} edits, then the server's fresh row.
import { api } from "../../../lib/api";
import type { Note, NoteType } from "../../../lib/types";
import { MSG } from "../constants";
import type { HttpError } from "../helpers";
import type { Feed } from "./useNotesFeed";

// Fields PUT /notes/{id} accepts (title/type/tags/bucket lock against re-enrichment server-side).
export type EditBody = Partial<Pick<Note, "raw_text" | "title" | "type" | "tags" | "color" | "bucket">>;
// Local updaters + refresh tracking from useNotesPage.
type EditOpts = {
  feed: Feed;
  patchLocal: (id: string, p: Partial<Note>) => void;
  startRefresh: (id: string) => void;
  endRefresh: (id: string) => void;
  reload: () => void;
  setNotice: (m: string) => void;
};

// Used by: useNotesPage → NoteBoard + NoteDialog. One generic mutate plus a named shortcut per field.
export function useNoteEdits(o: EditOpts) {
  // Optimistic patch → PUT → pull the fresh row; on failure, restore the server's version.
  const mutate = async (id: string, body: EditBody, patch: Partial<Note>, fail: string) => {
    o.patchLocal(id, patch);
    const enrich = body.raw_text !== undefined; // text edits re-run AI — show "refreshing" until the row is back
    if (enrich) o.startRefresh(id);
    try {
      await api(`/notes/${id}`, { method: "PUT", body: JSON.stringify(body) });
      // Edits re-enrich server-side (title/summary/tags/related change) — pull the fresh row.
      const fresh: Note | null = await api(`/notes/${id}`).catch(() => null);
      if (fresh) { o.patchLocal(id, fresh); o.feed.reconcile(fresh); } // a type change may leave this filter
      o.reload(); // counts + map
    } catch {
      o.setNotice(fail);
      // Put the server's version back over the optimistic patch (or drop it if it's gone).
      api(`/notes/${id}`).then(
        (n: Note) => { o.patchLocal(id, n); o.feed.reconcile(n); },
        (e: HttpError) => { if (e?.status === 404) o.feed.drop(id); },
      );
      o.reload();
    }
    finally { if (enrich) o.endRefresh(id); }
  };

  return {
    mutate,
    setType: (id: string, type: NoteType) => mutate(id, { type }, { type }, MSG.typeFailed),
    setTags: (id: string, tags: string[]) => mutate(id, { tags }, { tags }, MSG.tagsFailed),
    setBucket: (id: string, bucket: string) => mutate(id, { bucket }, { bucket }, MSG.bucketFailed),
    setColor: (id: string, color: string) => mutate(id, { color }, { color }, MSG.colorFailed),
    regenerate: (n: Note) => mutate(n.id, { raw_text: n.raw_text }, {}, MSG.regenFailed),
  };
}

export type Edits = ReturnType<typeof useNoteEdits>;
