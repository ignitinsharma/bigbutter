from openai import AsyncOpenAI
from core.config import settings

_client = None

def client():
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client

async def embed(text: str) -> list[float]:
    r = await client().embeddings.create(model=settings.embedding_model, input=text)
    return r.data[0].embedding

async def extract_note(text: str) -> dict:
    # ponytail: single vendor gpt-4o-mini, structured output
    prompt = (
        "Extract: title, type (idea|task|note|person|link|expense|journal), "
        "summary (1 line), tags[], people[], action_items[]. Return JSON.\n\n" + text
    )
    r = await client().chat.completions.create(
        model=settings.extraction_model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    import json
    return json.loads(r.choices[0].message.content)

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
