import sys
from pathlib import Path
# Let `python scripts/x.py` import routes/core/db as top-level packages.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.docs import REENRICH as __doc__  # module docstring lives in scripts/docs.py
import asyncio
import time
from sqlalchemy import text
from db.session import Session
from routes.notes import _enrich, _known_terms, _compute

async def buckets_only(email: str = ""):
    # Bucket backfill: same pick as save time, writes only notes.bucket (skips hand-picked ones).
    async with Session() as s:
        q = "SELECT n.id, n.user_id, n.raw_text FROM notes n JOIN users u ON u.id = n.user_id WHERE NOT n.bucket_locked"
        rows = (await s.execute(text(q + (" AND u.email = :e" if email else "") + " ORDER BY n.created_at"),
                                {"e": email.strip().lower()})).mappings().all()
        terms = {}
        for i, r in enumerate(rows, 1):
            uid = str(r["user_id"])
            if uid not in terms:
                terms[uid] = await _known_terms(s, uid)
            rec, _ = await _compute(r["raw_text"], *terms[uid])
            await s.execute(text("UPDATE notes SET bucket=:b WHERE id=:i AND NOT bucket_locked"), {"b": rec["bucket"], "i": r["id"]})
            await s.commit()
            print(f"{i}/{len(rows)} {rec['bucket']:<12} {r['raw_text'][:50]!r}")

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

# CLI entry: `python3 scripts/reenrich.py [--buckets] [email]` — email optional, scopes to one user.
if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--buckets"]
    run = buckets_only if "--buckets" in sys.argv else main
    asyncio.run(run(args[0] if args else ""))
