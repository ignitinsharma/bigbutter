# todo.md — bigbutter build tracker

> Workflow per step: AI writes code → AI reviews → mark `[x]` only if review passes.
> Source of truth: `dev.md` (product) + `development-plan.md` (stack) + `prototype.html` (theme/UI).
> Stack: `apps/web` Next.js + `apps/api` FastAPI, Neon Postgres + pgvector (HNSW).
> Keys: backend-only. Endpoints read `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` from env.
> If unset → `501 {"error":"not_configured"}`. No mocks. Frontend never holds keys.

## Theme tokens (from prototype.html — enforce everywhere)

```
--paper:#EFEDE6 --card:#FAF9F6 --line:#DCD7CA --ink:#241C33
--soft:#413B31 --muted:#6B6558 --faint:#9A9384 --accent:#8A5A00
Fonts: Newsreader (h1/h2, weight 400) + Inter (body 15px, lh 1.6)
Layout: .wrap max-width 1060px, padding 26px 20px 70px
Grid: 320px sidebar (sticky top 20px) + 1fr; ≤800px single column
Card: bg var(--card), 1px var(--line), radius 4px
Primary btn: bg var(--ink), color var(--card), 8px 16px, radius 3px, 13px/500
Secondary btn: bg #E5E1D6, color #4A4437
```

Type chips (hue / bg):

```
idea    #8A5A00 / #F6EBD2
task    #5B3A7E / #EDE4F5
note    #3F4B5B / #E3E8EE
person  #3F6B4A / #E0EDE2
link    #1F5E77 / #DDEDF3
expense #8C4426 / #F7E4DA
journal #8A3C56 / #F7E1E8
```

Map: `drawMap()` d3-force — link (distance 130-min(60,w*18), strength min(0.85,0.25+w*0.18)), charge -300, center, collide r+22. Edge stroke #B3AB98 width min(4,w*1.3). Node r=8+min(10,deg*2). Grid pattern dots #DCD7CA.

---

## F0 — Basic setup

- [x] F0.1 Monorepo layout verified: `apps/web`, `apps/api`, `.env.example`, `docker-compose.yml`, `README.md`
  - Files: `apps/web/package.json`, `apps/api/requirements.txt`, `.env.example`
  - Done when: `ls apps` shows `web api`; review passes
- [x] F0.2 Web deps installed: `next@14`, `react@18`, `d3-force`, `tailwindcss`, TS types
  - Run: `cd apps/web && npm i`
  - Done when: `npm ls next` ok
- [x] F0.3 API deps installed: `fastapi uvicorn sqlalchemy asyncpg pgvector openai bcrypt python-jose pydantic-settings`
  - Run: `cd apps/api && pip3 install -r requirements.txt`
  - Done when: `python3 -c "import fastapi"` ok
- [x] F0.4 Env files: copy `.env.example` → `.env` (api) + `.env.local` (web)
  - Vars: `DATABASE_URL`, `OPENAI_API_KEY=`, `ANTHROPIC_API_KEY=`, `JWT_SECRET`, `NEXT_PUBLIC_API_URL=http://localhost:8000`
  - Done when: both files exist, keys empty allowed (501 path)
- [x] **AI review gate F0** — scaffold boots (`/health ok`), keys empty (501 path), no secrets

## F1 — Login page (theme-matched; prototype has none, keep minimal)

- [x] F1.1 Route `apps/web/app/(auth)/login/page.tsx`: paper bg, centered card, Newsreader title, email+password inputs (`.in` style), primary login btn, error text
  - Done when: renders on `npm run dev`, focus-visible accent outline
- [x] F1.2 Wire `lib/api.ts` → `POST /auth/login`, `credentials:include`, redirect `/notes` on ok, show "bad credentials" on 401
  - Done when: bad login shows error, good login sets cookie + redirects
- [x] **AI review gate F1** — build passes (/login 88kB), theme + error states verified

## F2 — Home single page (input + list same screen)

