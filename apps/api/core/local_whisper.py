# local_whisper: tiny model, big ears, zero API bill.
"""Local Whisper engine (tiny, M1-friendly). No API key, works offline.

Model loads once at import (~75MB download on first run to ~/.cache/whisper).
fp16=False: required on CPU/MPS paths to avoid garbage output.
"""

import whisper

_model = None

def _model_once():
    # Load the Whisper tiny model once and reuse it across transcriptions.
    global _model
    if _model is None:
        _model = whisper.load_model("tiny")
    return _model

def transcribe_local(path: str) -> str:
    # Transcribe an audio file on-device with Whisper tiny (English, CPU-safe).
    result = _model_once().transcribe(path, fp16=False, language="en")
    return (result.get("text") or "").strip()
