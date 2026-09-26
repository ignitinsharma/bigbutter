from typing import Optional
from openai import AsyncOpenAI
from core.config import settings

_client = None

class NotConfigured(Exception):
    pass

def _require_key():
    if not settings.openai_api_key:
        raise NotConfigured("OPENAI_API_KEY is not set")
    return settings.openai_api_key

def client():
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=_require_key())
    return _client

async def embed(text: str) -> list[float]:
    _require_key()
    r = await client().embeddings.create(model=settings.embedding_model, input=text)
    return r.data[0].embedding

NOTE_TYPES = ("idea", "task", "note", "person", "link", "expense", "journal")

EXTRACT_PROMPT = """Turn this raw personal capture into one structured record.
Return ONLY JSON: {"title":"under 8 words","type":"idea|task|note|person|link|expense|journal","summary":"1-3 clean sentences, fix grammar, invent nothing","tags":["2-5 lowercase topics"],"people":["names"],"action_items":["imperative phrases if actionable"]}
"task" only if they must DO something. "idea" for proposals and hypotheses. "expense" if money moved. "journal" for reflection. "note" is the fallback.
Reuse an existing tag whenever it fits — inventing a synonym leaves notes unconnected forever."""

async def extract_note(text: str, known_tags: Optional[list] = None) -> dict:
    _require_key()
    known = ", ".join((known_tags or [])[:40]) or "none"
    r = await client().chat.completions.create(
        model=settings.extraction_model,
        messages=[{"role": "user", "content": f"{EXTRACT_PROMPT}\n\nExisting tags: {known}\n\nCapture:\n\"\"\"{text}\"\"\""}],
        response_format={"type": "json_object"},
    )
    import json
    out = r.choices[0].message.content.replace("```json", "").replace("```", "").strip()
    rec = json.loads(out[out.index("{"):out.rindex("}") + 1])
    if rec.get("type") not in NOTE_TYPES:
        rec["type"] = "note"
    rec["tags"] = [str(t).lower().strip() for t in (rec.get("tags") or [])][:5]
    rec["people"] = [str(p).strip() for p in (rec.get("people") or []) if str(p).strip()]
    rec["action_items"] = [str(a).strip() for a in (rec.get("action_items") or []) if str(a).strip()]
    rec.setdefault("title", "")
    rec.setdefault("summary", "")
    return rec

async def transcribe(path: str) -> str:
    with open(path, "rb") as f:
        r = await client().audio.transcriptions.create(model="whisper-1", file=f)
    return r.text

async def summarize(query: str, notes: list[dict]) -> str:
    ctx = "\n".join(f"- {n.get('title')}: {n.get('raw_text','')[:500]}" for n in notes)
    r = await client().chat.completions.create(
        model=settings.summarization_model,
        messages=[{"role": "user", "content": f"Notes:\n{ctx}\nThey searched for '{query}'. Summarize in 2-3 lines."}],
    )
    return r.choices[0].message.content
