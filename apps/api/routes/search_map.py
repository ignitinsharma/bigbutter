# search_map: find stuff + draw pretty graphs.
from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from db.session import get_session
from routes.notes import me, _known_categories, _row, _related
from core.config import settings
from typing import Optional
from core.openai_client import embed, summarize, understand_query, judge, core_query, NotConfigured
from core.local_embed import embed_local

router = APIRouter()

JUDGE_MAX = 20  # borderline candidates sent to the relevance check in one call

NOTE_COLS = "n.id, n.user_id, n.raw_text, n.title, n.type, n.summary, n.tags, n.people, n.action_items, n.category, n.keywords, n.color, n.bucket, n.source, n.created_at, n.updated_at"

# Used by: search() below — merges the semantic/keyword/category legs into one ranking.
def _rrf(rank_lists: list[list[str]], k: int = 60) -> list[str]:
    # Reciprocal-rank fusion: merge semantic/keyword/category legs so shared hits rank first.
    # Each leg votes 1/(k+rank); a note in 2 legs outranks one topping a single leg.
    scores: dict[str, float] = {}
    for ranks in rank_lists:
        for rank, nid in enumerate(ranks):
            scores[nid] = scores.get(nid, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda nid: scores[nid], reverse=True)

# Used by: search() — embeds one query text with the active engine (local MiniLM vs cloud).
async def _query_vec(qtext: str):
    """(vector literal, table) for the active embed engine, or None when unavailable."""
    # Local → 384-dim MiniLM + note_embeddings_local; cloud → 1536-dim + note_embeddings.
    # None means "can't search at all" → caller returns 501 (frontend falls back to local filter).
    if settings.embed_engine == "local":
        try:
            return str(embed_local(qtext)), "note_embeddings_local"
        except RuntimeError:
            return None
    try:
        return str(await embed(qtext)), "note_embeddings"
    except NotConfigured:
        return None

