"use client";

type Props = {
  draft: string;
  setDraft: (v: string) => void;
  onSave: () => void;
  busy: boolean;
  listening: boolean;
  onToggleSpeak: () => void;
};

export default function NoteInput({ draft, setDraft, onSave, busy, listening, onToggleSpeak }: Props) {
  return (
    <div className="rounded bg-card border border-line p-4 mb-4">
      <textarea id="draft" rows={5} value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSave(); }}
        placeholder={listening ? "Listening — keep talking, or keep typing…" : "Type the thought, or hit Speak and say it"}
        className="field w-full bg-transparent resize-y font-sans text-[15px] leading-relaxed outline-none placeholder:text-faint border border-line rounded px-3 py-2" />
      <div className="flex gap-2 mt-3">
        <button onClick={onToggleSpeak}
          className={`btn-press rounded text-[13px] font-medium px-4 py-2 ${listening ? "pulse text-white" : "bg-[#E5E1D6] text-[#4A4437]"}`}
          style={listening ? { background: "#8A3C56" } : undefined}>
          {listening ? "Stop" : "Speak"}
        </button>
        <button onClick={onSave} disabled={busy || !draft.trim()}
          className="btn-press flex-1 rounded text-[13px] font-medium px-4 py-2 bg-ink text-card disabled:opacity-40">
          {busy ? "Filing…" : "Save"}
        </button>
      </div>
    </div>
  );
}
