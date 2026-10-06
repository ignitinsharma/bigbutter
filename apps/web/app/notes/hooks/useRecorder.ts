// useRecorder: voice tier 2 — record the mic, upload once, review the transcript before saving.
import { useRef, useState, type MutableRefObject } from "react";
import { api } from "../../../lib/api";
import { MSG, TRANSCRIBE_ERRORS, TRANSCRIBE_FAILED } from "../constants";
import type { HttpError } from "../helpers";

// Draft + notice setters from the page, listening flag + Cut ref from useVoice.
type RecorderOpts = {
  setText: (v: string | ((cur: string) => string)) => void;
  setNotice: (m: string) => void;
  setListening: (v: boolean) => void;
  discard: MutableRefObject<boolean>; // Cut pressed → ignore any late audio/transcript
};
// POST /voice/transcribe reply (recording_id is null when the S3 upload failed).
type TranscribeReply = { recording_id?: string; transcript?: string; error?: string };

// True when this browser can record mic audio for upload.
export const canRecord = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

// Name the file by what the browser actually recorded (Safari = mp4, Firefox = ogg).
const audioExt = (mime: string) => (mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm");

// Used by: useVoice. Returns recorder state plus start/stop/retry and the clip ids Save links.
export function useRecorder({ setText, setNotice, setListening, discard }: RecorderOpts) {
  const rec = useRef<MediaRecorder | null>(null);
  const recBase = useRef(""); // draft text before recording; the transcript is appended to it
  const recChunks = useRef<Blob[]>([]);
  const recStart = useRef(0); // performance.now() at record start → duration_ms
  const recIds = useRef<string[]>([]); // S3 clips behind the current draft, linked on Save
  const transcribeCtl = useRef<AbortController | null>(null);
  const [retryId, setRetryId] = useState<string | null>(null); // clip saved but not transcribed
  const [transcribing, setTranscribing] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null); // feeds the waveform

  // Success: remember the clip for Save, append the transcript to the pre-recording draft.
  const onTranscript = (r: TranscribeReply) => {
    if (r?.recording_id) recIds.current.push(r.recording_id);
    if (r?.transcript) {
      const t = r.transcript.trim();
      setText(recBase.current ? `${recBase.current} ${t}`.trim() : t);
      setNotice(MSG.transcriptReady);
    } else if (r?.error === "not_configured") setNotice(MSG.uploadNotConfigured);
  };
  // Failure with the audio stored → offer Retry; otherwise a status-specific notice.
  const onTranscribeError = (e: HttpError) => {
    if (e?.body?.recording_id) { setRetryId(e.body.recording_id); setNotice(MSG.audioSaved); }
    else setNotice(TRANSCRIBE_ERRORS[e?.status ?? 0] ?? TRANSCRIBE_FAILED);
  };

  // Upload the clip; the transcript lands in the (editable) draft.
  const transcribe = (blob: Blob, mime: string) => {
    const fd = new FormData();
    fd.append("audio", blob, `note.${audioExt(mime)}`);
    fd.append("duration_ms", String(Math.round(performance.now() - recStart.current)));
    const ctl = new AbortController();
    transcribeCtl.current = ctl;
    setTranscribing(true);
    api("/voice/transcribe", { method: "POST", body: fd, signal: ctl.signal }).then(
      (r: TranscribeReply) => { if (!ctl.signal.aborted) onTranscript(r); },
      (e: HttpError) => { if (!ctl.signal.aborted) onTranscribeError(e); },
    ).finally(() => {
      if (transcribeCtl.current === ctl) { transcribeCtl.current = null; setTranscribing(false); }
    });
  };

  // Ask for the mic and start recording; `text` is the draft to append the transcript to.
  const start = async (text: string) => {
    setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recBase.current = text;
      recChunks.current = [];
      setMicStream(stream);
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = e => { if (e.data.size) recChunks.current.push(e.data); };
      rec.current = mr;
      mr.start();
      recStart.current = performance.now();
      setListening(true);
    } catch {
      setNotice(MSG.micBlocked);
    }
  };

  // Stop recording; commit=true transcribes the audio into the draft.
  const stop = (commit: boolean) => {
    const mr = rec.current;
    rec.current = null;
    if (!mr) return;
    setMicStream(null);
    mr.onstop = () => {
      try { mr.stream.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
      if (!commit || discard.current) { setListening(false); return; }
      const mime = mr.mimeType || "audio/webm";
      const blob = new Blob(recChunks.current, { type: mime });
      recChunks.current = [];
      setListening(false);
      if (blob.size) transcribe(blob, mime);
    };
    try { mr.stop(); } catch { setListening(false); }
  };

  // Retry a clip whose transcription failed — the API pulls the audio back from S3.
  const retry = async (id: string) => {
    if (transcribing) return;
    setTranscribing(true);
    try {
      const r = await api(`/voice/recordings/${id}/retry`, { method: "POST", body: "{}" });
      const t = (r?.transcript || "").trim();
      if (t) setText(cur => (cur.trim() ? `${cur.trim()} ${t}` : t));
      if (!recIds.current.includes(id)) recIds.current.push(id);
      setRetryId(null);
      setNotice(t ? MSG.transcriptReady : MSG.noSpeechInClip);
    } catch {
      setNotice(MSG.retryFailed);
    } finally { setTranscribing(false); }
  };

  // Small accessors for useVoice / useSaveNote (refs, so always current).
  const abortTranscribe = () => { transcribeCtl.current?.abort(); transcribeCtl.current = null; setTranscribing(false); };
  const isRecording = () => !!rec.current;
  const recordingIds = () => recIds.current;
  const clearRecordingIds = () => { recIds.current = []; };
  const clearRetry = () => setRetryId(null);

  return { transcribing, micStream, retryId, start, stop, retry, abortTranscribe, isRecording, recordingIds, clearRecordingIds, clearRetry };
}
