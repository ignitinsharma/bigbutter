# ai routes: debug endpoints, mind the 501s.
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from routes.notes import me
from core.openai_client import extract_note, embed, NotConfigured

router = APIRouter()

def _501(resp: Response):
    # Standard "AI not configured" reply for key-gated debug endpoints.
    resp.status_code = 501
    return {"error": "not_configured"}

class TextIn(BaseModel):
    text: str

@router.post("/extract")
async def extract(body: TextIn, resp: Response, uid: str = Depends(me)):
    # Debug: run the extraction prompt on arbitrary text without saving a note.
    try:
        return await extract_note(body.text)
    except NotConfigured:
        return _501(resp)

@router.post("/embed")
async def embed_text(body: TextIn, resp: Response, uid: str = Depends(me)):
    # Debug: embed arbitrary text and return the raw vector (for key/config checks).
    try:
        return {"embedding": await embed(body.text)}
    except NotConfigured:
        return _501(resp)
