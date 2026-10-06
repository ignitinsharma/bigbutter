# scripts docs: the long file-top overviews for scripts/*, kept here so each script stays lean.

# Used by: scripts/prune_recordings.py (module docstring).
PRUNE_RECORDINGS = """Sweep voice clips never attached to a note (cancelled drafts, crashed uploads).

DB-driven: only rows with note_id IS NULL older than N hours are
touched, so audio behind a saved note can never be deleted. S3 object first,
then the row; deleting a key that never made it to S3 is a no-op.

Run: `python3 scripts/prune_recordings.py [hours=24]` (manually or from cron).
"""

# Used by: scripts/reenrich.py (module docstring).
REENRICH = """Re-run extraction + embedding for every note (optionally one user's).

Run once after Ollama is up (or keys land) so older notes get category,
keywords, summary and a vector: `python3 scripts/reenrich.py [email]`.
`--buckets` only (re)picks the bucket of notes the user hasn't set by hand —
titles, tags and summaries you edited stay as they are.
"""
