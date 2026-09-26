# Semantic Notes — Development Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo FastAPI + Next.js semantic notes app with Neon Postgres+pgvector, manual 1-2 users, tag/person graph map.

**Architecture:** `apps/api` owns all AI calls + DB; `apps/web` is thin UI + d3-force graph computed live from tags/people. No background jobs for v1.

**Tech Stack:** FastAPI, Next.js + Tailwind, Neon Postgres + pgvector (HNSW), OpenAI `text-embedding-3-small` + `gpt-4o-mini` + Whisper, JWT httpOnly cookie, d3-force.

## Global Constraints
- Backend never exposes OpenAI keys; frontend calls only backend.
- All data routes scoped to session `user_id` from day 1.
- No signup / no reset; users inserted manually with bcrypt hash.
- Embedding model version stored in `model_version`.
- Graph = shared tag/person edges, not embedding projection.

---

## Monorepo Setup (from existing doc — preserved)

Set up a monorepo with this structure — simple folders, no Turborepo, no shared build tooling:

```
apps/
  web/        → Next.js frontend
  api/        → FastAPI backend
docker-compose.yml   → optional, local Postgres+pgvector fallback for dev (not required if using hosted Neon)
README.md
```

Deployment — deploy each app independently, not as a coupled unit:

- `apps/web` deploys to Vercel with its project root set to `apps/web`.
- `apps/api` deploys to Render/Fly/Railway with root/Dockerfile context set to `apps/api`.
- No shared build step between them. Each redeploys independently when its own folder changes.

Types — skip a shared-types package for v1:

Don't set up a `packages/shared-types` workspace. It only makes sense for shared JS/TS code, and the backend is Python — a shared TS package would need duplication as Pydantic models anyway. Define shapes once in TS (`apps/web`) and Pydantic (`apps/web`... `apps/api`), keep in sync by hand.

## File Structure

```
bigbutter/
  apps/api/
    main.py
    core/config.py, core/auth.py, core/openai_client.py
    db/session.py, db/migrations/001_init.sql
    scripts/create_user.py
    routes/auth.py, routes/notes.py, routes/search.py, routes/map.py
    requirements.txt
  apps/web/
    app/(auth)/login/page.tsx, app/notes/page.tsx, app/search/page.tsx, app/map/page.tsx
    components/NoteInput.tsx, NoteList.tsx, SearchBar.tsx, GraphView.tsx
    lib/api.ts
    .env.local
  docker-compose.yml
  .env.example
```

## Resources (provision before Task 1)
- Neon Postgres + pgvector, `DATABASE_URL`
- OpenAI key, `OPENAI_API_KEY`; models: `text-embedding-3-small`, `gpt-4o-mini` (extract+summarize single vendor)
- `JWT_SECRET` (32+ random bytes)

---

### Task 1: Skeleton + DB + login
- [ ] Migration `001_init.sql`: users, notes (text[] tags/people/action_items), note_embeddings vector(1536) + HNSW + tsvector
- [ ] `create_user.py` bcrypt insert
- [ ] Auth routes + httpOnly JWT + scoping middleware
- [ ] Login page + `lib/api.ts`
- [ ] Manual test: migrate → create user → login → 401 without cookie
- [ ] Commit

### Task 2: Text notes CRUD (no AI)
- [ ] POST/GET/PUT/DELETE `/notes` scoped to user
- [ ] Input box + list UI, type dropdown plain update
- [ ] Commit

### Task 3: Extraction + embeddings
- [ ] `extract_note()` structured output (idea,task,note,person,link,expense,journal) + `embed()`
- [ ] Save/edit runs both synchronously in transaction
- [ ] Commit

### Task 4: Hybrid search
- [ ] Query embed + pgvector cosine (top 20) parallel with tsvector, RRF merge
- [ ] `GET /search?q=` + SearchBar UI
- [ ] Commit

### Task 5: Voice input
- [ ] `POST /notes/transcribe` Whisper (no save) + record → review → save UI
- [ ] Commit

### Task 6: Map view
- [ ] `GET /map` graph builder (edge iff shared tag/person, weight=count), d3-force UI, click detail
- [ ] Commit

### Task 7: RAG summarization
- [ ] `summarize(query, notes)` wired into `/search` response, shown above results
- [ ] Commit

### Task 8: Polish
- [ ] Map highlight from matched_ids, loading/error states, responsive, full E2E
