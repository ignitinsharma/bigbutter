# notes routes: CRUD with extra AI sprinkles.
import uuid
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

# Used by: every data route below + search_map/voice (auth guard dependency via Depends).
async def me(req: Request, s: AsyncSession = Depends(get_session)):
    # Auth guard: read user id from the session cookie, 401 when missing/invalid.
    uid = read_token(req.cookies.get("session", ""))
    if not uid:
        raise HTTPException(401)
    return uid

# Used by: _enrich() — feeds existing tags into extraction so it reuses them.
async def _known_tags(s: AsyncSession, uid: str) -> list:
    # Distinct tags this user already has, so extraction reuses them (keeps graph connected).
    rows = (await s.execute(
        text("SELECT DISTINCT unnest(tags) AS t FROM notes WHERE user_id=:u LIMIT 40"),
        {"u": uid},
    )).all()
    return [r[0] for r in rows if r[0]]

# Used by: _enrich() + GET /search — feeds existing categories for stable word senses.
async def _known_categories(s: AsyncSession, uid: str) -> list:
    # Distinct non-empty categories this user has, to keep extraction vocabulary stable.
    rows = (await s.execute(
        text("SELECT DISTINCT category FROM notes WHERE user_id=:u AND category <> '' LIMIT 40"),
        {"u": uid},
    )).all()
    return [r[0] for r in rows if r[0]]

# Used by: _enrich() — builds the vector input so the stored sense disambiguates.
def _embed_text(raw: str, rec: dict) -> str:
    """Vector input carries the resolved sense, so "Apple … mobile" lands near
    phones and "Apple … fruit" near food even though both say "Apple"."""
    extra = " ".join(filter(None, [
        f"About: {rec['category']}." if rec.get("category") else "",
        f"Related: {', '.join(rec['keywords'])}." if rec.get("keywords") else "",
    ]))
    return f"{raw}\n{extra}" if extra else raw

# Used by: POST /notes, PUT /notes/{nid}, scripts/reenrich.py — the save-time AI step.
async def _enrich(s: AsyncSession, uid: str, nid: str, raw: str):
    """Best-effort extraction+embedding. Each half fails open independently:
    LLM extract needs LLM_ENGINE reachable (Ollama or key, else rule-based), cloud
    embed needs a key (else local MiniLM when EMBED_ENGINE=local, else nothing)."""
    # Called right after INSERT (create) or raw_text change (update), before commit.
    # Fills title/type/summary/tags/people/category + vector so save returns enriched.
    known = await _known_tags(s, uid)  # reuse existing tags → keeps the map graph connected
    cats = await _known_categories(s, uid)  # reuse existing categories → stable word senses
    try:
        rec = await extract_note(raw, known, cats)  # cloud/LLM structuring (raises NotConfigured offline)
    except NotConfigured:
        rec = local_extract(raw, known, cats)  # rule-based fallback: raw note still gets fields
    # Persist the structured record onto the note row (keywords stored as CSV string).
    await s.execute(
        text("UPDATE notes SET title=:ti, type=:ty, summary=:su, tags=:ta, people=:pe, action_items=:ac, "
             "category=:ca, keywords=:kw, updated_at=now() WHERE id=:i"),
        {"ti": rec["title"], "ty": rec["type"], "su": rec["summary"], "ta": rec["tags"], "pe": rec["people"],
         "ac": rec["action_items"], "ca": rec.get("category") or "", "kw": ", ".join(rec.get("keywords") or []), "i": nid},
    )
    etext = _embed_text(raw, rec)  # raw + "About:/Related:" so Apple-mobile ≠ Apple-fruit
    if settings.embed_engine == "local":
        try:
            vec = embed_local(etext)  # on-device 384-dim MiniLM, no key, own table
        except RuntimeError:
            return  # model missing → keep structured fields, skip vector (search degrades)
        await s.execute(
            text("INSERT INTO note_embeddings_local (note_id, embedding, model_version) VALUES (:i, CAST(:e AS vector), :m) ON CONFLICT (note_id) DO UPDATE SET embedding=CAST(:e AS vector), model_version=:m"),
            {"i": nid, "e": str(vec), "m": "all-MiniLM-L6-v2"},
        )
        return
    try:
        vec = await embed(etext)  # cloud 1536-dim embedding for pgvector search
    except NotConfigured:
        return  # no key → raw + structured fields stay, note just isn't searchable yet
    # Upsert vector (re-embed on edit overwrites; delete cascades via FK).
    await s.execute(
        text("INSERT INTO note_embeddings (note_id, embedding, model_version) VALUES (:i, CAST(:e AS vector), :m) ON CONFLICT (note_id) DO UPDATE SET embedding=CAST(:e AS vector), model_version=:m"),
        {"i": nid, "e": str(vec), "m": settings.embedding_model},
    )

