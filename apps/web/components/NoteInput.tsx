"use client";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { I } from "./IconButton";
import Waveform from "./Waveform";

type Props = {
  draft: string;
  setDraft: (v: string) => void;
  onSave: () => void;
  busy: boolean;
  listening: boolean;
  transcribing: boolean;
  stream: MediaStream | null;
  onToggleSpeak: () => void;
  onCancelVoice: () => void;
};

// 2 rows min, 6 rows max at 16px × 1.6 line-height.
const MIN = 52, MAX = 154;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const NoteInput = forwardRef<{ focus: () => void }, Props>(function NoteInput(
  { draft, setDraft, onSave, busy, listening, transcribing, stream, onToggleSpeak, onCancelVoice }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [focus, setFocus] = useState(false);
  const [secs, setSecs] = useState(0);
  const voice = listening || transcribing;
  const open = focus || voice;
  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus() }), []);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN), MAX)}px`;
  }, [draft]);

  // Recording clock.
  useEffect(() => {
    if (!listening) return;
    setSecs(0);
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [listening]);

  // Esc cuts, like ChatGPT dictation.
  useEffect(() => {
    if (!voice) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCancelVoice(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [voice, onCancelVoice]);

  return (
    <div className={`rounded-2xl border bg-bg p-3 transition-[border-color,box-shadow] duration-200 ${open ? "border-primary shadow-[0_0_0_4px_var(--primary-100)]" : "border-line hover:border-line-strong"}`}>
      <label htmlFor="draft" className="sr-only">New note</label>
      <div className="relative">
        <textarea id="draft" ref={ta} rows={2} value={draft} onChange={e => setDraft(e.target.value)}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSave(); }}
          readOnly={transcribing}
          placeholder={transcribing ? "" : listening ? "Listening. Keep talking, or type alongside…" : "What's on your mind? Type it, or tap the mic and say it."}
          className="block w-full bg-transparent resize-none text-[15.5px] leading-relaxed outline-none placeholder:text-faint px-1.5 pt-1"
          style={{ minHeight: MIN, maxHeight: MAX }} />
        {transcribing && (
          // Skeleton lines where the transcript will land (after any existing draft text).
          <div className={`anim-fade px-1.5 flex flex-col gap-2 ${draft ? "pb-1" : "absolute inset-x-0 top-2"}`} aria-hidden>
            <div className="skeleton h-3 rounded-full w-[82%]" />
            <div className="skeleton h-3 rounded-full w-[58%]" />
          </div>
        )}
      </div>

      {voice ? (
        <div className="anim-fade flex items-center gap-3 pt-2" role="group" aria-label={transcribing ? "Transcribing" : "Recording"}>
          <button onClick={onCancelVoice} aria-label="Discard recording (Esc)" title="Discard (Esc)"
            className="btn h-10 w-10 rounded-full border border-line text-muted hover:text-danger hover:border-danger hover:bg-danger-50 shrink-0">
            {I.x}
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-3">
            {transcribing ? (
              <p className="flex-1 flex items-center gap-2 text-[13px] text-primary font-medium" role="status">
                <span className="spinner !border-primary-100 !border-t-primary" aria-hidden />
                Transcribing…
              </p>
            ) : (
              <>
                <div className="flex-1 min-w-0"><Waveform stream={stream} active={listening} /></div>
                <span className="text-[12px] text-muted tabular-nums shrink-0" aria-live="off">{mmss(secs)}</span>
              </>
            )}
          </div>
          <button onClick={onToggleSpeak} disabled={transcribing} aria-label="Stop and keep recording" title="Done"
            className={`btn h-10 w-10 rounded-full shrink-0 ${transcribing ? "bg-primary-50 text-primary" : "btn-primary pulse"}`}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect width="12" height="12" rx="2.5" fill="currentColor" /></svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-2">
          <button onClick={onToggleSpeak} aria-label="Record a voice note"
            className="btn h-10 w-10 rounded-xl border border-line text-muted hover:text-primary hover:border-primary-100 hover:bg-primary-50">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button onClick={onSave} disabled={busy || !draft.trim()}
            className="btn btn-primary h-10 px-4 text-[13.5px] ml-auto rounded-xl">
            {busy ? <><span className="spinner" aria-hidden />Saving</> : <>Save note {I.arrow}</>}
          </button>
        </div>
      )}
    </div>
  );
});

export default NoteInput;
