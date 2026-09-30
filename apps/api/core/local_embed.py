"""Local embeddings engine (all-MiniLM-L6-v2, 384 dims). No API key, works offline.

Model loads once at import (~80MB download on first run to ~/.cache/huggingface).
Dims differ from cloud (1536) on purpose — each engine has its own table.
"""

_model = None

def _model_once():
    # Load the MiniLM model once and reuse it — avoids ~80MB reload per note.
    global _model
    if _model is None:
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