# Used by: lst(), one(), GET /search — normalizes a DB row for JSON responses.
def _row(r) -> dict:
    # Normalize one DB row: split the stored keywords CSV back into a list.
    d = dict(r)
    d["keywords"] = [k.strip() for k in (d.get("keywords") or "").split(",") if k.strip()]
    return d

# Used by: POST /notes — request shape: raw capture + where it came from.
class NoteIn(BaseModel):
    raw_text: str
    source: str = "typed"

# Used by: PUT /notes/{nid} — partial edit: new text and/or type/tags override.
class NoteUpd(BaseModel):
    raw_text: Optional[str] = None
    type: Optional[str] = None
    tags: Optional[list[str]] = None

# Used by: POST /notes — frontend save button (notes/page.tsx save()).
# Flow: INSERT raw → _enrich (extract + embed) → commit → {id}; frontend refetches.
@router.post("/notes")
async def create(n: NoteIn, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    # Save a raw note, then enrich (extract + embed) before committing the response.
    row = (await s.execute(
        text("INSERT INTO notes (user_id, raw_text, source) VALUES (:u,:t,:s) RETURNING id"),
        {"u": uid, "t": n.raw_text, "s": n.source},
    )).mappings().first()
    await s.flush()
    await _enrich(s, uid, str(row["id"]), n.raw_text)
    await s.commit()
    return {"id": str(row["id"])}

# Used by: lst(), one(), locate(), stats() — shared list plumbing (columns, blank-type norm, edge rule).
NOTE_FIELDS = "id, raw_text, title, type, summary, tags, people, action_items, category, keywords, created_at"
TYPE_EXPR = "coalesce(nullif(type, ''), 'note')"
# Same edge rule as /map: shared tag or person, or the same non-empty category.
LINKED = "(a.tags && b.tags OR a.people && b.people OR (a.category <> '' AND lower(a.category) = lower(b.category)))"

# Used by: lst() + locate() — clamps page/per/sort/type into SQL fragments.
def _page_args(page: int, per: int, sort: str, type: Optional[str]):
    # Clamp pagination inputs and build the ORDER BY + WHERE fragment for list queries.
    per = max(1, min(per, 50))
    page = max(1, page)
    order = "ASC" if sort == "old" else "DESC"
    where = "user_id=:u" + (f" AND {TYPE_EXPR} = :t" if type else "")
    return page, per, order, where

# Used by: _related() — computes the "via ..." reasons shown in Connected-to lists.
def _shared(a: dict, b: dict) -> list:
    # Shared link reasons between two notes: overlapping tags/people + same category.
    low = lambda xs: {str(x).lower() for x in (xs or [])}
    shared = sorted(low(a["tags"]) & low(b["tags"]) | low(a["people"]) & low(b["people"]))
    ca, cb = (a["category"] or "").lower(), (b["category"] or "").lower()
    if ca and ca == cb and ca not in shared:
        shared.insert(0, ca)
    return shared

# Used by: lst(), one(), GET /search — attaches up to 5 "Connected to" notes per item.
async def _related(s: AsyncSession, uid: str, page_rows: list) -> dict:
    """Up to 5 linked notes per page item, across ALL the user's notes — one query for the page."""
    if not page_rows:
        return {}
    ids = [str(r["id"]) for r in page_rows]
    rows = (await s.execute(
        text("SELECT a.id AS src, b.id, b.title, b.raw_text, b.tags, b.people, b.category FROM notes a "
             f"JOIN notes b ON b.user_id = a.user_id AND b.id <> a.id AND {LINKED} "
             "WHERE a.user_id=:u AND a.id = ANY(CAST(:ids AS uuid[]))"),
        {"u": uid, "ids": ids},
    )).mappings().all()
    by_id = {str(r["id"]): r for r in page_rows}
    out: dict = {}
    for r in rows:
        shared = _shared(by_id[str(r["src"])], r)
        if shared:
            out.setdefault(str(r["src"]), []).append(
                {"id": str(r["id"]), "title": r["title"] or (r["raw_text"] or "")[:60], "shared": shared})
    return {k: sorted(v, key=lambda x: -len(x["shared"]))[:5] for k, v in out.items()}

# Used by: GET /notes — stream list on notes/page.tsx (server pagination, sort, type filter).
# Returns {items (+related), total, page, per, pages}; frontend shows skeletons/notices on failure.
@router.get("/notes")
async def lst(page: int = 1, per: int = 10, sort: str = "new", type: Optional[str] = None,
              uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    """One page of notes (newest or oldest first, optional type filter) + related notes per item."""
    page, per, order, where = _page_args(page, per, sort, type)
    args = {"u": uid, "t": type, "lim": per, "off": (page - 1) * per}
    total = (await s.execute(text(f"SELECT count(*) FROM notes WHERE {where}"), args)).scalar() or 0
    rows = (await s.execute(
        text(f"SELECT {NOTE_FIELDS} FROM notes WHERE {where} ORDER BY created_at {order}, id {order} LIMIT :lim OFFSET :off"),
        args,
    )).mappings().all()
    rel = await _related(s, uid, rows)
    items = [{**_row(r), "related": rel.get(str(r["id"]), [])} for r in rows]
    return {"items": items, "total": total, "page": page, "per": per, "pages": max(1, -(-total // per))}

# Used by: GET /notes/stats — navbar totals + filter-chip counts (notes/page.tsx loadStats).
@router.get("/notes/stats")
async def stats(uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    """Totals for the navbar + filter chips, independent of the page being viewed."""
    counts = {r[0]: r[1] for r in (await s.execute(
        text(f"SELECT {TYPE_EXPR}, count(*) FROM notes WHERE user_id=:u GROUP BY 1"), {"u": uid})).all()}
    connections = (await s.execute(
        text(f"SELECT count(*) FROM notes a JOIN notes b ON b.user_id = a.user_id AND a.id < b.id AND {LINKED} "
             "WHERE a.user_id=:u"), {"u": uid})).scalar() or 0
    return {"total": sum(counts.values()), "counts": counts, "connections": connections}

# Used by: GET /notes/{nid} — single-note fetch to refresh one row in place after an edit.
@router.get("/notes/{nid}")
async def one(nid: str, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    """A single note (+ related) — refreshes one row in place after an edit."""
    try:
        uuid.UUID(nid)
    except ValueError:
        raise HTTPException(404)
    row = (await s.execute(text(f"SELECT {NOTE_FIELDS} FROM notes WHERE user_id=:u AND id = CAST(:i AS uuid)"),
                           {"u": uid, "i": nid})).mappings().first()
    if not row:
        raise HTTPException(404)
    rel = await _related(s, uid, [row])
    return {**_row(row), "related": rel.get(nid, [])}

# Used by: GET /notes/{nid}/page — jumpTo() finds a note's page for copied links + Connected-to jumps.
@router.get("/notes/{nid}/page")
async def locate(nid: str, per: int = 10, sort: str = "new", type: Optional[str] = None,
                 uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    """Which page a note lands on for this view — powers copied links and 'Connected to' jumps."""
    try:
        uuid.UUID(nid)
    except ValueError:
        raise HTTPException(404)
    _, per, order, where = _page_args(1, per, sort, type)
    me_row = (await s.execute(
        text(f"SELECT created_at, id FROM notes WHERE {where} AND id = CAST(:i AS uuid)"),
        {"u": uid, "t": type, "i": nid})).mappings().first()
    if not me_row:
        raise HTTPException(404)
    cmp = ">" if order == "DESC" else "<"
    before = (await s.execute(
        text(f"SELECT count(*) FROM notes WHERE {where} AND (created_at, id) {cmp} (:c, CAST(:i AS uuid))"),
        {"u": uid, "t": type, "c": me_row["created_at"], "i": nid})).scalar() or 0
    return {"page": before // per + 1}

# Used by: PUT /notes/{nid} — edit raw text (re-enriches) or override type/tags from the card UI.
@router.put("/notes/{nid}")
async def upd(nid: str, n: NoteUpd, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    # Edit a note: raw_text re-runs enrichment, type/tags are plain validated updates.
    if n.raw_text is not None:
        await s.execute(text("UPDATE notes SET raw_text=:t, updated_at=now() WHERE id=:i AND user_id=:u"), {"t": n.raw_text, "i": nid, "u": uid})
        await s.flush()
        await _enrich(s, uid, nid, n.raw_text)
    if n.type is not None:
        if n.type not in NOTE_TYPES:
            raise HTTPException(422, "unknown type")
        await s.execute(text("UPDATE notes SET type=:t, updated_at=now() WHERE id=:i AND user_id=:u"), {"t": n.type, "i": nid, "u": uid})
    if n.tags is not None:
        # Trimmed, lowercased, de-duped (order kept), capped — same shape enrichment writes.
        tags = list(dict.fromkeys(t.strip().lower() for t in n.tags if t.strip()))[:12]
        await s.execute(text("UPDATE notes SET tags=:t, updated_at=now() WHERE id=:i AND user_id=:u"), {"t": tags, "i": nid, "u": uid})
    await s.commit()
    return {"ok": True}

# Used by: DELETE /notes/{nid} — card delete button; embeddings cascade, list reloads.
@router.delete("/notes/{nid}")
async def rm(nid: str, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    # Delete one note (its embedding rows cascade); scoped to the owner.
    await s.execute(text("DELETE FROM notes WHERE id=:i AND user_id=:u"), {"i": nid, "u": uid})
    await s.commit()
    return {"ok": True}
