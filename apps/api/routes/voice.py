import os
import tempfile
import httpx
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

@router.post("/token")
async def mint_token(resp: Response, uid: str = Depends(me)):
    """Mint a short-lived Wispr client token. Org key never leaves the backend."""
    if not settings.wispr_api_key:
        resp.status_code = 501
        return {"error": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                "https://platform-api.wisprflow.ai/api/v1/dash/generate_access_token",
                headers={"Authorization": f"Bearer {settings.wispr_api_key}"},
                json={"client_id": uid, "duration_secs": 3600},
            )
        if r.status_code != 200:
            resp.status_code = 502
            return {"error": "provider_error"}
        body = r.json()
        return {"access_token": body["access_token"], "expires_in": body.get("expires_in", 3600),
                "ws_url": settings.wispr_ws_url}
    except httpx.HTTPError:
        resp.status_code = 502
        return {"error": "provider_error"}
