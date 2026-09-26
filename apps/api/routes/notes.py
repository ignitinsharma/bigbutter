from fastapi import APIRouter, Request, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from db.session import get_session
from core.auth import read_token

router = APIRouter()

async def me(req: Request, s: AsyncSession = Depends(get_session)):
    uid = read_token(req.cookies.get("session", ""))
    if not uid:
        from fastapi import HTTPException
        raise HTTPException(401)
    return uid

class NoteIn(BaseModel):
    raw_text: str
    source: str = "typed"

@router.post("/notes")
async def create(n: NoteIn, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    # Task 3 wires extraction+embedding here; Task 2 stores raw only
    row = (await s.execute(
        text("INSERT INTO notes (user_id, raw_text, source) VALUES (:u,:t,:s) RETURNING id"),
        {"u": uid, "t": n.raw_text, "s": n.source},
    )).mappings().first()
    await s.commit()
    return {"id": str(row["id"])}

@router.get("/notes")
async def lst(uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    rows = (await s.execute(
        text("SELECT id, raw_text, title, type, summary, tags, people, action_items, created_at FROM notes WHERE user_id=:u ORDER BY created_at DESC"),
        {"u": uid},
    )).mappings().all()
    return [dict(r) for r in rows]

@router.put("/notes/{nid}")
async def upd(nid: str, n: NoteIn, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    await s.execute(text("UPDATE notes SET raw_text=:t, updated_at=now() WHERE id=:i AND user_id=:u"), {"t": n.raw_text, "i": nid, "u": uid})
    await s.commit()
    return {"ok": True}

@router.delete("/notes/{nid}")
async def rm(nid: str, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    await s.execute(text("DELETE FROM notes WHERE id=:i AND user_id=:u"), {"i": nid, "u": uid})
    await s.commit()
    return {"ok": True}