- [ ] F2.1 Layout `apps/web/app/notes/page.tsx` (or `/home`): header "Everything you said" + `{n} notes · {m} connections`, sidebar + main grid, stream/map toggle
  - Done when: matches prototype header/grid at 1060px and single-col ≤800px
- [ ] F2.2 Input card: textarea `#draft` 5 rows, placeholder Speak/Listening states, Speak/Stop + Save buttons, `Cmd/Ctrl+Enter` saves, disabled when empty/busy, `Filing…` busy label
  - Done when: typing enables Save; empty disables
- [ ] F2.3 Entry card: left 3px hue border, title (click toggle), timestamp (`when()`), summary, action_items list, type `<select>` (7 types, hue/bg), `#tags` buttons → set query, `N linked` btn, More/Less, expanded: People, raw italic, Connected-to list (via shared), Delete
  - Files: `components/NoteList.tsx`, `components/NoteInput.tsx`
  - Done when: matches `entryHTML()` in prototype
- [ ] F2.4 Filters + search (local until B4): All chip + per-type chips with counts, search input filters title/summary/tags/raw (case-insens), `renderList()` without full rerender
  - Done when: filter + query combine correctly, "Nothing matches that." empty state
- [ ] F2.5 Notices + onboarding: notice banner (amber #F6EBD2) + Dismiss, start screen (Explore sample / Start empty), empty "Nothing filed yet", Reset prototype (confirm)
  - Done when: all states reachable
- [ ] F2.6 High-end minimal polish (Tailwind only, subtle motion — recommended)
  - Direction: professional, minimal, eye-pleasing, not cluttered. Tokens in Tailwind mapped to CSS vars above; Newsreader/Inter only; generous whitespace; 1 accent per card (left hue border only); meta text muted 12px; progressive disclosure via More/Less
  - Micro-animations (CSS/Tailwind 150-250ms ease-out, subtle only): fade+slide on save, chip hover lift, btn active scale .97, skeleton shimmer on load, map node hover glow; all off under `prefers-reduced-motion`
  - No new deps (skip framer-motion — add only if map spring feels stiff)
  - Done when: stream + login feel calm, no layout shift, motion barely noticeable
- [ ] **AI review gate F2** — UI parity with prototype.html stream view + polish check

## F3 — Voice dictate (frontend, prototype parity)

- [ ] F3.1 `startVoice()`/`stopVoice()` with `SpeechRecognition || webkitSpeechRecognition`, `continuous+interim`, `lang en-IN`, append to draft base, live textarea sync, pulse anim on listening
  - Done when: Chrome dictates into draft; toggle stops
- [ ] F3.2 Fallbacks: no-SR → "no speech recognition — try Chrome, or type"; `onerror` → "Microphone stopped. Check permissions."
  - Done when: both messages show correctly
- [ ] **AI review gate F3**

## F4 — Map view (similar-category graph, frontend)

- [ ] F4.1 `buildGraph()`: nodes per note, edge iff ≥1 shared tag/person (lowercased trim), `shared[]`, `weight=shared.length`, `deg`, `r=8+min(10,deg*2)`
  - File: `components/GraphView.tsx` (port from prototype)
  - Done when: unit check on SAMPLE (9 notes → rally cluster, booth cluster, field bridge)
- [ ] F4.2 `drawMap()`: svg grid, edges + shared labels (opacity on hover), nodes (fill hue if deg>0 else bg), title labels truncated 24ch, drag, click select, hover highlight neighbourhood, bounds clamp, `pos` cache
  - Done when: visual parity with prototype map, drag/tap/hover work, touch-action none
- [ ] F4.3 Detail: `{n} of {total} connected · {links} links · drag to rearrange, tap to trace`, selected card below map
  - Done when: sel panel shows title/summary/connections
- [ ] **AI review gate F4**

## B1 — Backend skeleton + DB + auth

- [ ] B1.1 Migration `apps/api/db/migrations/001_init.sql`: `vector` + `pg_trgm` ext, `users`, `notes` (text[] tags/people/action_items + generated `search_tsv` + GIN), `note_embeddings vector(1536)` + HNSW cosine
  - Done when: runs clean on Neon (and local compose fallback)
- [ ] B1.2 `scripts/create_user.py`: `email pw` → bcrypt insert, idempotent on conflict
  - Done when: inserts 1-2 users
- [ ] B1.3 Auth: `POST /auth/login` (verify → httpOnly `session` lax), `POST /auth/logout`, `get_current_user` from JWT, all data routes 401 without cookie + scoped by `user_id`
  - Files: `routes/auth.py`, `core/auth.py`
  - Done when: login → cookie → authed fetch; unauthed 401
- [ ] **AI review gate B1**

## B2 — Notes CRUD (no AI yet)

- [ ] B2.1 `routes/notes.py`: POST (raw+source, return id), GET (user-ordered desc), PUT (raw update + updated_at), DELETE (cascade embedding)
  - Done when: curl CRUD cycle passes with cookie
- [ ] B2.2 Web swaps mock → real `api("/notes")` in F2 list/save/edit/delete/type-override (plain field update, no re-extract yet)
  - Done when: reload persists
- [ ] **AI review gate B2**

## B3 — Extraction + embeddings (backend-only, key later)

- [ ] B3.1 `POST /extract` (or inline helper `extract_note()`): prompt = prototype `EXTRACT_PROMPT` + `Existing tags: …`, model `gpt-4o-mini` or `claude-sonnet-4-6` via env, strict JSON `{title≤8w, type∈7, summary, tags[2-5] lower, people, action_items}`, invalid type → `note`; missing key → `501 not_configured` (no mock, no fallback)
  - File: `core/openai_client.py`
  - Done when: with key → structured rec; without key → 501
- [ ] B3.2 Embeddings: `embed()` via `text-embedding-3-small` → `note_embeddings(note_id, embedding, model_version)`; re-embed on edit, cascade on delete; missing key → 501
  - Done when: save writes both tables atomically
- [ ] B3.3 Wire POST/PUT `/notes`: extract + embed synchronously in transaction (200-500ms ok, no queue for v1)
  - Done when: saved note shows title/summary/tags/people immediately
- [ ] **AI review gate B3**

## B4 — Hybrid search + RAG summary

- [ ] B4.1 `GET /search?q=`: query embed + pgvector cosine top-20 (user-scoped) ∥ `tsvector` keyword, RRF merge, return `{notes, matched_ids}`
  - Done when: "apple"Company-vs-fruit test surfaces both exact + semantic
- [ ] B4.2 `summarize()`: top-N text + query → 2-3 line summary (same model family), shown above results; frontend highlights `matched_ids` in list + map
  - Done when: summary renders, highlights sync
- [ ] **AI review gate B4**

## B5 — Whisper transcribe (backend)

- [ ] B5.1 `POST /notes/transcribe`: multipart audio → Whisper → `{transcript}` (no save); missing key → 501
  - Done when: upload returns transcript
- [ ] B5.2 Web: mic capture → upload → editable transcript → confirm → `POST /notes` (complements F3 dictation)
  - Done when: record → review → save works
- [ ] **AI review gate B5**

## B6 — Map endpoint (server graph)

- [ ] B6.1 `GET /map`: server `buildGraph` from tags/people, `{nodes(id,title,type,summary,deg,r), edges(source,target,shared,weight)}`
  - Done when: matches frontend F4.1 output on same data
- [ ] B6.2 Web map prefers `/map`, falls back to local `buildGraph` offline
  - Done when: online uses server, offline still renders
- [ ] **AI review gate B6**

## P0 — Polish + E2E

- [ ] P0.1 A11y/perf/aesthetic QA: `:focus-visible` accent, `prefers-reduced-motion` disables all F2.6 motion, responsive pass, loading spinners, error toasts, spacing rhythm + contrast ≥4.5:1 body
- [ ] P0.2 Full E2E: login → typed + voice notes → extraction visible → search + summary → map click/hover → edit type → delete → counts update
- [ ] P0.3 Docs: README run steps, `development-plan.md` ↔ `todo.md` in sync
- [ ] **Final AI review gate** — all boxes `[x]`, no `501` with keys set
