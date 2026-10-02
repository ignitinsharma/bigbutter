# notes routes: CRUD with extra AI sprinkles.
import base64
import logging
import re
import uuid
from fastapi import APIRouter, BackgroundTasks, Request, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from db.session import Session, engine, get_session
from core.auth import read_token
from core.config import settings
from core.openai_client import extract_note, embed, NotConfigured, NOTE_TYPES
from core.local_extract import local_extract
from core.local_embed import embed_local
from core import storage

router = APIRouter()
log = logging.getLogger("bigbutter.notes")

# Used by: one(), rm(), create(), _dec_cursor() — path ids and recording ids must be UUIDs before hitting SQL.
def _is_uuid(v: str) -> bool:
    try:
        uuid.UUID(str(v))
        return True
    except ValueError:
        return False

# Used by: every data route below + search_map/voice (auth guard dependency via Depends).
async def me(req: Request, s: AsyncSession = Depends(get_session)):
    # Auth guard: read user id from the session cookie, 401 when missing/invalid.
    uid = read_token(req.cookies.get("session", ""))
    if not uid:
        raise HTTPException(401)
    return uid

# Used by: notes/page.tsx palette popover — the user's saved custom swatches.
class PaletteIn(BaseModel):
    colors: list[str]

# Note background: '' = type default, a preset key, or a #rrggbb hex (mirrors web lib/colors.ts).
COLOR_PRESETS = ("coral", "peach", "sand", "lemon", "mint", "sage", "sky", "mist", "lavender", "blush")
HEX = re.compile(r"^#[0-9a-f]{6}$")

def _hexes(xs: list) -> list:
    # Lowercased, valid, de-duped (order kept), capped at 16.
    return list(dict.fromkeys(c for c in (str(x).strip().lower() for x in xs) if HEX.match(c)))[:16]

