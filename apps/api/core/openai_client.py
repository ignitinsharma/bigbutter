# openai_client: we burn tokens so you don't have to think.
import json
import re
from typing import Optional
import httpx
import openai
from openai import AsyncOpenAI
from core.config import settings
from core.local_extract import local_extract
from core.buckets import normalize as normalize_buckets, match as match_bucket
from core.prompts import EXTRACT_PROMPT, EXTRACT_INPUT, SCHEMA_ECHO, QUERY_PROMPT, QUERY_INPUT, JUDGE_PROMPT, SUMMARIZE_PROMPT
from core.wordlists import SEARCH_FILLER
from core import docs
from core.docs import doc

_client = None
_local = None

class NotConfigured(Exception):
    pass

def _require_key():
    # Fail fast when OPENAI_API_KEY is missing so callers can return 501/fallback.
    if not settings.openai_api_key:
        raise NotConfigured("OPENAI_API_KEY is not set")
    return settings.openai_api_key

def client():
    # Lazily build the shared AsyncOpenAI client (needs _require_key to pass first).
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=_require_key())
    return _client

@doc(docs.OPENAI_CLIENT_LLM)
def llm() -> tuple:
    global _local
    if settings.llm_engine == "local":
        if _local is None:
            _local = AsyncOpenAI(base_url=settings.llm_base_url, api_key="ollama",
                                 timeout=httpx.Timeout(20.0, connect=2.0), max_retries=0)
        return _local, settings.llm_model
    if settings.llm_engine == "off":
        raise NotConfigured("LLM_ENGINE=off")
    return client(), settings.extraction_model

@doc(docs.OPENAI_CLIENT_CHAT_JSON)
async def _chat_json(prompt: str) -> dict:
    c, model = llm()
    for _ in range(2):
        try:
            r = await c.chat.completions.create(
                model=model, temperature=0,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
        except openai.APIError as e:  # unreachable, timeout, 404, 429, 401, 5xx → caller's fallback
            raise NotConfigured(f"llm unavailable: {e}")
        out = (r.choices[0].message.content or "").replace("```json", "").replace("```", "").strip()
        try:
            return json.loads(out[out.index("{"):out.rindex("}") + 1])
        except ValueError:
            continue
    raise NotConfigured("llm returned invalid JSON twice")

async def embed(text: str) -> list[float]:
    # Embed text into a 1536-dim vector for the pgvector similarity leg.
    _require_key()
    try:
        r = await client().embeddings.create(model=settings.embedding_model, input=text)
    except openai.APIError as e:  # rate limit / bad key / outage → same fallback as no key
        raise NotConfigured(f"embeddings unavailable: {e}")
    return r.data[0].embedding

NOTE_TYPES = ("idea", "task", "note", "person", "link", "expense", "journal")

def _words(xs, n: int) -> list:
    # Lowercase + dedupe + trim a string list to n items (tags/keywords shape).
    return list(dict.fromkeys(str(x).lower().strip() for x in (xs or []) if str(x).strip()))[:n]

async def extract_note(text: str, known_tags: Optional[list] = None, known_categories: Optional[list] = None,
                       buckets: Optional[list] = None) -> dict:
    # Extract title/type/summary/bucket/category/tags/people/actions; normalizes + guards junk titles.
    tags = ", ".join((known_tags or [])[:40]) or "none"
    cats = ", ".join((known_categories or [])[:40]) or "none"
    bl = buckets or normalize_buckets(None)
    rec = await _chat_json(EXTRACT_PROMPT + EXTRACT_INPUT.format(buckets=', '.join(bl), tags=tags, cats=cats, text=text))
    rec["bucket"] = match_bucket(str(rec.get("bucket") or ""), bl) or ""  # off-list → "" (caller's fallback decides)
    if rec.get("type") not in NOTE_TYPES:
        rec["type"] = "note"
    rec["tags"] = _words(rec.get("tags"), 5)
    rec["people"] = [str(p).strip() for p in (rec.get("people") or []) if str(p).strip()]
    rec["action_items"] = [str(a).strip() for a in (rec.get("action_items") or []) if str(a).strip()]
    rec["category"] = " ".join(str(rec.get("category") or "").lower().split()[:3])
    rec["keywords"] = _words(rec.get("keywords"), 8)
    rec["title"] = str(rec.get("title") or "").strip()
    if _junk_title(rec["title"], text):
        rec["title"] = local_extract(text)["title"]
    rec["summary"] = str(rec.get("summary") or "").strip()
    if _junk_summary(rec["summary"]):
        rec["summary"] = local_extract(text)["summary"]
    return rec

def _stems(s: str) -> set:
    # 4-char word stems for fuzzy overlap checks (titles, query relevance).
    return {w[:4] for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) >= 3}

