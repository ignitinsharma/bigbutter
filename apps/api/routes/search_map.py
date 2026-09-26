from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from db.session import get_session
from routes.notes import me
from core.openai_client import embed, summarize, NotConfigured

router = APIRouter()

NOTE_COLS = "id, user_id, raw_text, title, type, summary, tags, people, action_items, source, created_at, updated_at"

def _rrf(rank_lists: list[list[str]], k: int = 60) -> list[str]:
    scores: dict[str, float] = {}
    for ranks in rank_lists:
        for rank, nid in enumerate(ranks):
            scores[nid] = scores.get(nid, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda nid: scores[nid], reverse=True)

@router.get("/search")
async def search(q: str, resp: Response, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    try:
        qv = str(await embed(q))
    except NotConfigured:
        resp.status_code = 501
        return {"error": "not_configured"}
    sem = (await s.execute(
        text(f"SELECT {NOTE_COLS} FROM note_embeddings e JOIN notes n ON n.id = e.note_id "
             "WHERE n.user_id=:u ORDER BY e.embedding <=> CAST(:qv AS vector) LIMIT 20"),
        {"u": uid, "qv": qv},
    )).mappings().all()
    kw = (await s.execute(
        text(f"SELECT {NOTE_COLS} FROM notes n WHERE n.user_id=:u "
             "AND n.search_tsv @@ plainto_tsquery('english', :q) "
             "ORDER BY ts_rank(n.search_tsv, plainto_tsquery('english', :q)) DESC LIMIT 20"),
        {"u": uid, "q": q},
    )).mappings().all()
    sem_ids = [str(r["id"]) for r in sem]
    kw_ids = [str(r["id"]) for r in kw]
    ordered = _rrf([sem_ids, kw_ids])
    by_id = {str(r["id"]): dict(r) for r in list(sem) + list(kw)}
    notes = [by_id[nid] for nid in ordered if nid in by_id]
    try:
        summary = await summarize(q, notes[:8])
    except NotConfigured:
        summary = ""
    return {"query": q, "notes": notes, "matched_ids": ordered, "summary": summary}

@router.get("/map")
async def mmap(uid: str = Depends(me)):
    return {"nodes": [], "edges": []}  # B6
