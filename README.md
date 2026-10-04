# bigbutter

Semantic notes. Type or speak a thought; AI gives it a title, summary, tags, type
(note / task / idea / …) and a **bucket** (Work, Technology, Shopping, …), links it to
related notes, and makes everything searchable by meaning.

- **Web**: Next.js 14 (`apps/web`) — Keep-style board, bucket + type filters, map view, voice input
- **API**: FastAPI (`apps/api`) — notes, AI enrichment, hybrid search, voice
- **DB**: Postgres + pgvector (Neon in production, Docker locally)
- **AI** (each engine switchable): OpenAI, or fully local — Ollama (Qwen), MiniLM embeddings, Whisper
- **Voice audio** (optional): private S3 bucket, presigned links

## Run locally

```bash
# 1. Database — Neon, or a local pgvector Postgres:
docker compose up -d db
#    then apply apps/api/db/migrations/*.sql in order (001 → 010)

# 2. API
cd apps/api
# create .env with at least the required settings below
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 3. Web
cd apps/web
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm install
npm run dev                   # http://localhost:3000
```

Log in with `APP_USER_EMAIL` / `APP_USER_PASSWORD` (the API creates or updates this account on start).

**Fully offline / no API key:** set `LLM_ENGINE=local` (run [Ollama](https://ollama.com) with
`ollama pull qwen2.5:1.5b`), `EMBED_ENGINE=local`, `TRANSCRIBE_ENGINE=local`.
With `LLM_ENGINE=off` notes are still organized by simple rules.

## Settings

**API — `apps/api/.env`** (never committed)

| Setting | What it does |
|---|---|
| `DATABASE_URL` | **Required.** Postgres + pgvector, `postgresql+asyncpg://…` |
| `JWT_SECRET` | **Required.** 32+ random chars (`openssl rand -hex 32`); signs logins |
| `APP_USER_EMAIL`, `APP_USER_PASSWORD` | **Required.** The login account, created/updated on every API start |
| `ENV` | `dev` (default) or `prod` — prod: Secure cookies, no API docs, refuses a weak `JWT_SECRET` |
| `CORS_ORIGINS` | Comma-separated web app URLs allowed to call the API (default `http://localhost:3000`) |
| `SESSION_DAYS` | Login lifetime (default 30) |
| `LLM_ENGINE` | `api` (OpenAI) · `local` (Ollama) · `off` (rules) |
| `EMBED_ENGINE` | `api` (OpenAI) · `local` (MiniLM) |
| `TRANSCRIBE_ENGINE` | `api` (OpenAI Whisper) · `local` (on-device Whisper) |
| `OPENAI_API_KEY` | Needed for any engine set to `api` |
| `LLM_BASE_URL`, `LLM_MODEL` | Ollama endpoint + model (defaults `http://localhost:11434/v1`, `qwen2.5:1.5b`) |
| `EXTRACTION_MODEL`, `SUMMARIZATION_MODEL`, `EMBEDDING_MODEL` | OpenAI model names (sensible defaults) |
| `SEARCH_MIN_SIM` | Meaning score a note needs to count as a match (default `0.30`) |
| `SEARCH_CANDIDATE_SIM` | Weak-meaning floor (default `0.20`): borderline notes the relevance check may keep, and the support a synonym-only keyword hit needs |
| `SEARCH_RERANK` | AI relevance check on borderline results (default `false`). Turn on with a capable LLM (e.g. OpenAI) — small local models judge poorly. Strong matches are never removed by it |
| `WISPR_API_KEY` | Optional — live voice streaming |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`, `S3_PREFIX`, `S3_ENDPOINT_URL`, `AUDIO_MAX_MB` | Optional — keep voice audio in a private S3 bucket (blank = audio not kept) |

**Web — `apps/web/.env.local`** (never committed): only `NEXT_PUBLIC_API_URL`.
Anything `NEXT_PUBLIC_*` is sent to the browser, so never put server secrets (DB URL, API keys, JWT secret) here.

## Scripts (`apps/api`)

| Command | What it does |
|---|---|
| `python3 scripts/reenrich.py [email]` | Re-run AI enrichment (title, summary, tags, bucket, vector) on every note |
| `python3 scripts/reenrich.py --buckets [email]` | Only (re)assign buckets; keeps hand-edited titles/tags and hand-picked buckets |
| `python3 scripts/prune_recordings.py [hours=24]` | Delete voice clips never attached to a note (safe for cron) |

## Production checklist

- `ENV=prod` — Secure cookies, API docs off, refuses to start with a weak secret
- `JWT_SECRET` — `openssl rand -hex 32` (changing it logs everyone out)
- `CORS_ORIGINS` — the web app's URL
- `NEXT_PUBLIC_API_URL` (web) — the API's URL
- Serve both over HTTPS
- Apply any new migrations before deploying the API
