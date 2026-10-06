import sys
from pathlib import Path
# Let `python scripts/x.py` import routes/core/db as top-level packages.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.docs import PRUNE_RECORDINGS as __doc__  # module docstring lives in scripts/docs.py
import asyncio
from sqlalchemy import text
from db.session import engine
from core import storage

async def main(hours: int) -> None:
    async with engine.begin() as c:
        rows = (await c.execute(text(
            "SELECT id, s3_key FROM recordings WHERE note_id IS NULL "
            "AND recorded_at < now() - make_interval(hours => :h)"), {"h": hours})).all()
        if rows and storage.enabled():
            storage.delete([r.s3_key for r in rows])
        if rows:
            await c.execute(text("DELETE FROM recordings WHERE id = ANY(:ids)"), {"ids": [r.id for r in rows]})
    print(f"pruned {len(rows)} unattached recording(s) older than {hours}h")

if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 24))
