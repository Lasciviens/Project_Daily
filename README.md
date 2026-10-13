# Lasci's Board

A personal dashboard for one owner, installable as a phone app (PWA). It brings
the owner's day, food, shopping, media, training, health, games and reading
into one place, with an AI assistant and an iPhone surface on top.

**Live app:** https://lasciviens.github.io/Project_Daily/#/login · **Repo:** https://github.com/Lasciviens/Project_Daily

## What is in it

| Area | In short |
|---|---|
| Home | A rule-based daily brief, now/next, today's tasks, transit, weather, currency, news and glance tiles |
| Personal (Daily) | Day / Week / Month / Tasks views, the day's schedule, a glance board; one `tasks` table for every page |
| Food | Diary and meal plan in one table, recipes, barcode and online food search, water, a nutrition coach |
| Shop | Wishlist with a price watch, a quick shopping list with grocery-chain prices, the things you own and money chains |
| Media | Movies and TV from TMDB, two-way Trakt sync, lists, a queue and stats |
| Training | Hevy workouts and routines, a progress engine per exercise, Strava, an AI coach |
| Health | Apple Health (through the Health Auto Export app), the smart scale, goal progress |
| Games | Retro library from the handheld (ES-DE), Steam, PlayStation, ScreenScraper and IGDB data |
| Books | A Kobo e-reader through a KOReader plugin: reading stats, Send to Kobo, device settings from the app |
| Wishes | Things to do and places to go, each with a reminder period that is never a deadline |
| Work · Projects | A work task board; projects with phases and items |
| AI assistant | Gemini through the `ai-proxy` edge function, with allow-listed database tools; a delete runs only after a Confirm card |
| iPhone | `phone-gateway` (12 actions), 11 generated Apple Shortcuts, Scriptable widgets and a food logger, a morning Web Push |

Also: Settings (places, appearance, connections and subscriptions, a list of
every external API), a Developer
page (activity log, errors, AI memory) and the in-app **Dev Requests** drawer,
which is the live backlog.

## Stack

React 19 · TypeScript 6 · Vite 8 · Tailwind CSS 3 · TanStack Query 5 · Zustand 5 ·
React Router 7 (HashRouter, `/#/route`) · Headless UI 2 · Recharts 3 ·
vite-plugin-pwa. Backend: Supabase (Postgres with row level security, Auth,
Deno edge functions, pg_cron). Hosting: GitHub Pages. No unit-test framework:
logic is checked by `scripts/verify-*.cjs|mjs`.

## Quick start

```bash
npm ci                            # Node 22, as in CI
npm run dev                       # http://localhost:5173/Project_Daily/
npm run build                     # type-check + production build
npm run lint
node scripts/run-all-verify.mjs   # every verify script, as the PR check runs them
```

The `verify-db-*` scripts need a throwaway Postgres in `VERIFY_DB_URL` and are
skipped without one.

Put the client variables in `.env.local` (names only here; `.env.example` is
out of date). `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required;
`VITE_TMDB_API_KEY`, `VITE_GOOGLE_CLIENT_ID`, `VITE_STRAVA_CLIENT_ID`,
`VITE_OXR_APP_ID` and `VITE_VAPID_PUBLIC_KEY` turn on their features. Every
other key lives server-side only (Supabase Edge Function secrets and Vault):
[`docs/backend/environment.md`](docs/backend/environment.md).

## How deploy works

Work happens on a branch and reaches `main` through a pull request. A merge to
`main` deploys, in order: the new database migrations (numbered above 140, each
once), every edge function, then the website. A failing step stops the run, so
nothing after it changes. Setup and recovery:
[`docs/deploy-setup.md`](docs/deploy-setup.md).

## Where to read next

| File | For |
|---|---|
| [`AGENTS.md`](AGENTS.md) | The shared rulebook for every AI working on the repo (Claude and Codex) |
| [`CLAUDE.md`](CLAUDE.md) | `@AGENTS.md` plus Claude-only notes |
| [`.claude/rules/`](.claude/rules) | Short rule files Claude Code loads by itself when matching files are touched |
| [`docs/features/`](docs/features/README.md) | One description per feature |
| [`docs/platform-shell.md`](docs/platform-shell.md) | App shell, routes, PWA updates, iOS gotchas |
| [`docs/design/THEME.md`](docs/design/THEME.md) | The UI guide: tokens, primitives, layout, popups |
| [`docs/backend/edge-functions.md`](docs/backend/edge-functions.md) · [`environment.md`](docs/backend/environment.md) | Edge functions; every variable and secret |
| [`docs/deploy-setup.md`](docs/deploy-setup.md) · [`deploy-checklist.md`](docs/deploy-checklist.md) | The automatic deploy; manual steps still open |
| [`docs/decisions.md`](docs/decisions.md) | Decisions not to revisit |
| [`docs/integrations/`](docs/integrations) | One file per newly added external API |
| [`docs/README.md`](docs/README.md) | Index of every other doc: runbooks, coordination, references |
| [`supabase/migrations/`](supabase/migrations) | The schema itself |
