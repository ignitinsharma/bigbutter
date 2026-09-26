import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asyncio
from sqlalchemy import text
from core.auth import hash_password
from db.session import Session

async def main(email: str, pw: str):
    async with Session() as s:
        await s.execute(
            text("INSERT INTO users (email, password_hash) VALUES (:e, :h) ON CONFLICT (email) DO NOTHING"),
            {"e": email, "h": hash_password(pw)},
        )
        await s.commit()
        print(f"ok: {email}")

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
