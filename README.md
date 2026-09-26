# bigbutter — semantic notes

Monorepo: `apps/api` (FastAPI) + `apps/web` (Next.js). DB: Neon Postgres + pgvector.

Setup:
1. `cp .env.example .env` + fill Neon `DATABASE_URL`, `OPENAI_API_KEY`, `JWT_SECRET`
2. DB: run `apps/api/db/migrations/001_init.sql` on Neon (or `docker compose up -d db` for local)
3. API: `cd apps/api && pip install -r requirements.txt && uvicorn main:app --reload`
4. Web: `cd apps/web && npm i && npm run dev`
5. Create user: `cd apps/api && python scripts/create_user.py you@mail.com secret`

See `development-plan.md` for 8-phase build order.
