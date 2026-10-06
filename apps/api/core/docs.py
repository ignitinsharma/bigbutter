# core docs: the long file-top overviews for core/*, kept here so each module stays lean.

# Used by: core/storage.py (module docstring).
STORAGE = """S3 helpers for voice recordings — the only module that talks to AWS.

Layout: one private bucket (Block Public Access on), keys
recordings/<user-id>/<yyyy>/<mm>/<recording-id>.<ext>, encrypted at rest (SSE-S3).
The browser never talks to S3: audio goes browser → API → S3, and playback uses
presigned links the API hands out.

DB keeps per clip (table `recordings`): s3_key, s3_url (permanent address, not
openable — bucket is private), presigned_url (playable, 7 days) + its expiry.
Stored links are re-signed on read when <1h is left or the signing key changed.

Sync boto3 on purpose: routes call these through run_in_threadpool so the
upload runs alongside transcription without blocking the event loop.
"""

# Used by: core/buckets.py (module docstring).
BUCKETS = """Buckets: a small, closed set of life areas every note lands in exactly one of.

The LLM picks from the user's list (EXTRACT_PROMPT); anything off-list falls back to
MiniLM similarity against each bucket's description, then to Other. Tags and
category stay free-text underneath — buckets are the stable top level.
"""

# Used by: core/local_embed.py (module docstring).
LOCAL_EMBED = """Local embeddings engine (all-MiniLM-L6-v2, 384 dims). No API key, works offline.

Model loads once at import (~80MB download on first run to ~/.cache/huggingface).
Dims differ from cloud (1536) on purpose — each engine has its own table.
"""

# Used by: core/local_extract.py (module docstring).
LOCAL_EXTRACT = """Rule-based extraction fallback (zero deps, zero key).

Rough but deterministic: keyword/type regexes, frequency tags reusing known
ones, capitalised-word people, first-sentence title/summary. Anything the
cloud extractor would do better is clearly its job on keys day.
"""

# Used by: core/local_whisper.py (module docstring).
LOCAL_WHISPER = """Local Whisper engine (tiny, M1-friendly). No API key, works offline.

Model loads once at import (~75MB download on first run to ~/.cache/whisper).
fp16=False: required on CPU/MPS paths to avoid garbage output.
"""

# Used by: every module with function docstrings — attaches the text kept in a docs.py file.
# On FastAPI routes keep @doc directly above `def` (under @router.*): routes read __doc__ at registration.
def doc(text: str):
    def wrap(fn):
        fn.__doc__ = text
        return fn
    return wrap

# ---- function docstrings ----

# Used by: core/buckets.py normalize().
BUCKETS_NORMALIZE = """The user's list (NULL → defaults), de-duped case-insensitively, capped,
with Other always present and last."""

# Used by: core/buckets.py pick_by_vector().
BUCKETS_PICK_BY_VECTOR = """No-LLM fallback: the bucket whose description is closest to the note's MiniLM
vector. Custom buckets are described by their name alone. Below min_sim → Other.
Raises RuntimeError when the local model is missing (caller falls back to Other)."""

# Used by: core/openai_client.py llm().
OPENAI_CLIENT_LLM = """Chat client + model for LLM_ENGINE. Local = Ollama's OpenAI-compatible /v1,
so OpenAI day is an env flip. Off → NotConfigured (callers fail open)."""

# Used by: core/openai_client.py _chat_json().
OPENAI_CLIENT_CHAT_JSON = """One JSON-mode completion, one retry on bad JSON. Unreachable runtime or
unparseable output → NotConfigured so every caller keeps its fallback."""

# Used by: core/openai_client.py _junk_title().
OPENAI_CLIENT_JUNK_TITLE = """Small local models echo the schema ("under 8 words") or answer with the
type ("task"). Titles like that — or ones sharing no word stem with the
capture — fall back to the rule title (first words of the note)."""

# Used by: core/openai_client.py _junk_summary().
OPENAI_CLIENT_JUNK_SUMMARY = """Models sometimes return the schema placeholder ("1-2 short sentences, fix
grammar, invent nothing") as the summary — fall back to the rule summary."""

# Used by: core/openai_client.py core_query().
OPENAI_CLIENT_CORE_QUERY = """The user's own subject words: "notes related to mobile phones" → "mobile phones".
Deterministic, model-independent; falls back to the query when nothing's left."""

# Used by: core/openai_client.py _on_topic().
OPENAI_CLIENT_ON_TOPIC = """LLM output is usable if it isn't pure filler and shares a word stem with the query."""

# Used by: core/openai_client.py judge().
OPENAI_CLIENT_JUDGE = """Relevance check for borderline search hits: the ids (from `notes`) the LLM says fit the
search. Answers are ids like "n3" (a bare 3 is read the same way); unknown ids are ignored,
so the model can only remove candidates, never add notes. A reply without a "relevant" list
raises NotConfigured, so the caller shows the unchecked result instead of guessing."""

# Used by: core/storage.py needs_resign().
STORAGE_NEEDS_RESIGN = """Stored links die at expiry — and immediately if the signing key is rotated/deleted.
True when missing, expiring within RESIGN_MARGIN, or signed by a different key than ours."""
