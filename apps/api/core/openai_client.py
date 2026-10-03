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

def llm() -> tuple:
    """Chat client + model for LLM_ENGINE. Local = Ollama's OpenAI-compatible /v1,
    so OpenAI day is an env flip. Off → NotConfigured (callers fail open)."""
    global _local
    if settings.llm_engine == "local":
        if _local is None:
            _local = AsyncOpenAI(base_url=settings.llm_base_url, api_key="ollama",
                                 timeout=httpx.Timeout(20.0, connect=2.0), max_retries=0)
        return _local, settings.llm_model
    if settings.llm_engine == "off":
        raise NotConfigured("LLM_ENGINE=off")
    return client(), settings.extraction_model

async def _chat_json(prompt: str) -> dict:
    """One JSON-mode completion, one retry on bad JSON. Unreachable runtime or
    unparseable output → NotConfigured so every caller keeps its fallback."""
    c, model = llm()
    for _ in range(2):
        try:
            r = await c.chat.completions.create(
                model=model, temperature=0,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
        except (openai.APIConnectionError, openai.APITimeoutError, openai.NotFoundError) as e:
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
    r = await client().embeddings.create(model=settings.embedding_model, input=text)
    return r.data[0].embedding

NOTE_TYPES = ("idea", "task", "note", "person", "link", "expense", "journal")

EXTRACT_PROMPT = """Turn this raw personal capture into one structured record.
Return ONLY JSON: {"title":"under 8 words","type":"idea|task|note|person|link|expense|journal","summary":"1-2 short sentences, fix grammar, invent nothing","bucket":"exactly one name from the Buckets list","category":"1-3 lowercase words: what the note is ABOUT","keywords":["3-8 lowercase synonyms or broader terms for the category"],"tags":["2-5 lowercase topics"],"people":["names"],"action_items":["imperative phrases if actionable"]}
"task" only if they must DO something. "idea" for proposals and hypotheses. "expense" if money moved. "journal" for reflection. "note" is the fallback.
category resolves the word's MEANING in context — the same word can mean different things:
- "Apple is a great fruit" → category "fruit", keywords ["fruit","food","produce","healthy snack"]
- "Apple is a good mobile" → category "mobile phone", keywords ["phone","smartphone","mobile","device","iphone"]
- "Samsung is a mobile" → category "mobile phone", keywords ["phone","smartphone","mobile","device","android"]
bucket = the broad life area, copied exactly from the Buckets list below; "Other" only if none fits.
people = human names only, never brands or companies.
Reuse an existing tag or category whenever it fits — inventing a synonym leaves notes unconnected forever."""

def _words(xs, n: int) -> list:
    # Lowercase + dedupe + trim a string list to n items (tags/keywords shape).
    return list(dict.fromkeys(str(x).lower().strip() for x in (xs or []) if str(x).strip()))[:n]

async def extract_note(text: str, known_tags: Optional[list] = None, known_categories: Optional[list] = None,
                       buckets: Optional[list] = None) -> dict:
    # Extract title/type/summary/bucket/category/tags/people/actions; normalizes + guards junk titles.
    tags = ", ".join((known_tags or [])[:40]) or "none"
    cats = ", ".join((known_categories or [])[:40]) or "none"
    bl = buckets or normalize_buckets(None)
    rec = await _chat_json(f"{EXTRACT_PROMPT}\n\nBuckets: {', '.join(bl)}\nExisting tags: {tags}\nExisting categories: {cats}\n\nCapture:\n\"\"\"{text}\"\"\"")
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

def _junk_title(title: str, raw: str) -> bool:
    """Small local models echo the schema ("under 8 words") or answer with the
    type ("task"). Titles like that — or ones sharing no word stem with the
    capture — fall back to the rule title (first words of the note)."""
    low = title.lower().strip(" .\"'")
    return (len(low.split()) < 2 or low in NOTE_TYPES or "8 words" in low
            or not (_stems(title) & _stems(raw)))

# Phrases from EXTRACT_PROMPT's schema; a summary containing them is an echo, not a summary.
_SCHEMA_ECHO = ("short sentences", "invent nothing", "fix grammar")

def _junk_summary(summary: str) -> bool:
    """Models sometimes return the schema placeholder ("1-2 short sentences, fix
    grammar, invent nothing") as the summary — fall back to the rule summary."""
    low = summary.lower()
    return any(p in low for p in _SCHEMA_ECHO)

QUERY_PROMPT = """You turn a search over personal notes into retrieval hints.
Return ONLY JSON: {"terms":"the core subject words, no question filler","category":"1-3 lowercase words or empty","expansions":["3-6 lowercase synonyms / related words"]}
Resolve the MEANING: "best phone" → {"terms":"best phone","category":"mobile phone","expansions":["smartphone","mobile","phone","device","iphone","android"]}
Strip filler: "is there any kind of fruit notes present?" → {"terms":"fruit","category":"fruit","expansions":["fruit","food","produce"]}
Prefer one of the existing categories when it matches."""

_qcache: dict = {}

# Words that describe the search itself, not what it's about.
_META = set(
    "notes note related relating regarding about any show me my find all there present kind kinds of "
    "the a an some please what which do does i have has is are to for on with stuff things thing anything "
    "get list search give tell".split()
)

def core_query(q: str) -> str:
    """The user's own subject words: "notes related to mobile phones" → "mobile phones".
    Deterministic, model-independent; falls back to the query when nothing's left."""
    words = [w for w in re.findall(r"[a-z0-9]+", q.lower()) if w not in _META]
    return " ".join(words) or q.strip()

def _on_topic(value: str, core: str) -> bool:
    """LLM output is usable if it isn't pure filler and shares a word stem with the query."""
    words = re.findall(r"[a-z0-9]+", value.lower())
    return bool(words) and not all(w in _META for w in words) and bool(_stems(value) & _stems(core))

async def understand_query(q: str, known_categories: Optional[list] = None) -> dict:
    # Turn a search string into {terms, category, expansions}; cached per (query, categories).
    cats = ", ".join((known_categories or [])[:40]) or "none"
    key = (q.strip().lower(), cats)
    if key in _qcache:
        return _qcache[key]
    r = await _chat_json(f"{QUERY_PROMPT}\n\nExisting categories: {cats}\n\nSearch: \"{q}\"")
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

async def rerank(q: str, notes: list[dict]) -> list[str]:
    # Ask the LLM which of the top-10 candidates are truly relevant; returns kept ids.
    ctx = "\n".join(f"{i}. [{n.get('category') or '-'}] {(n.get('raw_text') or '')[:200]}" for i, n in enumerate(notes))
    r = await _chat_json(f"Search: \"{q}\"\nNotes:\n{ctx}\nWhich notes are actually relevant to the search meaning? "
                         "Return ONLY JSON: {\"relevant\":[note numbers]}")
    keep = {int(i) for i in (r.get("relevant") or []) if str(i).isdigit() and int(i) < len(notes)}
    return [str(notes[i]["id"]) for i in sorted(keep)]

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
            messages=[{"role": "user", "content": f"Notes:\n{ctx}\n\nThey searched for '{query}'. Answer in 1-2 short lines using ONLY these notes."}],
        )
    except (openai.APIConnectionError, openai.APITimeoutError, openai.NotFoundError) as e:
        raise NotConfigured(f"llm unavailable: {e}")
    return (r.choices[0].message.content or "").strip()
