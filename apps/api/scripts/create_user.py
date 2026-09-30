# create_user: sudo make-a-friend.
# Run: python3 scripts/create_user.py <email> <password> (legacy seed; env upsert in main.py covers this now).
import sys
from pathlib import Path
# Let `python scripts/x.py` import core/db as top-level packages (scripts/ isn't a package).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asyncio
from sqlalchemy import text
from core.auth import hash_password
from db.session import Session

async def main(email: str, pw: str):
    # Insert one login user with a bcrypt hash; no-op if the email already exists.
    email = email.strip().lower()
    async with Session() as s:
        await s.execute(
            text("INSERT INTO users (email, password_hash) VALUES (:e, :h) ON CONFLICT (email) DO NOTHING"),
            {"e": email, "h": hash_password(pw)},
        )
        await s.commit()
        print(f"ok: {email}")

# CLI entry: `asyncio.run` because DB + bcrypt helpers are async-first in this codebase.
if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
