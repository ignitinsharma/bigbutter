# routes docs: the long file-top overviews for routes/*, kept here so each module stays lean.

# Used by: routes/voice.py (module docstring).
VOICE = """Voice → text, with the audio kept in S3 (core/storage.py).

Flow (Whisper upload tier, notes/page.tsx):
  stop recording → POST /voice/transcribe (audio + duration_ms)
    ├ store():  S3 upload → INSERT recordings row (s3_url, presigned_url, uploaded_at …)
    └ Whisper on the same bytes                       ← both run in parallel
  → {transcript, recording_id} → draft → Save (POST /notes) links the clip to the note
  → BackgroundTask _finalize writes status + transcript onto the row.
Failure rules: upload fails → no row, transcript still returned (recording_id null);
row insert fails → uploaded object deleted; Whisper fails but audio stored → 502 with
recording_id so the UI offers Retry (POST /voice/recordings/{id}/retry reads it back).
Playback: GET /notes/{id} returns each clip's stored 7-day link, re-signed when stale.
"""

# ---- function docstrings ----

# Used by: routes/notes.py get_palette().
NOTES_GET_PALETTE = """Custom swatches the user added from the note palette."""

# Used by: routes/notes.py put_buckets().
NOTES_PUT_BUCKETS = """Save the list. Renamed buckets keep their notes (and locks); notes left in a bucket
that no longer exists move to Other and unlock, so the next edit can re-bucket them."""

# Used by: routes/notes.py _embed_text().
NOTES_EMBED_TEXT = """Vector input carries the resolved sense, so "Apple … mobile" lands near
phones and "Apple … fruit" near food even though both say "Apple"."""

# Used by: routes/notes.py _compute().
NOTES_COMPUTE = """The slow, DB-free half: LLM structuring + embedding. Each fails open independently:
LLM extract needs LLM_ENGINE reachable (Ollama or key, else rule-based), cloud
embed needs a key (else local MiniLM when EMBED_ENGINE=local, else no vector).
Bucket: the LLM's pick from the list, else nearest bucket by MiniLM, else Other."""

# Used by: routes/notes.py _store().
NOTES_STORE = """Persist the structured record (keywords as CSV) + upsert the vector (re-embed on edit overwrites).
Hand-set title/type/tags/bucket stick. Skipped entirely when the note's text changed while
the AI was thinking — results for old text must not land on new text."""

# Used by: routes/notes.py _enrich_later().
NOTES_ENRICH_LATER = """Never holds a DB connection while the LLM thinks: queued enrichments used to pin pool
connections, forcing new requests to open fresh TLS connections to Neon (seconds each).
Always ends 'done' so the UI stops waiting."""

# Used by: routes/notes.py create().
NOTES_CREATE = """Store the note (+ link its voice clips, + a random preset color) in one statement and reply; AI enrichment runs after."""

# Used by: routes/notes.py _related().
NOTES_RELATED = """Up to 5 linked notes per page item, across ALL the user's notes — one query for the page."""

# Used by: routes/notes.py lst().
NOTES_LST = """One batch of notes (newest or oldest first, optional type/bucket filter) + related notes per item."""

# Used by: routes/notes.py stats().
NOTES_STATS = """Totals for the navbar + filter chips, independent of the page being viewed."""

# Used by: routes/notes.py one().
NOTES_ONE = """A single note (+ related + voice clips) — refreshes one row in place after an edit."""

# Used by: routes/search_map.py _query_vec().
SEARCH_MAP_QUERY_VEC = """(vector literal, table) for the active embed engine, or None when unavailable."""

# Used by: routes/search_map.py mmap().
SEARCH_MAP_MMAP = """Tag/person/category graph. `ids` (comma-separated) scopes it to a search's
hits: only those nodes, edges among them, degree recomputed inside."""

# Used by: routes/voice.py transcribe_audio().
VOICE_TRANSCRIBE_AUDIO = """Store the clip in S3 and transcribe it at the same time; returns text + recording id."""

# Used by: routes/voice.py retry().
VOICE_RETRY = """Re-transcribe a stored clip — pulls the audio back from S3."""

# Used by: routes/voice.py mint_token().
VOICE_MINT_TOKEN = """Mint a short-lived Wispr client token. Org key never leaves the backend."""
