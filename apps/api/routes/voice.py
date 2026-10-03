# voice routes: shhh... listening (with permission).
"""Voice → text, with the audio kept in S3 (core/storage.py).

Flow (Whisper upload tier, notes/page.tsx):
  stop recording → POST /voice/transcribe (audio + duration_ms)
    ├ store():  S3 upload → INSERT recordings row (s3_url, presigned_url, uploaded_at …)
    └ Whisper on the same bytes                       ← both run in parallel
  → {transcript, recording_id} → draft → Save (POST /notes) links the clip to the note
  → BackgroundTask _finalize writes status + transcript onto the row.
Failure rules: upload fails → no row, transcript still returned (recording_id null);
row insert fails → uploaded object deleted; Whisper fails but audio stored → 502 with
recording_id so the UI offers Retry (POST /voice/recordings/{id}/retry reads it back).
Playback: GET /notes/{id} returns each clip's stored 7-day link, re-signed when stale.
"""
import asyncio
import logging
import os
import tempfile
import uuid
from typing import Tuple
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Request, Response, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import text as sql  # alias: `text` would clash with transcript variables
from sqlalchemy.ext.asyncio import AsyncSession
from db.session import engine, get_session
from routes.notes import me
from core import storage
from core.config import settings
from core.openai_client import transcribe, NotConfigured

router = APIRouter(prefix="/voice")
log = logging.getLogger("bigbutter.voice")

@router.get("/status")
async def status(uid: str = Depends(me)):
    # Report which voice/AI engines are configured so the UI picks a tier without guessing.
    return {"openai": bool(settings.openai_api_key), "wispr": bool(settings.wispr_api_key),
            "transcribe": settings.transcribe_engine, "embed": settings.embed_engine, "llm": settings.llm_engine,
            "storage": storage.enabled()}

# Used by: transcribe_audio() + retry() — one place that knows the engines.
def _can_transcribe() -> bool:
    return settings.transcribe_engine == "local" or bool(settings.openai_api_key)

# Used by: _transcribe_bytes — picks local Whisper or the Whisper API.
async def _transcribe_path(path: str) -> Tuple[str, str]:
    # (text, engine). Local Whisper is CPU-bound → threadpool so the S3 upload runs alongside.
    if settings.transcribe_engine == "local":
        from core.local_whisper import transcribe_local
        return await run_in_threadpool(transcribe_local, path), "local"
    return await transcribe(path), "api"

# Used by: transcribe_audio() + retry() — Whisper needs a file, so bytes go via a temp file.
async def _transcribe_bytes(data: bytes, ext: str) -> Tuple[str, str]:
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:  # whisper needs a file path
        tmp.write(data)
        path = tmp.name
    try:
        return await _transcribe_path(path)
    finally:
        os.unlink(path)  # temp copy never outlives the request

# Used by: transcribe_audio (row insert), _finalize — single-statement writes.
async def _exec(q: str, p: dict) -> None:
    # One autocommit statement = one round trip. Neon is ~300ms away, so the voice hot
    # path pays for one trip (hidden behind Whisper) instead of BEGIN/INSERT/COMMIT.
    async with engine.connect() as c:
        c = await c.execution_options(isolation_level="AUTOCOMMIT")
        await c.execute(sql(q), p)

# Used by: transcribe_audio via BackgroundTasks (after the response is sent).
async def _finalize(rid: str, ok: bool, words: str, engine_name: str, err: str) -> None:
    # After the response: settle status/transcript. Never downgrades a clip the user already saved (note_id set).
    try:
        await _exec("UPDATE recordings SET status=CASE WHEN note_id IS NULL THEN :st ELSE status END, "
                    "transcript=:t, engine=:e, error=:er WHERE id=CAST(:i AS uuid)",
                    {"st": "transcribed" if ok else "failed", "t": words, "e": engine_name, "er": err, "i": rid})
    except Exception as e:  # row stays 'uploading' (all URL fields already set); still linkable
        log.warning("finalize failed rid=%s: %r", rid, e)

# Used by: retry() — ownership check before touching a clip.
async def _own_recording(s: AsyncSession, uid: str, rid: str):
    # Recording row owned by this user, or None (bad uuid / other user's / missing).
    try:
        uuid.UUID(rid)
    except ValueError:
        return None
    return (await s.execute(sql("SELECT id, s3_key, note_id, presigned_url, presigned_expires_at FROM recordings "
                                "WHERE id=CAST(:i AS uuid) AND user_id=:u"),
                            {"i": rid, "u": uid})).mappings().first()

