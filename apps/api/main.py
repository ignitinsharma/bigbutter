# bigbutter api: raw notes in, enlightened notes out.
# Imports: web framework + CORS, raw SQL, DB session, password hashing, env, feature routers.
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
