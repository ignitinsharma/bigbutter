from fastapi import APIRouter, Request, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from db.session import get_session
from core.auth import read_token
from core.config import settings
from core.openai_client import extract_note, embed, NotConfigured, NOTE_TYPES
from core.local_extract import local_extract
from core.local_embed import embed_local

router = APIRouter()

async def me(req: Request, s: AsyncSession = Depends(get_session)):
    uid = read_token(req.cookies.get("session", ""))
    if not uid:
        raise HTTPException(401)
    return uid

async def _known_tags(s: AsyncSession, uid: str) -> list:
    rows = (await s.execute(
        text("SELECT DISTINCT unnest(tags) AS t FROM notes WHERE user_id=:u LIMIT 40"),
        {"u": uid},
    )).all()
    return [r[0] for r in rows if r[0]]

async def _enrich(s: AsyncSession, uid: str, nid: str, raw: str):
    """Best-effort extraction+embedding. Each half fails open independently:
    cloud extract needs a key (else rule-based), cloud embed needs a key
    (else local MiniLM when EMBED_ENGINE=local, else nothing)."""
    known = await _known_tags(s, uid)
    try:
        rec = await extract_note(raw, known)
    except NotConfigured:
        rec = local_extract(raw, known)
    await s.execute(
        text("UPDATE notes SET title=:ti, type=:ty, summary=:su, tags=:ta, people=:pe, action_items=:ac, updated_at=now() WHERE id=:i"),
        {"ti": rec["title"], "ty": rec["type"], "su": rec["summary"], "ta": rec["tags"], "pe": rec["people"], "ac": rec["action_items"], "i": nid},
    )
    if settings.embed_engine == "local":
        try:
            vec = embed_local(raw)
        except RuntimeError:
            return
        await s.execute(
            text("INSERT INTO note_embeddings_local (note_id, embedding, model_version) VALUES (:i, CAST(:e AS vector), :m) ON CONFLICT (note_id) DO UPDATE SET embedding=CAST(:e AS vector), model_version=:m"),
            {"i": nid, "e": str(vec), "m": "all-MiniLM-L6-v2"},
        )
        return
    try:
        vec = await embed(raw)
    except NotConfigured:
        return
    await s.execute(
        text("INSERT INTO note_embeddings (note_id, embedding, model_version) VALUES (:i, CAST(:e AS vector), :m) ON CONFLICT (note_id) DO UPDATE SET embedding=CAST(:e AS vector), model_version=:m"),
        {"i": nid, "e": str(vec), "m": settings.embedding_model},
    )

class NoteIn(BaseModel):
    raw_text: str
    source: str = "typed"

class NoteUpd(BaseModel):
    raw_text: Optional[str] = None
    type: Optional[str] = None

@router.post("/notes")
async def create(n: NoteIn, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    row = (await s.execute(
        text("INSERT INTO notes (user_id, raw_text, source) VALUES (:u,:t,:s) RETURNING id"),
        {"u": uid, "t": n.raw_text, "s": n.source},
    )).mappings().first()
    await s.flush()
    await _enrich(s, uid, str(row["id"]), n.raw_text)
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
async def upd(nid: str, n: NoteUpd, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    if n.raw_text is not None:
        await s.execute(text("UPDATE notes SET raw_text=:t, updated_at=now() WHERE id=:i AND user_id=:u"), {"t": n.raw_text, "i": nid, "u": uid})
        await s.flush()
        await _enrich(s, uid, nid, n.raw_text)
    if n.type is not None:
        if n.type not in NOTE_TYPES:
            raise HTTPException(422, "unknown type")
        await s.execute(text("UPDATE notes SET type=:t, updated_at=now() WHERE id=:i AND user_id=:u"), {"t": n.type, "i": nid, "u": uid})
    await s.commit()
    return {"ok": True}

@router.delete("/notes/{nid}")
async def rm(nid: str, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    await s.execute(text("DELETE FROM notes WHERE id=:i AND user_id=:u"), {"i": nid, "u": uid})
    await s.commit()
    return {"ok": True}
