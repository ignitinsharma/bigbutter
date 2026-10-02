export type NoteType = "idea" | "task" | "note" | "person" | "link" | "expense" | "journal";

// Colors are CSS tokens (globals.css --t-*) so every type re-themes in dark mode.
const tok = (k: NoteType, label: string) => ({ label, hue: `var(--t-${k})`, bg: `var(--t-${k}-bg)`, line: `var(--t-${k}-line)` });

export const TYPES: Record<NoteType, { label: string; hue: string; bg: string; line: string }> = {
  idea: tok("idea", "Idea"),
  task: tok("task", "Task"),
  note: tok("note", "Note"),
  person: tok("person", "Person"),
  link: tok("link", "Link"),
  expense: tok("expense", "Expense"),
  journal: tok("journal", "Journal"),
};

export type Note = {
  id: string;
  raw_text: string;
  title?: string;
  type?: NoteType;
  summary?: string;
  tags?: string[];
  people?: string[];
  action_items?: string[];
  category?: string;
  keywords?: string[];
  color?: string;
  enrich_state?: "pending" | "done"; // "pending" right after save until the background AI step lands      // "" = type default, a preset key (lib/colors.ts), or "#rrggbb"
  created_at?: string;
  updated_at?: string;
  related?: Related[];
  // Voice clips (audio in S3), GET /notes/{id} only. presigned_url is a 7-day bearer link, re-signed server-side when stale.
  recordings?: {
    id: string; duration_ms: number; recorded_at: string; uploaded_at: string;
    s3_url: string; presigned_url: string; presigned_expires_at: string;
  }[]; // linked notes across all pages, computed server-side
};

export type Related = { id: string; title: string; shared: string[] };

// GET /notes?per&sort&type[&cursor] — next_cursor is null on the last batch (page fields only without a cursor)
export type NotesPage = { items: Note[]; next_cursor?: string | null; total?: number; page?: number; per?: number; pages?: number };

// GET /notes/stats
export type NoteStats = { total: number; counts: Record<string, number>; connections: number };

// Pill tint derived from the hue so it reads in both themes.
export const tint = (hue: string, pct = 14) => `color-mix(in srgb, ${hue} ${pct}%, transparent)`;
