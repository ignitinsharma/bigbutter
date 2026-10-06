# bigbutter api: raw notes in, enlightened notes out.
# Imports: web framework + CORS, raw SQL, DB session, password hashing, env, feature routers.
import asyncio
import threading
import time
import docs
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from db.session import Session
from core import storage
from core.auth import hash_password, check_secret
from core.config import settings, is_prod
from core.local_embed import embed_local
from routes.auth import router as auth_r
from routes.notes import router as notes_r
from routes.voice import router as voice_r
from routes.search_map import router as misc_r
from core.docs import doc

# Used by: lifespan — first save after a restart used to pay ~13s (MiniLM) + ~6s (Qwen) of model loading.
@doc(docs.MAIN_WARM_MODELS)
def _warm_models() -> None:
    t0 = time.perf_counter()
    steps = []
    if settings.embed_engine == "local":
        try:
            embed_local("warm up")
            steps.append("minilm")
        except Exception as e:
            print(f"warm-up: embeddings skipped ({e!r})")
    if settings.transcribe_engine == "local":
        try:
            # Delayed on purpose: core.local_whisper imports whisper + torch (seconds, ~GB) at load.
            from core.local_whisper import _model_once
            _model_once()
            steps.append("whisper")
        except Exception as e:
            print(f"warm-up: whisper skipped ({e!r})")
    if settings.llm_engine == "local":
        try:  # Ollama's native API: an empty prompt just loads the model into memory
            base = settings.llm_base_url.rstrip("/").removesuffix("/v1")  # http://localhost:11434
            httpx.post(f"{base}/api/generate", json={"model": settings.llm_model, "prompt": ""}, timeout=60)
            steps.append("ollama")
        except Exception as e:
            print(f"warm-up: ollama skipped ({e!r})")
    print(f"warm-up done in {time.perf_counter() - t0:.1f}s ({', '.join(steps) or 'nothing local'})")

async def _warm_db() -> None:
    # Open a pooled TLS connection to Neon now, not on the first user request.
    try:
        async with Session() as s:
            await s.execute(text("SELECT 1"))
    except Exception as e:
        print(f"warm-up: db skipped ({e!r})")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Boot: upsert the env-configured user so login works with zero manual steps.
    if settings.app_user_email and settings.app_user_password:
        email = settings.app_user_email.strip().lower()
        async with Session() as s:
            await s.execute(
                text("INSERT INTO users (email, password_hash) VALUES (:e,:h) "
                     "ON CONFLICT (email) DO UPDATE SET password_hash=:h"),
                {"e": email, "h": hash_password(settings.app_user_password)},
            )
            await s.commit()
        print(f"env user ensured: {email}")
    if storage.half_configured():  # bucket without keys (or vice versa) → recordings silently off
        print("warning: S3 is partly configured (need S3_BUCKET + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY) — voice audio won't be kept")
    print(f"voice storage: {'s3://' + settings.s3_bucket if storage.enabled() else 'off'}")
    threading.Thread(target=_warm_models, name="warm-models", daemon=True).start()  # never blocks boot
    asyncio.create_task(_warm_db())
    yield  # boot done → app now serves requests until shutdown.
check_secret()  # ENV=prod + weak JWT_SECRET → refuse to boot (forgeable sessions)
# Used by: uvicorn main:app — creates the app, runs lifespan on startup. API docs only outside prod.
_docs = {} if not is_prod() else {"docs_url": None, "redoc_url": None, "openapi_url": None}
app = FastAPI(title="bigbutter api", lifespan=lifespan, **_docs)
# Allow the web app (CORS_ORIGINS, default the Next.js dev server) to call the API with cookies.
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
# Mount every feature router: /auth, /notes, /voice/*, /search + /map.
app.include_router(auth_r)
app.include_router(notes_r)
app.include_router(voice_r)
app.include_router(misc_r)

# Used by: deploy health checks + README verify (`curl localhost:8000/health`).
@app.get("/health")
def health():
    # Liveness probe for deploy platforms and the README verify step.
    return {"ok": True}
