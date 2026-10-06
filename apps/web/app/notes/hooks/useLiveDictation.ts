// useLiveDictation: voice tiers 1 (Wispr streaming) and 3 (browser SpeechRecognition), typed straight into the draft.
import { useRef, type MutableRefObject } from "react";
import { api } from "../../../lib/api";
import { createVoice, supported as srSupported } from "../../../lib/voice";
import { createWisprVoice, supported as wisprSupported } from "../../../lib/voice-wispr";
import { BROWSER_ERRORS, MSG, WISPR_ERRORS, browserStopped } from "../constants";

// Draft + notice setters from the page, listening flag + Cut ref from useVoice.
type LiveOpts = {
  setText: (v: string) => void;
  setNotice: (m: string) => void;
  setListening: (v: boolean) => void;
  discard: MutableRefObject<boolean>; // Cut pressed → ignore late text
};
// Both lib/voice.ts and lib/voice-wispr.ts return this shape.
type Engine = { start: () => void; stop: () => void };
// Where Wispr steps down to when it can't start.
export type Fallback = "browser" | "whisper";

// Used by: useVoice. Returns { startWispr, startBrowser, stop }.
export function useLiveDictation({ setText, setNotice, setListening, discard }: LiveOpts) {
  const voice = useRef<{ stop: () => void } | null>(null);
  // Start an engine and track it; ended() is the common onEnd/onError cleanup.
  const run = (v: Engine) => { voice.current = v; v.start(); setListening(true); };
  const ended = () => { voice.current = null; setListening(false); };
  // Live text replaces the draft unless Cut was pressed.
  const onText = (t: string) => { if (!discard.current) setText(t); };

  // Tier 1: any failure before streaming steps down via fallback; a stream error demotes to browser next time.
  const startWispr = async (text: string, fallback: (to: Fallback) => void, demote: () => void) => {
    if (!wisprSupported()) return fallback("browser");
    setNotice("");
    let tok: { access_token?: string; ws_url?: string };
    try { tok = await api("/voice/token", { method: "POST", body: "{}" }); }
    catch { return fallback("whisper"); }
    if (!tok?.access_token) return fallback("whisper");
    run(createWisprVoice({
      token: tok.access_token, wsUrl: tok.ws_url || "", base: text, onText, onEnd: ended,
      onError: code => { ended(); setNotice(WISPR_ERRORS[code] ?? MSG.streamError); demote(); },
    }));
  };

  // Tier 3: free browser dictation (no server round-trip).
  const startBrowser = (text: string) => {
    if (!srSupported()) { setNotice(MSG.noSpeechApi); return; }
    if (!window.isSecureContext) { setNotice(MSG.insecureOrigin); return; }
    setNotice("");
    run(createVoice({
      base: text, onText, onEnd: ended,
      onError: code => { ended(); setNotice(BROWSER_ERRORS[code] ?? browserStopped(code)); },
    }));
  };

  // Stop the live engine without touching any recording.
  const stop = () => {
    try { voice.current?.stop(); } catch { /* already stopped */ }
    voice.current = null;
  };

  return { startWispr, startBrowser, stop };
}