# Used by: GET /search — called from the notes page search box (debounced 400ms).
# Frontend uses {notes, matched_ids, summary}: list rows, map highlight, summary banner.
@router.get("/search")
async def search(q: str, resp: Response, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    # Hybrid search: understand query → semantic + keyword + category legs → RRF → summary.
    # 1. Understand the query (sense + expansions); LLM down → the user's own words.
    # The user's core words also stay in every leg below, so whatever the model
    # returns can only add results, never replace them.
    core = core_query(q)  # deterministic subject words ("notes about mobiles" → "mobiles")
    try:
        u = await understand_query(q, await _known_categories(s, uid))  # LLM: {terms, category, expansions}
    except NotConfigured:
        u = {"terms": core, "category": None, "expansions": []}  # offline: search exactly what user typed
    # Expanded query text: terms + resolved sense + synonyms, deduped, order kept.
    qtext = " ".join(dict.fromkeys(filter(None, [u["terms"], u["category"], *u["expansions"]])))

    # Relevance check (SEARCH_RERANK): gather more candidates (lower meaning floor), then the
    # LLM keeps only the borderline ones that truly fit. Off → today's floor, no extra call.
    judging = settings.search_rerank and settings.llm_engine != "off"
    floor = min(settings.search_candidate_sim, settings.search_min_sim) if judging else settings.search_min_sim

    # 2. Semantic leg for both the user's words and the expanded query; best sim
    # per note wins, floored so a tiny DB doesn't return everything in the window.
    best: dict = {}  # note_id → best row across both query phrasings (core + expanded)
    core_vec = None  # vector of the user's own words, reused by the keyword leg below
    for t in dict.fromkeys([core, qtext]):  # run both: user's words AND the expanded query
        qv = await _query_vec(t)  # embed with active engine; None → 501 below
        if qv is None:
            resp.status_code = 501  # no vector engine at all → frontend shows local filter
            return {"error": "not_configured"}
        qvec, emb_table = qv
        core_vec = core_vec or qvec
        for r in (await s.execute(
            text(f"SELECT {NOTE_COLS}, 1 - (e.embedding <=> CAST(:qv AS vector)) AS sim FROM {emb_table} e "
                 "JOIN notes n ON n.id = e.note_id WHERE n.user_id=:u "
                 "ORDER BY e.embedding <=> CAST(:qv AS vector) LIMIT 20"),
            {"u": uid, "qv": qvec},
        )).mappings().all():
            # Keep the higher-sim row when both phrasings match the same note.
            if r["sim"] >= floor and r["sim"] > best.get(str(r["id"]), {"sim": -1})["sim"]:
                best[str(r["id"])] = r
    sem = sorted(best.values(), key=lambda r: -r["sim"])  # best-first for the merge

    # 3. Keyword leg over raw/title/summary/category/keywords, OR across the user's words + expansions.
    # websearch_to_tsquery handles quoting/operators; ts_rank orders exact matches first.
    # A hit on the user's own words always counts. A hit only on an AI-suggested synonym needs
    # some meaning support too (≥ SEARCH_CANDIDATE_SIM): "food" for "apple fruit" must not pull
    # in a note about food waste at an AI company.
    own_q = " or ".join(dict.fromkeys(filter(None, [core, u["terms"]])))
    kw_q = " or ".join(dict.fromkeys(filter(None, [core, u["terms"], *u["expansions"]])))
    kw = [r for r in (await s.execute(
        text(f"SELECT {NOTE_COLS}, n.search_tsv @@ websearch_to_tsquery('english', :own) AS own_hit, "
             "coalesce(1 - (e.embedding <=> CAST(:cv AS vector)), 0) AS ksim "
             f"FROM notes n LEFT JOIN {emb_table} e ON e.note_id = n.id WHERE n.user_id=:u "
             "AND n.search_tsv @@ websearch_to_tsquery('english', :q) "
             "ORDER BY ts_rank(n.search_tsv, websearch_to_tsquery('english', :q)) DESC LIMIT 20"),
        {"u": uid, "q": kw_q, "own": own_q, "cv": core_vec},
    )).mappings().all()
        if r["own_hit"] or max(r["ksim"], best.get(str(r["id"]), {"sim": 0})["sim"]) >= settings.search_candidate_sim]
    kw_ids = {str(r["id"]) for r in kw}
    strong_sem = {nid for nid, r in best.items() if r["sim"] >= settings.search_min_sim}
    found = set(best) | kw_ids  # every note the meaning or keyword leg actually matched

    # 4. Category leg: the resolved sense matches the note's stored category (Apple-mobile vs
    # Apple-fruit). It only BOOSTS notes the legs above found: a broad guess ("technology")
    # would otherwise pull in every note filed under it, related or not.
    cat = []
    if u["category"]:
        cat = [r for r in (await s.execute(
            text(f"SELECT {NOTE_COLS} FROM notes n WHERE n.user_id=:u AND n.category <> '' "
                 "AND (lower(n.category) = :c OR lower(n.category) LIKE '%' || :c || '%' OR :c LIKE '%' || lower(n.category) || '%') "
                 "ORDER BY n.created_at DESC LIMIT 20"),
            {"u": uid, "c": u["category"]},
        )).mappings().all() if str(r["id"]) in found]

    legs = [sem, kw, cat]
    ordered = _rrf([[str(r["id"]) for r in leg] for leg in legs])  # one fused ranking from 3 legs
    by_id: dict = {}
    for leg in legs:
        for r in leg:
            by_id.setdefault(str(r["id"]), _row({k: v for k, v in r.items() if k not in ("own_hit", "ksim")}))  # first leg wins (sem has sim)
    for r in sem:
        by_id[str(r["id"])]["sim"] = round(float(r["sim"]), 3)  # expose sim for debugging/sort

    # 5. Which candidates are shown. Confident = matched by meaning (≥ SEARCH_MIN_SIM) AND keyword:
    # always kept, never judged, so a weak model can't drop good hits. Without the check,
    # a note needs meaning ≥ SEARCH_MIN_SIM or a keyword hit (the behaviour before the check).
    confident = strong_sem & kw_ids
    plain = [nid for nid in ordered if nid in strong_sem or nid in kw_ids]
    keep = plain
    if judging:
        unsure = [nid for nid in ordered if nid not in confident][:JUDGE_MAX]
        if unsure:
            try:
                ok = set(await judge(q, [by_id[nid] for nid in unsure]))
                keep = [nid for nid in ordered if nid in confident or nid in ok]
            except NotConfigured:
                keep = plain  # judge down or unparseable → exactly the unchecked result
    notes = [by_id[nid] for nid in keep]
    ordered = [str(n["id"]) for n in notes]  # final id order → map highlight (focusIds)
    rel = await _related(s, uid, notes)  # "Connected to" per hit, across ALL user notes
    notes = [{**n, "related": rel.get(str(n["id"]), [])} for n in notes]

    summary = ""  # RAG summary over the top 8 hits; extractive fallback when LLM is down.
    if notes:
        try:
            summary = await summarize(q, notes[:8])
        except NotConfigured:
            # ponytail: extractive fallback — no generative model, just the hits.
            titles = [n.get("title") or (n.get("raw_text") or "")[:60] for n in notes[:3]]
            summary = f"{len(notes)} matching note{'s' if len(notes) != 1 else ''} for '{q}'" + (
                ": " + "; ".join(t for t in titles if t) if titles else "")
    return {"query": q, "understood": u, "notes": notes, "matched_ids": ordered, "summary": summary}

# Used by: GET /map — map tab (full graph) + search mode (ids=hits, subgraph of hits).
# Frontend uses {nodes, edges}: d3-force layout, click detail, hover neighbourhood.
@router.get("/map")
async def mmap(ids: Optional[str] = None, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    """Tag/person/category graph. `ids` (comma-separated) scopes it to a search's
    hits: only those nodes, edges among them, degree recomputed inside."""
    # Load every note's link keys (tags/people/category), lowercased for case-insensitive edges.
    rows = (await s.execute(
        text("SELECT id, title, type, summary, tags, people, category, color FROM notes WHERE user_id=:u"),
        {"u": uid},
    )).mappings().all()
    only = {i.strip() for i in ids.split(",") if i.strip()} if ids is not None else None
    notes = [{"id": str(r["id"]), "title": r["title"] or "", "type": r["type"] or "note",
              "summary": r["summary"] or "", "category": (r["category"] or "").lower(), "color": r["color"] or "",
              "tags": [str(t).lower() for t in (r["tags"] or [])],
              "people": [str(p).lower() for p in (r["people"] or [])]} for r in rows
             if only is None or str(r["id"]) in only]  # None = whole graph; set = search hits only
    links = []  # O(n²) pair check: edge iff ≥1 shared tag/person (or same non-empty category).
    for i in range(len(notes)):
        for j in range(i + 1, len(notes)):
            a, b = notes[i], notes[j]
            shared = sorted(set(a["tags"]) & set(b["tags"]) | set(a["people"]) & set(b["people"]))
            if a["category"] and a["category"] == b["category"] and a["category"] not in shared:
                shared.insert(0, a["category"])
            if shared:
                links.append({"source": a["id"], "target": b["id"], "shared": shared, "weight": len(shared)})
    deg: dict[str, int] = {}  # degree = connection count → node size (r) below.
    for l in links:
        deg[l["source"]] = deg.get(l["source"], 0) + 1
        deg[l["target"]] = deg.get(l["target"], 0) + 1
    nodes = [{"id": n["id"], "title": n["title"], "type": n["type"], "summary": n["summary"], "category": n["category"], "color": n["color"],
              "deg": deg.get(n["id"], 0), "r": 8 + min(10, deg.get(n["id"], 0) * 2)} for n in notes]
    return {"nodes": nodes, "edges": links}
