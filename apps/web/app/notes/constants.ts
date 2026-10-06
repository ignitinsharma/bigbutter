// notes constants: batch size, skeleton shapes, and every notice the notes page can show.

export const BATCH = 30; // notes per scroll batch
export const SKELETON_HEIGHTS = [120, 180, 96, 150, 200, 110, 140, 170]; // first-load masonry placeholders
export const AUDIO_MAX_MB = 25; // mirrors the API's AUDIO_MAX_MB (413 above it)

const API_DOWN = "is the API running?";

export const MSG = {
  transcriptReady: "Transcript ready — review it and hit Save.",
  uploadNotConfigured: "Voice upload isn't configured (no API key).",
  audioSaved: "Couldn't transcribe — your audio is saved.",
  noSpeechInClip: "Transcribed, but no speech was found in that clip.",
  retryFailed: "Still couldn't transcribe — your audio is saved, try again in a bit.",
  micBlocked: "Microphone blocked. Allow mic access in site settings, then try again.",
  noMic: "No microphone found. Check it's plugged in.",
  streamError: "Streaming voice hit an error — falling back to typing.",
  noSpeechApi: "This browser has no speech recognition — try Chrome, or type instead.",
  insecureOrigin: "Dictation is blocked on insecure origins — open this page via localhost or HTTPS.",
  apiOutdated: "The API is out of date — restart it (uvicorn … --reload) to load your notes.",
  apiUnreachable: "Could not reach the API — showing an empty desk. Start the backend and reload.",
  saveFailed: "Save failed — is the API running on :8000?",
  noteGone: "That note no longer exists.",
  copied: "Note text copied.",
  copyBlocked: "Couldn't copy — your browser blocked clipboard access.",
  bucketsFailed: `Couldn't save buckets — ${API_DOWN}`,
  editFailed: `Couldn't save the edit — ${API_DOWN}`,
  colorFailed: `Couldn't save the color — ${API_DOWN}`,
  paletteFailed: `Couldn't save your colors — ${API_DOWN}`,
  typeFailed: `Couldn't save the type — ${API_DOWN}`,
  tagsFailed: `Couldn't save tags — ${API_DOWN}`,
  bucketFailed: `Couldn't save the bucket — ${API_DOWN}`,
  regenFailed: `Couldn't regenerate the summary — ${API_DOWN}`,
  deleteFailed: `Couldn't delete — ${API_DOWN}`,
};

// POST /voice/transcribe error status → notice (anything else: transcribeFailed).
export const TRANSCRIBE_ERRORS: Record<number, string> = {
  413: `Recording too long — keep it under ${AUDIO_MAX_MB} MB.`,
  415: "This browser's audio format isn't supported — try Chrome.",
  501: MSG.uploadNotConfigured,
};
export const TRANSCRIBE_FAILED = "Transcribe failed — check connection and try again.";

// Wispr stream error code → notice (anything else: MSG.streamError).
export const WISPR_ERRORS: Record<string, string> = {
  "not-allowed": MSG.micBlocked,
  "audio-capture": MSG.noMic,
};

// Browser SpeechRecognition error code → notice (anything else: browserStopped(code)).
export const BROWSER_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone blocked. Allow mic access in the browser site settings, then try again.",
  "service-not-allowed": "Dictation is blocked here — use localhost or HTTPS (Chrome disables the mic on insecure origins).",
  "audio-capture": "No microphone found. Check it's plugged in and not used by another app.",
  "no-speech": "Didn't catch that — hit Speak and try again.",
  network: "Speech service unreachable — check connection, VPN, or ad-blocker. Typing still works.",
};
export const browserStopped = (code: string) => `Microphone stopped (${code}). Check permissions and try again.`;
