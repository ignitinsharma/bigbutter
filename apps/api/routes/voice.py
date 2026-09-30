# voice routes: shhh... listening (with permission).
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
    # Report which voice/AI engines are configured so the UI picks a tier without guessing.
    return {"openai": bool(settings.openai_api_key), "wispr": bool(settings.wispr_api_key),
            "transcribe": settings.transcribe_engine, "embed": settings.embed_engine, "llm": settings.llm_engine}

# Used by: Tier-2 voice (upload) in notes/page.tsx startUpload/stopRecorder.
# Flow: mic → MediaRecorder → POST here as multipart audio → transcript back into
# the editable draft → user reviews → Save (POST /notes). Never saves anything itself.
# Engines: TRANSCRIBE_ENGINE=local → on-device Whisper tiny (no key, offline);
# otherwise Whisper API (needs OPENAI_API_KEY, else 501 → UI falls back to browser SR).
@router.post("/transcribe")
async def transcribe_audio(resp: Response, audio: UploadFile = File(...), uid: str = Depends(me)):
    # Transcribe an uploaded clip (local tiny or Whisper API); returns text, saves nothing.
    if settings.transcribe_engine == "local":
        from core.local_whisper import transcribe_local
        suffix = os.path.splitext(audio.filename or "audio")[1] or ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:  # whisper needs a file path
            tmp.write(await audio.read())
            path = tmp.name
        try:
            return {"transcript": transcribe_local(path), "engine": "local"}
        finally:
            os.unlink(path)  # temp clip deleted immediately after transcription
    if not settings.openai_api_key:
        resp.status_code = 501  # keyless → frontend shows "not configured", keeps Tier-3 browser dictation
        return {"error": "not_configured"}
    suffix = os.path.splitext(audio.filename or "audio")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        path = tmp.name
    try:
        return {"transcript": await transcribe(path)}  # Whisper API call via core/openai_client
    except NotConfigured:
        resp.status_code = 501
        return {"error": "not_configured"}
    finally:
        os.unlink(path)

# Used by: Tier-1 voice (live streaming) in notes/page.tsx startWispr + lib/voice-wispr.ts.
# Flow: frontend POSTs here (empty JSON) → gets short-lived {access_token, ws_url} →
# opens WS to Wispr directly (auth → append PCM chunks → commit) → live transcript.
# Why a backend route at all: the long-lived org key (WISPR_API_KEY) must never reach
# the browser; this mints a 1-hour user-scoped client token instead. No key → 501,
# and the UI steps down to Tier-2 upload. Wispr API down → 502 provider_error.
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
