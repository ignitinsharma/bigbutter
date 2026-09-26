from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from routes.notes import me
from core.openai_client import extract_note, embed, NotConfigured

router = APIRouter()

def _501(resp: Response):
    resp.status_code = 501
    return {"error": "not_configured"}

class TextIn(BaseModel):
    text: str

@router.post("/extract")
async def extract(body: TextIn, resp: Response, uid: str = Depends(me)):
    try:
        return await extract_note(body.text)
    except NotConfigured:
        return _501(resp)

@router.post("/embed")
async def embed_text(body: TextIn, resp: Response, uid: str = Depends(me)):
    try:
        return {"embedding": await embed(body.text)}
    except NotConfigured:
        return _501(resp)
