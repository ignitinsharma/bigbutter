// notes helpers: small pure functions shared by the notes hooks.
import type { Note, NoteType } from "../../lib/types";
import type { Sort } from "../../components/SortMenu";
import { bucketOf } from "../../lib/buckets";
import { BATCH } from "./constants";

export type TypeFilter = "all" | NoteType;
export type HttpError = { status?: number; name?: string; body?: { error?: string; recording_id?: string } };

// Creation time in ms (0 when missing) — the sort key for every list.
export const createdMs = (n: Note) => (n.created_at ? new Date(n.created_at).getTime() : 0);

// Does a note belong in the current type + bucket filter?
export const matchesView = (n: Note, filter: TypeFilter, bucket: string | null) =>
  (filter === "all" || (n.type || "note") === filter) && (!bucket || bucketOf(n.bucket) === bucket);

// Query string for one GET /notes batch.
export const listQuery = (sort: Sort, filter: TypeFilter, bucket: string | null, cursor?: string) =>
  new URLSearchParams({
    per: String(BATCH), sort, ...(cursor ? { cursor } : {}),
    ...(filter !== "all" ? { type: filter } : {}), ...(bucket ? { bucket } : {}),
  });
