# bigbutter api: raw notes in, enlightened notes out.
# Imports: web framework + CORS, raw SQL, DB session, password hashing, env, feature routers.
import asyncio
import threading
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from db.session import Session
from core.auth import hash_password
from core.config import settings
from routes.auth import router as auth_r
from routes.notes import router as notes_r
from routes.ai import router as ai_r
from routes.voice import router as voice_r
from routes.search_map import router as misc_r

# Used by: lifespan — first save after a restart used to pay ~13s (MiniLM) + ~6s (Qwen) of model loading.
def _warm_models() -> None:
    """Load the on-device models in a thread so the first request finds them ready."""
    t0 = time.perf_counter()
    steps = []
    if settings.embed_engine == "local":
        try:
            from core.local_embed import embed_local
            embed_local("warm up")
            steps.append("minilm")
        except Exception as e:
            print(f"warm-up: embeddings skipped ({e!r})")
    if settings.transcribe_engine == "local":
        try:
            from core.local_whisper import _model_once
            _model_once()
            steps.append("whisper")
        except Exception as e:
            print(f"warm-up: whisper skipped ({e!r})")
    if settings.llm_engine == "local":
        try:  # Ollama's native API: an empty prompt just loads the model into memory
            import httpx
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
    from core import storage
    if storage.half_configured():  # bucket without keys (or vice versa) → recordings silently off
        print("warning: S3 is partly configured (need S3_BUCKET + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY) — voice audio won't be kept")
    print(f"voice storage: {'s3://' + settings.s3_bucket if storage.enabled() else 'off'}")
    threading.Thread(target=_warm_models, name="warm-models", daemon=True).start()  # never blocks boot
    asyncio.create_task(_warm_db())
    yield  # boot done → app now serves requests until shutdown.
# Used by: uvicorn main:app — creates the app, runs lifespan on startup.
app = FastAPI(title="bigbutter api", lifespan=lifespan)
# Allow the Next.js dev server (localhost:3000) to call the API with cookies.
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
# Mount every feature router: /auth, /notes, /extract+/embed, /voice/*, /search + /map.
app.include_router(auth_r)
app.include_router(notes_r)
app.include_router(ai_r)
app.include_router(voice_r)
app.include_router(misc_r)

# Used by: deploy health checks + README verify (`curl localhost:8000/health`).
@app.get("/health")
def health():
    # Liveness probe for deploy platforms and the README verify step.
    return {"ok": True}