@router.get("/palette")
async def get_palette(uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    """Custom swatches the user added from the note palette."""
    row = (await s.execute(text("SELECT palette FROM users WHERE id=:u"), {"u": uid})).first()
    return {"colors": list(row[0] or []) if row else []}

@router.put("/palette")
async def put_palette(p: PaletteIn, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    colors = _hexes(p.colors)
    await s.execute(text("UPDATE users SET palette=:c WHERE id=:u"), {"c": colors, "u": uid})
    await s.commit()
    return {"colors": colors}

# Used by: GET /search (understand_query) — the user's existing categories for stable word senses.
async def _known_categories(s: AsyncSession, uid: str) -> list:
    # Distinct non-empty categories this user has, to keep extraction vocabulary stable.
    rows = (await s.execute(
        text("SELECT DISTINCT category FROM notes WHERE user_id=:u AND category <> '' LIMIT 40"),
        {"u": uid},
    )).all()
    return [r[0] for r in rows if r[0]]

# Used by: _enrich() — tags + categories in one round trip (Neon is ~300ms away per trip).
async def _known_terms(s: AsyncSession, uid: str):
    r = (await s.execute(text(
        "SELECT ARRAY(SELECT DISTINCT t FROM notes, unnest(tags) AS t WHERE user_id=:u AND t <> '' LIMIT 40), "
        "ARRAY(SELECT DISTINCT category FROM notes WHERE user_id=:u AND category <> '' LIMIT 40)"),
        {"u": uid})).first()
    return list(r[0] or []), list(r[1] or [])

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
async def _compute(raw: str, known: list, cats: list):
    """The slow, DB-free half: LLM structuring + embedding. Each fails open independently:
    LLM extract needs LLM_ENGINE reachable (Ollama or key, else rule-based), cloud
    embed needs a key (else local MiniLM when EMBED_ENGINE=local, else no vector)."""
    try:
        rec = await extract_note(raw, known, cats)  # cloud/LLM structuring (raises NotConfigured offline)
    except NotConfigured:
        rec = local_extract(raw, known, cats)  # rule-based fallback: raw note still gets fields
    etext = _embed_text(raw, rec)  # raw + "About:/Related:" so Apple-mobile ≠ Apple-fruit
    emb = None  # (table, vector, model_version) or None
    if settings.embed_engine == "local":
        try:
            emb = ("note_embeddings_local", await run_in_threadpool(embed_local, etext), "all-MiniLM-L6-v2")  # CPU → off the loop
        except RuntimeError:
            pass  # model missing → keep structured fields, skip vector (search degrades)
    else:
        try:
            emb = ("note_embeddings", await embed(etext), settings.embedding_model)  # cloud 1536-dim
        except NotConfigured:
            pass  # no key → note just isn't searchable yet
    return rec, emb

async def _store(s: AsyncSession, nid: str, rec: dict, emb) -> None:
    # Persist the structured record (keywords as CSV) + upsert the vector (re-embed on edit overwrites).
    await s.execute(
        text("UPDATE notes SET title=:ti, type=:ty, summary=:su, tags=:ta, people=:pe, action_items=:ac, "
             "category=:ca, keywords=:kw, updated_at=now() WHERE id=:i"),
        {"ti": rec["title"], "ty": rec["type"], "su": rec["summary"], "ta": rec["tags"], "pe": rec["people"],
         "ac": rec["action_items"], "ca": rec.get("category") or "", "kw": ", ".join(rec.get("keywords") or []), "i": nid},
    )
    if emb:
        table, vec, model = emb
        await s.execute(
            text(f"INSERT INTO {table} (note_id, embedding, model_version) VALUES (:i, CAST(:e AS vector), :m) "
                 "ON CONFLICT (note_id) DO UPDATE SET embedding=CAST(:e AS vector), model_version=:m"),
            {"i": nid, "e": str(vec), "m": model},
        )

# Used by: PUT /notes/{nid}, scripts/reenrich.py — synchronous enrichment inside the caller's transaction.
async def _enrich(s: AsyncSession, uid: str, nid: str, raw: str):
    known, cats = await _known_terms(s, uid)  # reuse existing tags/categories → connected graph, stable senses
    rec, emb = await _compute(raw, known, cats)
    await _store(s, nid, rec, emb)

# Used by: create() via BackgroundTasks — runs after the response so Save returns in ~0.3s.
async def _enrich_later(uid: str, nid: str, raw: str) -> None:
    """Never holds a DB connection while the LLM thinks: queued enrichments used to pin pool
    connections, forcing new requests to open fresh TLS connections to Neon (seconds each).
    Always ends 'done' so the UI stops waiting."""
    try:
        async with Session() as s:  # short: read vocabulary, release the connection
            known, cats = await _known_terms(s, uid)
        rec, emb = await _compute(raw, known, cats)  # seconds of LLM + embedding, no connection held
        async with Session() as s:  # short: write results + done flag in one transaction
            await _store(s, nid, rec, emb)
            await s.execute(text("UPDATE notes SET enrich_state='done' WHERE id=:i AND user_id=:u"), {"i": nid, "u": uid})
            await s.commit()
        return
    except Exception as e:  # LLM/embed/DB hiccup (or note deleted meanwhile) → keep raw text
        log.warning("background enrich failed note=%s: %r", nid, e)
    async with Session() as s:
        await s.execute(text("UPDATE notes SET enrich_state='done' WHERE id=:i AND user_id=:u"), {"i": nid, "u": uid})
        await s.commit()

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
    recording_ids: List[str] = []  # voice clips behind this draft (POST /voice/transcribe ids)

# Used by: PUT /notes/{nid} — partial edit: new text and/or title/type/tags/color override.
class NoteUpd(BaseModel):
    raw_text: Optional[str] = None
    title: Optional[str] = None  # applied after re-enrich so a typed title wins; "" = keep AI title
    type: Optional[str] = None
    tags: Optional[list[str]] = None
    color: Optional[str] = None

# Used by: POST /notes — frontend save button (notes/page.tsx save()).
# Flow: INSERT raw → _enrich (extract + embed) → commit → {id}; frontend refetches.
@router.post("/notes")
async def create(n: NoteIn, tasks: BackgroundTasks, uid: str = Depends(me)):
    """Store the note (+ link its voice clips, + a random preset color) in one statement and reply; AI enrichment runs after."""
    # Link only the caller's own clips that aren't on a note yet; source='voice' iff any link.
    ids = list(dict.fromkeys(i for i in n.recording_ids if _is_uuid(i)))[:20]
    # One autocommit statement = one round trip to Neon (~300ms), and still atomic: it's a single statement.
    async with engine.connect() as c:
        c = await c.execution_options(isolation_level="AUTOCOMMIT")
        row = (await c.execute(text(
            "WITH n AS ("
            "  INSERT INTO notes (user_id, raw_text, source, enrich_state, color) VALUES (:u, :t, "
            "    CASE WHEN EXISTS (SELECT 1 FROM recordings WHERE user_id=:u AND note_id IS NULL AND id = ANY(CAST(:ids AS uuid[]))) "
            "    THEN 'voice' ELSE :s END, 'pending', "
            # Random preset background, never the same as the user's previous note.
            "    (SELECT c FROM unnest(CAST(:presets AS text[])) AS c WHERE c IS DISTINCT FROM "
            "      (SELECT color FROM notes WHERE user_id=:u ORDER BY created_at DESC, id DESC LIMIT 1) "
            "     ORDER BY random() LIMIT 1)) RETURNING *"
            "), linked AS ("
            "  UPDATE recordings SET note_id=(SELECT id FROM n), status='attached' "
            "  WHERE user_id=:u AND note_id IS NULL AND id = ANY(CAST(:ids AS uuid[])) RETURNING id"
            f") SELECT {NOTE_FIELDS}, (SELECT count(*) FROM linked) AS linked FROM n"),
            {"u": uid, "t": n.raw_text, "s": n.source, "ids": ids, "presets": list(COLOR_PRESETS)},
            )).mappings().first()
    nid = str(row["id"])
    tasks.add_task(_enrich_later, uid, nid, n.raw_text)  # title/summary/tags/vector land in ~2–3s
    out = _row({k: v for k, v in row.items() if k != "linked"})
    return {**out, "id": nid, "related": []}

# Used by: lst(), one(), stats() — shared list plumbing (columns, blank-type norm, edge rule).
NOTE_FIELDS = "id, raw_text, title, type, summary, tags, people, action_items, category, keywords, color, enrich_state, created_at, updated_at"
TYPE_EXPR = "coalesce(nullif(type, ''), 'note')"
# Same edge rule as /map: shared tag or person, or the same non-empty category.
LINKED = "(a.tags && b.tags OR a.people && b.people OR (a.category <> '' AND lower(a.category) = lower(b.category)))"

# Used by: lst() — clamps per/sort/type into SQL fragments.
def _list_args(per: int, sort: str, type: Optional[str]):
    # Clamp the batch size and build the ORDER BY + WHERE fragment for list queries.
    per = max(1, min(per, 50))
    order = "ASC" if sort == "old" else "DESC"
    where = "user_id=:u" + (f" AND {TYPE_EXPR} = :t" if type else "")
    return per, order, where

# Used by: lst() — opaque "next batch" position. Built server-side so created_at keeps its
# microseconds (a JS Date would round them and skip/repeat notes).
def _enc_cursor(r) -> str:
    raw = f"{r['created_at'].isoformat()}|{r['id']}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")

def _dec_cursor(c: str):
    try:
        ts, i = base64.urlsafe_b64decode(c + "=" * (-len(c) % 4)).decode().split("|", 1)
        at = datetime.fromisoformat(ts)
        if at.tzinfo is None or not _is_uuid(i):
            raise ValueError
        return at, i
    except Exception:
        raise HTTPException(400, "bad cursor")

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

# Used by: GET /notes — infinite-scroll board on notes/page.tsx (cursor batches, sort, type filter).
# Cursor mode returns {items (+related), next_cursor}; page mode (no cursor) also keeps
# {total, page, per, pages} for older clients. next_cursor is null on the last batch.
@router.get("/notes")
async def lst(page: int = 1, per: int = 10, sort: str = "new", type: Optional[str] = None, cursor: Optional[str] = None,
              uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    """One batch of notes (newest or oldest first, optional type filter) + related notes per item."""
    per, order, where = _list_args(per, sort, type)
    args = {"u": uid, "t": type, "lim": per + 1}  # one extra row says whether more exist, no COUNT needed
    if cursor:
        args["c"], args["i"] = _dec_cursor(cursor)
        cmp = "<" if order == "DESC" else ">"
        rows = (await s.execute(
            text(f"SELECT {NOTE_FIELDS} FROM notes WHERE {where} AND (created_at, id) {cmp} (:c, CAST(:i AS uuid)) "
                 f"ORDER BY created_at {order}, id {order} LIMIT :lim"),
            args,
        )).mappings().all()
        total = None
    else:
        page = max(1, page)
        args["off"] = (page - 1) * per
        # Total rides along as a window count (one round trip, not two); empty page → count separately.
        rows = (await s.execute(
            text(f"SELECT {NOTE_FIELDS}, count(*) OVER () AS _total FROM notes WHERE {where} "
                 f"ORDER BY created_at {order}, id {order} LIMIT :lim OFFSET :off"),
            args,
        )).mappings().all()
        total = rows[0]["_total"] if rows else (await s.execute(text(f"SELECT count(*) FROM notes WHERE {where}"), args)).scalar() or 0
        rows = [{k: v for k, v in r.items() if k != "_total"} for r in rows]
    more = len(rows) > per
    rows = rows[:per]
    next_cursor = _enc_cursor(rows[-1]) if more else None
    rel = await _related(s, uid, rows)
    items = [{**_row(r), "related": rel.get(str(r["id"]), [])} for r in rows]
    if total is None:
        return {"items": items, "next_cursor": next_cursor}
    return {"items": items, "total": total, "page": page, "per": per, "pages": max(1, -(-total // per)), "next_cursor": next_cursor}

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
    """A single note (+ related + voice clips) — refreshes one row in place after an edit."""
    if not _is_uuid(nid):
        raise HTTPException(404)
    row = (await s.execute(text(f"SELECT {NOTE_FIELDS} FROM notes WHERE user_id=:u AND id = CAST(:i AS uuid)"),
                           {"u": uid, "i": nid})).mappings().first()
    if not row:
        raise HTTPException(404)
    rel = await _related(s, uid, [row])
    recs = [dict(r) for r in (await s.execute(text(
        "SELECT id, s3_key, s3_url, presigned_url, presigned_expires_at, duration_ms, recorded_at, uploaded_at "
        "FROM recordings WHERE note_id = CAST(:i AS uuid) AND user_id=:u ORDER BY recorded_at"),
        {"i": nid, "u": uid})).mappings().all()]
    # Presigned links are bearer links (7 days). Re-sign stale ones (expiring / rotated key) before handing out.
    stale = [r for r in recs if storage.enabled() and storage.needs_resign(r["presigned_url"], r["presigned_expires_at"])]
    for r in stale:
        r["presigned_url"], r["presigned_expires_at"] = storage.presign_get(r["s3_key"])
        await s.execute(text("UPDATE recordings SET presigned_url=:u, presigned_expires_at=:e WHERE id=:i"),
                        {"u": r["presigned_url"], "e": r["presigned_expires_at"], "i": r["id"]})
    if stale:
        await s.commit()
    elif recs and not storage.enabled():
        log.warning("S3 not configured — returning stored recording links for note %s as-is", nid)
    return {**_row(row), "related": rel.get(nid, []),
            "recordings": [{"id": str(r["id"]), "s3_url": r["s3_url"], "presigned_url": r["presigned_url"],
                            "presigned_expires_at": r["presigned_expires_at"], "duration_ms": r["duration_ms"],
                            "recorded_at": r["recorded_at"], "uploaded_at": r["uploaded_at"]} for r in recs]}

# Used by: PUT /notes/{nid} — NoteDialog: edit text (re-enriches) or override title/type/tags/color.
@router.put("/notes/{nid}")
async def upd(nid: str, n: NoteUpd, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    # Edit a note: raw_text re-runs enrichment; title/type/tags/color are plain validated overrides.
    if n.color is not None:
        c = n.color.strip().lower()
        if c and c not in COLOR_PRESETS and not HEX.match(c):
            raise HTTPException(422, "unknown color")
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
    if n.title is not None and n.title.strip():
        await s.execute(text("UPDATE notes SET title=:t, updated_at=now() WHERE id=:i AND user_id=:u"), {"t": n.title.strip()[:120], "i": nid, "u": uid})
    if n.color is not None:
        await s.execute(text("UPDATE notes SET color=:c, updated_at=now() WHERE id=:i AND user_id=:u"), {"c": n.color.strip().lower(), "i": nid, "u": uid})
    await s.commit()
    return {"ok": True}

# Used by: DELETE /notes/{nid} — card delete button; embeddings cascade, list reloads.
@router.delete("/notes/{nid}")
async def rm(nid: str, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    # Delete one note (embedding + recording rows cascade), then its audio in S3; scoped to the owner.
    if not _is_uuid(nid):
        raise HTTPException(404)
    keys = (await s.execute(text("SELECT s3_key FROM recordings WHERE note_id = CAST(:i AS uuid) AND user_id=:u"),
                            {"i": nid, "u": uid})).scalars().all()
    await s.execute(text("DELETE FROM notes WHERE id=:i AND user_id=:u"), {"i": nid, "u": uid})
    await s.commit()
    if keys and storage.enabled():
        try:
            await run_in_threadpool(storage.delete, list(keys))
        except Exception as e:  # note is gone either way; orphaned object logged with its key
            log.warning("s3 delete failed for note %s keys=%s: %r", nid, list(keys), e)
    return {"ok": True}
