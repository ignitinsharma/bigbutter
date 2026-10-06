# local_whisper: tiny model, big ears, zero API bill.
from core.docs import LOCAL_WHISPER as __doc__  # module docstring lives in core/docs.py
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
