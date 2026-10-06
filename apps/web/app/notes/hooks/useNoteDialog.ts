// useNoteDialog: which note the Keep-style dialog shows, incl. notes not loaded in the list.
import { useState } from "react";
import type { Note } from "../../../lib/types";
import { noteAnchor } from "../../../components/NoteBoard";

// Used by: useNotesPage. The open note is looked up in the list, then search rows, then `extra`.
export function useNoteDialog(items: Note[], remote: Note[] | null) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [extra, setExtra] = useState<Note | null>(null); // dialog note that isn't loaded in the list
  const dialogNote = openId
    ? (items.find(n => n.id === openId) || remote?.find(n => n.id === openId) || (extra?.id === openId ? extra : null))
    : null;

  // Keep the off-list note fresh when it's edited.
  const patch = (id: string, p: Partial<Note>) => setExtra(x => (x && x.id === id ? { ...x, ...p } : x));
  // Close and hand focus back to the note's card.
  const close = (id: string | null) => {
    setOpenId(null);
    if (id) requestAnimationFrame(() => document.getElementById(noteAnchor(id))?.focus({ preventScroll: true }));
  };

  return { openId, setOpenId, setExtra, dialogNote, patch, close };
}

export type Dialog = ReturnType<typeof useNoteDialog>;