# Used by: Tier-2 voice (upload) in notes/page.tsx startUpload/stopRecorder.
# Flow: mic → MediaRecorder → POST here (audio + duration_ms) → S3 upload ∥ Whisper from the same
# bytes → {transcript, recording_id} → editable draft → Save links the recording (POST /notes).
# S3 off → same as before (transcript only, recording_id null). Failure rules: module docstring.
@router.post("/transcribe")
async def transcribe_audio(req: Request, resp: Response, tasks: BackgroundTasks, audio: UploadFile = File(...),
                           duration_ms: int = Form(0), uid: str = Depends(me)):
    """Store the clip in S3 and transcribe it at the same time; returns text + recording id."""
    if not _can_transcribe():
        resp.status_code = 501  # keyless → frontend shows "not configured", keeps Tier-3 browser dictation
        return {"error": "not_configured"}
    limit = settings.audio_max_mb * 1024 * 1024
    if int(req.headers.get("content-length") or 0) > limit + 64 * 1024:  # declared too big → refuse before reading (+form overhead)
        resp.status_code = 413
        return {"error": "too_large"}
    data = await audio.read(limit + 1)  # never hold more than the limit (+1 byte to detect overflow) in memory
    if not data:
        resp.status_code = 400
        return {"error": "empty_audio"}
    if len(data) > limit:
        resp.status_code = 413
        return {"error": "too_large"}
    mime = (audio.content_type or "audio/webm").split(";")[0].strip().lower()  # drop ";codecs=opus"
    ext = storage.AUDIO_EXT.get(mime)
    if not ext:
        resp.status_code = 415
        return {"error": "unsupported_audio"}
    rid = str(uuid.uuid4())
    key = storage.audio_key(uid, rid, ext) if storage.enabled() else ""

    d_ms = max(0, min(duration_ms, 3_600_000))

    async def store() -> bool:
        # Upload, then write the row with every mandatory field. Row exists ⇔ object exists,
        # and it lands before the response so an immediate Save can link it.
        if not key:
            return False
        await run_in_threadpool(storage.put_audio, key, data, mime)
        try:
            url, exp = storage.presign_get(key)  # local signing, no network
            await _exec("INSERT INTO recordings (id, user_id, s3_key, mime, size_bytes, duration_ms, "
                        "s3_url, presigned_url, presigned_expires_at, uploaded_at) "
                        "VALUES (CAST(:i AS uuid), :u, :k, :m, :b, :d, :su, :pu, :pe, now())",
                        {"i": rid, "u": uid, "k": key, "m": mime, "b": len(data), "d": d_ms,
                         "su": storage.object_url(key), "pu": url, "pe": exp})
        except Exception:
            tasks.add_task(run_in_threadpool, storage.delete, [key])  # object without a row → remove it
            raise
        return True

    # Store chain (S3 ~0.1s → row ~0.3s) runs alongside Whisper.
    st, tx = await asyncio.gather(store(), _transcribe_bytes(data, ext), return_exceptions=True)
    stored = st is True
    ok = not isinstance(tx, BaseException)
    words, engine_name = tx if ok else ("", "")
    if key and not stored:
        log.warning("recording not kept rid=%s: %r", rid, st)  # transcript still returned
    if stored:  # settle status/transcript after responding
        tasks.add_task(_finalize, rid, ok, words, engine_name, "" if ok else type(tx).__name__)
    if ok:
        return {"transcript": words, "engine": engine_name, "recording_id": rid if stored else None}
    log.warning("transcribe failed rid=%s stored=%s: %r", rid, stored, tx)
    if isinstance(tx, NotConfigured) and not stored:
        resp.status_code = 501
        return {"error": "not_configured"}
    resp.status_code = 502  # recording_id set → audio safe in S3 → UI offers Retry
    return {"error": "transcribe_failed", "recording_id": rid if stored else None}

# Used by: Retry on the "Couldn't transcribe — your audio is saved" notice (notes/page.tsx).
# The only normal path that reads audio back from S3.
@router.post("/recordings/{rid}/retry")
async def retry(rid: str, resp: Response, uid: str = Depends(me), s: AsyncSession = Depends(get_session)):
    """Re-transcribe a stored clip — pulls the audio back from S3."""
    row = await _own_recording(s, uid, rid)
    if not row or not storage.enabled():
        raise HTTPException(404)
    if not _can_transcribe():
        resp.status_code = 501
        return {"error": "not_configured"}
    try:
        data = await run_in_threadpool(storage.get_audio, row["s3_key"])
        words, engine = await _transcribe_bytes(data, os.path.splitext(row["s3_key"])[1] or ".webm")
    except Exception as e:
        log.warning("retry failed rid=%s: %r", rid, e)
        await s.execute(sql("UPDATE recordings SET error=:er WHERE id=CAST(:i AS uuid)"), {"er": type(e).__name__, "i": rid})
        await s.commit()
        resp.status_code = 502
        return {"error": "transcribe_failed", "recording_id": rid}
    await s.execute(sql("UPDATE recordings SET status=CASE WHEN note_id IS NULL THEN 'transcribed' ELSE status END, "
                        "transcript=:t, engine=:e, error='' WHERE id=CAST(:i AS uuid)"),
                    {"t": words, "e": engine, "i": rid})
    await s.commit()
    return {"transcript": words, "engine": engine, "recording_id": rid}

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
