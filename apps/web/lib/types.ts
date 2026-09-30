export type NoteType = "idea" | "task" | "note" | "person" | "link" | "expense" | "journal";

export const TYPES: Record<NoteType, { label: string; hue: string; bg: string }> = {
  idea: { label: "Idea", hue: "#B26B00", bg: "#FFF4E0" },
  task: { label: "Task", hue: "#1F7A8C", bg: "#E4F4F7" },
  note: { label: "Note", hue: "#4B5565", bg: "#EEF0F4" },
  person: { label: "Person", hue: "#2F8A57", bg: "#E5F5EC" },
  link: { label: "Link", hue: "#2C6FD1", bg: "#E7F0FD" },
  expense: { label: "Expense", hue: "#C2462E", bg: "#FDECE8" },
  journal: { label: "Journal", hue: "#C23A78", bg: "#FCE9F2" },
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
  created_at?: string;
  related?: Related[]; // linked notes across all pages, computed server-side
};

export type Related = { id: string; title: string; shared: string[] };

// GET /notes?page&per&sort&type
export type NotesPage = { items: Note[]; total: number; page: number; per: number; pages: number };

// GET /notes/stats
export type NoteStats = { total: number; counts: Record<string, number>; connections: number };

// Pill tint derived from the hue so it reads in both themes.
export const tint = (hue: string, pct = 14) => `color-mix(in srgb, ${hue} ${pct}%, transparent)`;
