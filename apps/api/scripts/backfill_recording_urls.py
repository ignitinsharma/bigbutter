"""Fill s3_url / presigned_url / presigned_expires_at / uploaded_at on recordings missing them.

Idempotent: only touches rows with a NULL in any of the four columns. Needs S3
configured (presigning uses the AWS keys). Part of migration 009 (both phases).
Run: `python3 scripts/backfill_recording_urls.py`
"""
import sys
from pathlib import Path
# Let `python scripts/x.py` import routes/core/db as top-level packages.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asyncio
from sqlalchemy import text
from db.session import engine
from core import storage

async def main() -> None:
    if not storage.enabled():
        sys.exit("S3 not configured — set S3_BUCKET + AWS keys in .env first")
    async with engine.begin() as c:
        rows = (await c.execute(text(
            "SELECT id, s3_key FROM recordings WHERE s3_url IS NULL OR presigned_url IS NULL "
            "OR presigned_expires_at IS NULL OR uploaded_at IS NULL"))).all()
        for r in rows:
            url, exp = storage.presign_get(r.s3_key)
            await c.execute(text(
                "UPDATE recordings SET s3_url=coalesce(s3_url, :su), presigned_url=:pu, presigned_expires_at=:pe, "
                "uploaded_at=coalesce(uploaded_at, recorded_at) WHERE id=:i"),
                {"su": storage.object_url(r.s3_key), "pu": url, "pe": exp, "i": r.id})
    print(f"backfilled {len(rows)} recording(s)")

if __name__ == "__main__":
    asyncio.run(main())
