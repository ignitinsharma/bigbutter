from core.docs import LOCAL_EMBED as __doc__  # module docstring lives in core/docs.py

_model = None

def _model_once():
    # Load the MiniLM model once and reuse it — avoids ~80MB reload per note.
    global _model
    if _model is None:
        # Delayed on purpose: torch + sentence_transformers take seconds and ~GB to load;
        # only paid when EMBED_ENGINE=local actually embeds something.
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model

def embed_local(text: str) -> list[float]:
    # Turn text into a 384-dim vector on-device; raises RuntimeError if model missing.
    try:
        vec = _model_once().encode(text or "")
    except Exception as e:
        raise RuntimeError(f"local embed model unavailable: {e}")
    return [float(x) for x in vec]
