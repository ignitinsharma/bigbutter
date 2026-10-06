// useVoice: picks the best voice tier (Wispr → Whisper upload → browser) and drives the mic button.
import { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { canRecord, useRecorder } from "./useRecorder";
import { useLiveDictation, type Fallback } from "./useLiveDictation";

// Best → simplest: live Wispr stream, Whisper upload, browser dictation.
type Tier = "wispr" | "whisper" | "browser";
// The draft (base for transcripts, restored by Cut) and the notice setter.
type VoiceOpts = { text: string; setText: (v: string | ((cur: string) => string)) => void; setNotice: (m: string) => void };

// GET /voice/status → the best tier this server supports.
async function fetchTier(): Promise<Tier> {
  try {
    const st = await api("/voice/status");
    return st?.wispr ? "wispr" : (st?.openai || st?.transcribe === "local") ? "whisper" : "browser";
  } catch { return "browser"; }
}

// Used by: useNotesPage → NoteInput mic button, Save, logout. The tier is fetched once, then remembered.
export function useVoice({ text, setText, setNotice }: VoiceOpts) {
  const [listening, setListening] = useState(false);
  const tier = useRef<Tier | null>(null);
  const voiceBase = useRef(""); // draft before the mic started — Cut restores it
  const discard = useRef(false);
  const recorder = useRecorder({ setText, setNotice, setListening, discard });
  const live = useLiveDictation({ setText, setNotice, setListening, discard });

  // Draft cleared by hand → forget its clips (never linked; the prune job sweeps them).
  useEffect(() => {
    if (!text.trim() && !listening && !recorder.transcribing) recorder.clearRecordingIds();
  }, [text, listening, recorder.transcribing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop live dictation; listening stays on while the upload recorder is still running.
  const stopVoice = () => { live.stop(); if (!recorder.isRecording()) setListening(false); };
  // Step down a tier (remembered for next time) and start it right away.
  const fallback = (to: Fallback) => { tier.current = to; return start(to); };
  // Start one tier; whisper needs MediaRecorder, else it falls to browser dictation.
  const start = (t: Tier): Promise<void> | void => {
    if (t === "wispr") return live.startWispr(text, fallback, () => { tier.current = "browser"; });
    if (t === "whisper") return canRecord() ? recorder.start(text) : fallback("browser");
    return live.startBrowser(text);
  };

  const toggleSpeak = async () => {
    if (recorder.transcribing) return;
    if (listening) { stopVoice(); recorder.stop(true); return; }
    voiceBase.current = text;
    discard.current = false;
    if (!tier.current) tier.current = await fetchTier();
    return start(tier.current);
  };

  // Cut: drop the recording (or the pending transcript) and put the draft back as it was.
  const cancelVoice = () => {
    discard.current = true;
    recorder.abortTranscribe();
    stopVoice();
    recorder.stop(false);
    setListening(false);
    setText(voiceBase.current);
  };

  // Logout: stop everything without transcribing.
  const stopAll = () => { stopVoice(); recorder.stop(false); };
  // Notice "Retry": re-transcribe the clip that failed.
  const retryTranscribe = () => { if (recorder.retryId) recorder.retry(recorder.retryId); };

  return {
    listening, transcribing: recorder.transcribing, micStream: recorder.micStream, retryId: recorder.retryId,
    toggleSpeak, cancelVoice, stopVoice, stopAll, retryTranscribe, stopRecorder: recorder.stop, isRecording: recorder.isRecording,
    recordingIds: recorder.recordingIds, clearRecordingIds: recorder.clearRecordingIds, clearRetry: recorder.clearRetry,
  };
}

export type Voice = ReturnType<typeof useVoice>;
