"""Re-run extraction + embedding for every note (optionally one user's).

Run once after Ollama is up (or keys land) so older notes get category,
keywords, summary and a vector: `python3 scripts/reenrich.py [email]`.
"""
import sys
from pathlib import Path
# Let `python scripts/x.py` import routes/core/db as top-level packages.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asyncio
import time
from sqlalchemy import text
from db.session import Session
from routes.notes import _enrich

async def main(email: str = ""):
    # Backfill extraction + embeddings for old notes (e.g. after Ollama/keys land).
    # Empty email = all users; otherwise scope to one login. Commits per note, prints progress.
    async with Session() as s:
        q = "SELECT n.id, n.user_id, n.raw_text FROM notes n JOIN users u ON u.id = n.user_id"
        rows = (await s.execute(text(q + (" WHERE u.email = :e" if email else "") + " ORDER BY n.created_at"),
                                {"e": email.strip().lower()})).mappings().all()
        for i, r in enumerate(rows, 1):
            t = time.time()  # per-note timer so slow LLM calls show up in the log
            await _enrich(s, str(r["user_id"]), str(r["id"]), r["raw_text"])  # same save-time AI step
            await s.commit()  # per-note commit: a crash keeps earlier notes, rerun resumes rest
            print(f"{i}/{len(rows)} {time.time() - t:.1f}s")

# CLI entry: `python3 scripts/reenrich.py [email]` — email optional, scopes to one user.
if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else ""))
