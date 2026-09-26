from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.auth import router as auth_r
from routes.notes import router as notes_r
from routes.ai import router as ai_r
from routes.search_map import router as misc_r

app = FastAPI(title="bigbutter api")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(auth_r)
app.include_router(notes_r)
app.include_router(ai_r)
app.include_router(misc_r)

@app.get("/health")
def health():
    return {"ok": True}
