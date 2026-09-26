export type NoteType = "idea" | "task" | "note" | "person" | "link" | "expense" | "journal";

export const TYPES: Record<NoteType, { label: string; hue: string; bg: string }> = {
  idea: { label: "Idea", hue: "#8A5A00", bg: "#F6EBD2" },
  task: { label: "Task", hue: "#5B3A7E", bg: "#EDE4F5" },
  note: { label: "Note", hue: "#3F4B5B", bg: "#E3E8EE" },
  person: { label: "Person", hue: "#3F6B4A", bg: "#E0EDE2" },
  link: { label: "Link", hue: "#1F5E77", bg: "#DDEDF3" },
  expense: { label: "Expense", hue: "#8C4426", bg: "#F7E4DA" },
  journal: { label: "Journal", hue: "#8A3C56", bg: "#F7E1E8" },
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
  created_at?: string;
};
