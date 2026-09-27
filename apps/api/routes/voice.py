import os
import tempfile
from fastapi import APIRouter, Depends, Response, UploadFile, File
from routes.notes import me
from core.config import settings
from core.openai_client import transcribe, NotConfigured

router = APIRouter(prefix="/voice")

@router.get("/status")
async def status(uid: str = Depends(me)):
    return {"openai": bool(settings.openai_api_key), "wispr": bool(settings.wispr_api_key)}

@router.post("/transcribe")
async def transcribe_audio(resp: Response, audio: UploadFile = File(...), uid: str = Depends(me)):
    if not settings.openai_api_key:
        resp.status_code = 501
        return {"error": "not_configured"}
    suffix = os.path.splitext(audio.filename or "audio")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        path = tmp.name
    try:
        return {"transcript": await transcribe(path)}
    except NotConfigured:
        resp.status_code = 501
        return {"error": "not_configured"}
    finally:
        os.unlink(path)