@doc(docs.OPENAI_CLIENT_JUNK_TITLE)
def _junk_title(title: str, raw: str) -> bool:
    low = title.lower().strip(" .\"'")
    return (len(low.split()) < 2 or low in NOTE_TYPES or "8 words" in low
            or not (_stems(title) & _stems(raw)))

@doc(docs.OPENAI_CLIENT_JUNK_SUMMARY)
def _junk_summary(summary: str) -> bool:
    low = summary.lower()
    return any(p in low for p in SCHEMA_ECHO)

_qcache: dict = {}

@doc(docs.OPENAI_CLIENT_CORE_QUERY)
def core_query(q: str) -> str:
    words = [w for w in re.findall(r"[a-z0-9]+", q.lower()) if w not in SEARCH_FILLER]
    return " ".join(words) or q.strip()

@doc(docs.OPENAI_CLIENT_ON_TOPIC)
def _on_topic(value: str, core: str) -> bool:
    words = re.findall(r"[a-z0-9]+", value.lower())
    return bool(words) and not all(w in SEARCH_FILLER for w in words) and bool(_stems(value) & _stems(core))

async def understand_query(q: str, known_categories: Optional[list] = None) -> dict:
    # Turn a search string into {terms, category, expansions}; cached per (query, categories).
    cats = ", ".join((known_categories or [])[:40]) or "none"
    key = (q.strip().lower(), cats)
    if key in _qcache:
        return _qcache[key]
    r = await _chat_json(QUERY_PROMPT + QUERY_INPUT.format(cats=cats, q=q))
    core = core_query(q)
    terms = str(r.get("terms") or "").strip()
    category = " ".join(str(r.get("category") or "").lower().split()[:3]) or None
    # Same check for every model: an answer about the search's own filler
    # ("notes") or unrelated to the user's words is dropped for their words.
    if not _on_topic(terms, core):
        terms = core
    if category and not _on_topic(category, core) and category not in (known_categories or []):
        category = None
    u = {"terms": terms, "category": category, "expansions": _words(r.get("expansions"), 6)}
    if len(_qcache) >= 128:
        _qcache.pop(next(iter(_qcache)))
    _qcache[key] = u
    return u

@doc(docs.OPENAI_CLIENT_JUDGE)
async def judge(q: str, notes: list[dict]) -> list[str]:
    lines = []
    for i, n in enumerate(notes, 1):
        body = " ".join((n.get("summary") or n.get("raw_text") or "").split())[:220]
        tags = ", ".join(n.get("tags") or [])
        lines.append(f"n{i}: {n.get('title') or ''} — {body}" + (f" (tags: {tags})" if tags else ""))
    r = await _chat_json(JUDGE_PROMPT.format(q=q.replace('"', "'"), notes="\n".join(lines)))
    picked = r.get("relevant")
    if not isinstance(picked, list):
        raise NotConfigured("relevance check returned no list")
    out = []
    for x in picked:
        m = re.fullmatch(r"n?(\d+)", str(x).strip().lower())
        if m and 1 <= int(m.group(1)) <= len(notes):
            out.append(str(notes[int(m.group(1)) - 1]["id"]))
    return list(dict.fromkeys(out))

async def transcribe(path: str) -> str:
    # Send an audio file to Whisper and return its transcript text.
    with open(path, "rb") as f:
        r = await client().audio.transcriptions.create(model="whisper-1", file=f)
    return r.text

async def summarize(query: str, notes: list[dict]) -> str:
    # Summarize the top search hits in 1-2 lines, grounded only in those notes.
    c, model = llm()
    if settings.llm_engine != "local":
        model = settings.summarization_model
    ctx = "\n".join(f"- [{n.get('category') or n.get('type')}] {n.get('title')}: {(n.get('raw_text') or '')[:400]}" for n in notes)
    try:
        r = await c.chat.completions.create(
            model=model, temperature=0.2,
            messages=[{"role": "user", "content": SUMMARIZE_PROMPT.format(ctx=ctx, query=query)}],
        )
    except openai.APIError as e:
        raise NotConfigured(f"llm unavailable: {e}")
    return (r.choices[0].message.content or "").strip()
