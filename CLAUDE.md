# Lasci's Board — Master Project Guide

> Read this before touching any code. Single source of truth for product/feature state and coding rules.
> Keep this file lean — no clutter, no outdated info, no verbose explanations. Every line must earn its place.

**Doc map** — read in this order depending on what you're doing:
- `README.md` (repo root) — human/AI-agnostic orientation: what this app is, tech overview, quick start. Start here if you've never seen this repo.
- **`CLAUDE.md` (this file)** — the definitive guide for any coding agent (Claude or otherwise) before making a change: routes, features, coding rules, edge functions, key patterns.
- `AGENTS.md` (repo root) — supplementary rules specific to database/schema/Supabase work (migrations, RLS, edge function conventions).
- `docs/` — deep-dive reference docs (data model, architecture notes) linked from `docs/README.md`. Treat anything there as secondary to this file if the two ever disagree — this file is updated every session, `docs/` is not.

---

## Session Workflow

Runs on **Claude Code on the web** (claude.ai/code). Container clones repo fresh each session — git is the only memory.

```
1. User describes task
2. Claude branches: claude/<descriptive-name>
3. Code → npm run build → commit → push → draft PR
4. User marks ready → merges → GitHub Actions auto-deploys (~1 min)
```

- Never push directly to `main`
- Update this file when features complete or architecture changes
- **Small data migrations/inputs**: the in-app AI (Ask AI panel) now has a generic DB layer (`db_query/insert/update/delete`, see AI section). For small one-off data loads (seed rows, backlog items, bulk inserts) just hand it a JSON or SQL-ish spec in chat — it inserts the rows — instead of writing a migration. Reserve SQL migrations for schema changes.
- **Direct Supabase data access (curl/REST with the user's own credentials) is opt-in per request** — only query/inspect live production data when the user explicitly asks for it in that turn (e.g. "check the DB", "look at my data"). Never do this proactively/unprompted, even mid-investigation of a bug — it's the user's personal data.

**Live URLs:** App: `https://lasciviens.github.io/Project_Daily/#/login` · Repo: `https://github.com/Lasciviens/Project_Daily`

---

## Communication Style (per user request)

The user is learning software engineering terminology as we go (comes from a SAP/ABAP background). When describing what was done, **use the correct technical term and add a short parenthetical explaining what it means** — e.g. "yeni bir **hook** yazdım (component'ler arası paylaşılan, tekrar kullanılabilir mantık — SAP'deki bir class method'una en yakın karşılık)" instead of just describing it in plain words with no term attached. Do this consistently, not just when explicitly asked — it's meant to build vocabulary over many sessions. Don't overdo it into a glossary dump; one clear parenthetical per term, only for terms actually used that turn.

Also: don't narrate routine PR housekeeping (subscribing to PR activity, "checking CI status", "no comments yet") — the user checks PRs themselves and considers this noise. Only speak up about a PR when there's something requiring their input or a genuinely notable outcome (merged, a real CI failure, a review comment needing a decision).

---

## Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript + Vite |
| Routing | HashRouter (`/#/route`) — GitHub Pages has no server rewrite |
| Styling | Tailwind CSS v3, design tokens via CSS custom properties (`--accent-*`) |
| State (UI) | Zustand (`src/app/store.ts`) |
| State (server) | TanStack Query v5 |
| DB | Supabase (Postgres + Auth + RLS + Edge Functions) |
| Hosting | GitHub Pages via GitHub Actions |

UI primitives: `@headlessui/react` v2 (Dialog, Combobox, Popover, Menu). No animation library, no shadcn/ui, no SSR, no AI keys in client code.

**PWA / service worker (real bug, fixed):** `vite-plugin-pwa`'s `registerType: 'autoUpdate'`
does NOT auto-update by default the way the name implies — the auto-injected `registerSW.js`
is a bare `navigator.serviceWorker.register(...)` call with no update-detection logic. A new
service worker installs but sits **waiting** until every open tab of the app is fully closed;
a hard refresh does NOT activate it, because a hard refresh bypasses the HTTP cache, not an
already-controlling service worker. This caused a shipped fix to be invisible to the user even
after a successful deploy + hard refresh. Fixed: `vite.config.ts` sets `injectRegister: false`
+ `workbox: { skipWaiting: true, clientsClaim: true }`, and `src/main.tsx` calls
`registerSW({ immediate: true })` from `virtual:pwa-register` (types via `src/vite-env.d.ts`) —
this checks for updates immediately (and periodically after) and reloads automatically when
one is found, so deploys now actually reach the browser without the user manually clearing
site data or reinstalling the PWA.

---

## Routes

```
/#/login          → LoginPage (public)
/#/reset-password → ResetPasswordPage (public — only reachable via Supabase's password-recovery email link, or the "Forgot password?" link on LoginPage)
/#/home       → HomePage
/#/daily      → DailyPage   (nav: "Personal" — Work-style tab bar via PersonalLayout, default tab)
/#/shop       → ShopPage    (nav: "Personal" tab bar, same routes as before)
/#/recipes    → RecipesPage (nav: "Personal" tab bar, same routes as before)
/#/media      → MediaPage
/#/work       → WorkPage
/#/projects   → ProjectsPage
/#/training   → TrainingPage
/#/games      → GamesPage
/#/developer  → DeveloperPage
```

(No `/football` route — Football is deferred; see Features.)

Everything except `/login` and `/reset-password` is protected by `SessionGuard` in `src/app/router.tsx`.

**Password reset (real bug, fixed):** the app had no recovery flow at all — Supabase's reset email
redirected back to the app with a recovery token, but nothing read it or showed an "set new
password" form, so the link silently did nothing (a very common gap — see the GitHub issues on
`gotrue-js`/`auth-js` about apps not handling the `PASSWORD_RECOVERY` event). Fixed: `LoginPage`
has a "Forgot password?" link → `requestPasswordReset()` (`security/supabaseClient.ts`) calls
`supabase.auth.resetPasswordForEmail(email, { redirectTo })` with `redirectTo` pointing at
`#/reset-password`; `ResetPasswordPage` listens for the `PASSWORD_RECOVERY` auth event (plus a
session-check fallback in case the event fires before the listener attaches) and shows a new-password
form on success. **Requires a one-time manual step**: the redirect URL (both the GitHub Pages URL and
`http://localhost:5173/#/reset-password` for local dev) must be added to Supabase Dashboard →
Authentication → URL Configuration → Redirect URLs, or Supabase silently refuses to send the token.

---

## Features

| Feature | Status | Notes |
|---|---|---|
| Auth | ✅ | LoginPage |
| Daily + To-Do | ✅ | DayView, DayTimeline, WeekWidget, MonthWidget, AddTimeBlockModal. **"Today at a glance" dashboard** (`TodaySummary.tsx`, top of the Today tab, above the Day/Timeline/widgets grid): 3 summary cards — **🍽️ Nutrition** (calorie ring consumed-vs-goal + protein progress bar + macro split bar + today's planned meals by slot; goals editable inline via `useDayTargets` localStorage, single-user; macros summed by `dayNutritionApi.fetchDayNutrition`/`useDayNutrition` from `recipe_meal_plans` — recipe per-serving × servings, library ingredient per-100g × qty for g/ml, shares the `['meal-plan']` query namespace so planner edits refresh it), **💪 Training** (today's planned training blocks / a logged Hevy workout marked Done ✓ / rest-day prompt), **🎬 Watch next** (continue an in-progress series/movie else a wishlist pick, with poster). Read-only overview — deep edits stay on each feature's own page. Quick task entry is now via the Daily/Work pages themselves — the old global To-Do drawer was replaced by **Dev Requests** (see below). **Cancel** (⊘, `ToDoItem`/`WorkTaskCard`) sets `status='cancelled'` — `TaskStatus` always had this value but no UI ever set it before; distinct from Delete (keeps a record instead of destroying the row). `DayView` shows a "Cancelled" section (same 24h window as "Done") so a cancelled task stays visible instead of just vanishing; Work board has no cancelled column, so there a cancelled task simply drops off the board (matches the existing "cancelled excluded from active counts" convention used everywhere else — WeekWidget/MonthWidget/HomePage/etc). |
| Shop | ✅ | See Shop section below. Nav: "Personal" group (Daily, Shop, Recipes) — single nav link to `/daily`, in-page tab bar via `PersonalLayout` (`src/features/personal/components/PersonalLayout.tsx`), Work-style segmented control. Routes unchanged (`/daily`/`/shop`/`/recipes`), so deep links keep working. |
| Recipes | ✅ | Phase 1+2+3+4 done (CRUD + serving scaling + macros + weekly meal plan + pantry checkbox → Shop + AI paste-parse/macro-estimate). See Recipes section. UX: cover-image backdrop/cards, MacroBar, Cook Mode, search, seeded Turkish classics |
| Media | ✅ | See Media section below |
| Work | ✅ | **Command-center layout** (renovated): sticky command bar (live HH:MM:SS clock, day stat chips ✓/⚡/⚠, New task, rail toggle) → `WorkDayTimeline` (now with a Now/Next line) → `FocusStrip` (focused tasks, horizontal snap-scroll) → collapsible red **Overdue alert strip** (overdue is a property, not a column — except in_progress tasks stay on the board) → **Board/List view toggle** (persisted) + quick-add input + search + priority filter → `WorkBoard` (true horizontal 4-col kanban on desktop w/ per-column scroll + DnD; stacked collapsible on mobile) or `WorkListView` (dense triage rows, status-cycle dot, overdue-first sort). Right rail (`WorkSidebar`, collapsible+persisted): Summary/Notes/Goals/Links all visible as stacked collapsible cards (was tabs). Shared status/priority/due helpers in `components/workMeta.ts`. Developer moved out (unrelated to Work) — reach it via the Settings (⚙) menu → `/developer`. |
| AI | ✅ | Gemini 3.5 Flash via Edge Function. Generic DB tool layer (describe_database + db_query/insert/update/delete) — reads/writes any allow-listed user table; + special-purpose tools (calendar/transit/media/shop). See AI section below. |
| Calendar | ✅ | Google OAuth, read + write events, sync/refresh button in DayTimeline header |
| Games | ✅ | RP5 library proxy, 6 view modes, TierEditor, PlayQueue drag-and-drop |
| Training | ✅ | See Training section below. Hevy (workouts, PRs, routines, body) + Strava OAuth. Page-level calendar pinned right. |
| Projects | ✅ | Phases, items, status tracking. Add/edit item share one modal (`ProjectItemModal`) — title/notes/phase/type/status/priority. Phases view is a matrix (`grid grid-cols-1 md:grid-cols-2`, each card sized/collapsed independently) rather than one full-width stacked column. |
| Dev Requests | ✅ | Replaces the old global To-Do drawer (right-edge trigger in `Nav`) — a place to jot bugs/features/improvements/integration ideas/long-term wishes about the app itself, from wherever you notice them, so a future coding session can read a structured backlog instead of a chat scrollback. `dev_requests` table (migration `042`, owner-only RLS, `user_id DEFAULT auth.uid()`) — title, description, `page` (auto-captured current route, editable), `category` (bug/feature/improvement/integration/longterm/question/other), `priority` (low/medium/high/urgent), `status` (open/in_progress/done/dismissed), `effort` (small/medium/large, optional), `sort_order`. `DevRequestsDrawer.tsx` (`src/features/devRequests/`): quick-add form pre-filled with the current page, category pills + manual/priority sort toggle, native HTML5 drag-and-drop reorder (persists via `useReorderDevRequests`'s optimistic `onMutate`), inline edit-in-place (no separate modal), status cycles open→in_progress→done on click, delete for done/dismissed cleanup. The old `ToDoDrawer.tsx`/`ToDoSection.tsx` were deleted as dead code once nothing referenced them; `ToDoItem.tsx` and the task hooks/API are untouched (still used by DayView/WorkPage/CommandBar). **Known side effect:** `useSyncFromGoogleTasks`/`usePushToGoogleTasks` (bulk Google Tasks import/push) lost their only UI trigger when the drawer was removed — left defined (harmless) in case a new trigger is added elsewhere later, but currently unreachable from any page. |
| Developer | ✅ | Standalone `/developer` page, reached from the Settings (⚙) menu (`SettingsMenu.tsx`). Two tabs: **Activity** (CRUD audit trail — `audit_logs` table written by DB triggers, migration `037`; filters by table/op/actor/days, 30-day retention swept probabilistically in the trigger) and **Errors** (`app_error_logs`). Audit triggers cover user-authored tables only — bulk-synced tables (hevy_*/health_*/strava) deliberately excluded to avoid sync-spam; `actor` distinguishes 'web' (browser session) from 'service' (AI/webhooks, service-role writes). **Activity tab layout (migration 043 follow-up)**: a 4-column matrix (`grid-cols-4` on wide screens) instead of one long vertical list — a same-transaction cascade (e.g. a `time_blocks` delete that migration 043's trigger also cascades into a `tasks` delete) spans multiple grid columns as one connected chain with a directional "→" arrow between each step, so "this caused that" reads visually instead of needing to mentally correlate timestamps across separate rows. |
| Home | ✅ | WidgetShell, Weather, Ruter transit, Currency, News, Recent Media, Games, Training. **DailyBriefing** — AI morning digest at the top, auto-generated once/day (see below). |
| Command Bar | ✅ | `CommandBar` (⌘K) via `useUIStore.openCommandBar` |
| Dark Mode | ✅ | Light/Dark/System toggle in `SettingsMenu.tsx` → `useThemeStore` (`src/app/store.ts`, Zustand + persist, localStorage key `theme-preference`). `tailwind.config.js` (`darkMode: 'selector'`) resolves `canvas`/`cream`/`ink` (not `accent`, already CSS-var-backed since day one) through `rgb(var(--x) / <alpha-value>)`, mirroring the existing accent-color pattern — `index.css` defines the light values (`:root`, unchanged from the original hex) and dark overrides (`:root.dark`) once, so ~120 existing component files that already use these token classes became theme-aware with **zero per-file changes**. An inline script in `index.html` (before the module script) stamps `.dark` on `<html>` synchronously from the persisted value, avoiding a flash-of-wrong-theme on load; a `matchMedia` listener keeps `'system'` mode live if the OS preference changes mid-session. `bg-white` (used as an opaque card/surface color in ~120 files) was mechanically renamed to `bg-cream-50` (visually identical in light mode) — literal `text-white`/`bg-white/NN`-with-opacity/`bg-black` were deliberately left alone (foreground-on-accent-button and photo-backdrop-overlay roles that should stay white/black regardless of theme, not surface color). A handful of inline-SVG/Recharts chart files had hardcoded hex for grid lines/axis labels (`stroke`/`fill`) converted to `rgb(var(--ink-XXX))` the same way `BodyMeasurementsTab.tsx`'s weight-line already did for `--accent-500`; distinct **data-series** colors (sleep stages, Strava orange, task color tags, Activity Rings) were deliberately left as fixed literals — they're identity/brand colors, not UI chrome, and shouldn't repaint with the theme. |
| Football | ⛔ | Deferred — no route wired. API-Football free tier stops at 2024. Future: fixtures from Google Calendar. |

### Media Feature Detail
Full-width layout (no max-width constraint). Key components:
- `MediaSearch` — movie/TV radio toggle, genre/year/rating filters, TMDB `/discover` or `/search`
- `CompactLibraryStrip` — 2-column status-group layout above Discovery (each column a flex-wrap poster strip, single column below `sm:`); groups: Upcoming/Wishlist/Watching/Paused/Completed; collapse toggle
- `DiscoveryTabs` — Today/This Week/Popular/Upcoming/Norway tabs; manual sync only (24h stale)
- `EpisodesPanel` — season selector, per-episode watched checkbox (saves `watched_on` date), plan checkbox for adding to today's schedule as time blocks, Select All season. Planning a **single** episode stamps `season_number`/`episode_number` on the created `time_blocks` row (migration `043`) — `source_id` alone only identifies the show, not which episode, so this is what lets a DB trigger match "this episode got marked watched" back to exactly the one planned block for it and delete it. A multi-episode batch plan ("watch 3 episodes") is intentionally NOT stamped and NOT auto-cleaned — deleting a 3-episode reminder because one of the three was watched would be wrong; see AGENTS.md's "Linked-entity sync" section.
- `MediaDetailBody` — personal 1-10 rating, status buttons (save on click), upcoming auto-suggest for future releases
- `TonightPicker` — random movie/series from My List / Trending / Popular
- `ReleaseCalendar` — upcoming releases from wishlist
- `MediaStats` — library stats
- `MediaBackdrop` — rotating backdrop images (fixed, low opacity crossfade)

DB tables: `movies`, `user_movie_entries` (statuses: watching/wishlist/completed/dropped/upcoming), `tv_series`, `user_tv_entries` (statuses: watching/wishlist/completed/dropped/paused), `watched_episodes` (season, episode, watched_on date)
Both movie and TV entries have: `rating int (1-10)`, `genres jsonb`, `personal_note`, `priority`
TMDB images: `posterUrl(path, size)` from `src/integrations/tmdb/client.ts`

### Shop Feature Detail
Wishlist/shopping-planner under `src/features/shop/`. Strict **2-level** category tree — `shop_categories.parent_id` null = top category, set = subcategory; items always attach to a subcategory (`shop_items.category_id`), never to a top category. Page is a fixed two-pane layout (`ShopPage`, `h-full` — sized by `PersonalLayout`'s flex-1 Outlet slot, not a viewport calc): left = `ShopAIBox` chat panel (fixed width on desktop, fixed height on mobile, internal scroll + pinned input — never grows the page), right = category pills + wishlist grid (its own scroll).
- `ShopAIBox` — chat panel (separate from the app-wide ✦ Ask AI panel) using `sendShopMessage` (aiApi.ts) with a shopping-companion system prompt: converses naturally about plans (not just add-item commands), handles a pasted multi-item basket, and never guesses a new category silently.
- Clarifying questions use a real Gemini function call — `ask_clarifying_question(question, options[])` — not text-parsed conventions. `ai-proxy`'s loop short-circuits on this call (the "answer" must come from the human as a real next turn, not a synthesized tool response) and returns `{ text, quickReplies }`; `ShopAIBox` renders `quickReplies` as tappable buttons.
- `AddShopItemModal` — manual add: top category / subcategory cascading selects, each with "+ New…" to create on the fly.
- `ShopItemCard` — title, notes, price (+ `price_source`: `manual` or `ai_estimate`), platform, link, priority dot, region flag (🇹🇷/🇳🇴), planned date, mark bought/delete.
- No live price-lookup API (Prisjakt/Akakçe have no public free API) — price is manual entry; AI can only give a rough text estimate on request via the chat panel, never auto-writes a price.
- DB: `shop_categories` (id, user_id, name, parent_id), `shop_items` (category_id, title, notes, price, price_source, platform, url, priority, region `TR`/`NO`, planned_date, status `wishlist`/`bought`/`dropped`, source_type `manual`/`ai`). Migrations `029_shop.sql` (schema) + `030_shop_seed_categories.sql` (partial-unique indexes + a starter taxonomy — Electronics/Clothing/Home & Living/Personal Care & Health/Hobby & Games/Sports & Outdoor/Groceries/Books & Stationery — seeded idempotently for every existing user).
- AI tools (ai-proxy, shared with the main Ask AI panel too): `get_shop_categories`, `create_shop_category`, `create_shop_item`, `ask_clarifying_question` — same Gemini function-calling pattern as `create_task`.

### Recipes Feature Detail
Personal recipe collection under `src/features/recipes/` (nav: Personal → Recipes). **Phase 1+2+3+4 shipped** = CRUD + serving scaling + macros + weekly meal plan + pantry checkbox → Shop + AI paste-parse/macro-estimate. Built fresh in Supabase (RecipeSage was evaluated as an integration/self-host target but rejected — AGPL + separate tRPC service + needs its own server; no consumer recipe app has a usable public API).
**Table naming standard**: every table for this feature is `recipe_*` (matches `shop_*`/`hevy_*` elsewhere) — the one exception is `recipes` itself, which is the feature's root entity (like `tasks`/`movies`/`projects`), not a satellite table.
- DB (migration `031_recipes.sql` + `033_recipe_ingredient_library.sql`): `recipes` (title, description, `servings` base count, instructions, `macro_mode` `manual`/`from_ingredients`, per-serving `calories`/`protein_g`/`carbs_g`/`fat_g`/`sugar_g`, image_url, source_url) + `recipe_ingredients` (name, `quantity` nullable=to-taste, unit, note, sort_order, `library_ingredient_id` nullable FK) + `recipe_ingredient_library` (reusable ingredient catalog — name, unit, macros **always per 100g**, unique per `(user_id, name)`). Ingredient quantities are stored for the base `servings`; macros are stored **per serving**.
- Macro modes: `manual` = typed in directly. `from_ingredients` = computed server-side on save (`computeMacrosFromIngredients` in `recipesApi.ts`) by summing each linked library ingredient's per-100g macros × `quantity/100`, ÷ servings — only ingredients with a `library_ingredient_id` AND a weight/volume unit (g/ml) contribute; others are skipped (surfaced in the UI). `RecipeModal` shows a live client-side preview (`previewMacros`) using the same math against the already-loaded library.
- `RecipeModal` — create/edit: title, base servings, dynamic ingredient rows (qty/unit/name/remove); in `from_ingredients` mode each row can link to a library ingredient or create one inline (`NewIngredientInline`). Macro fields use full labels (Calories/Protein/Carbs/Fat/Sugar), never P/C/F abbreviations. Save replaces all ingredient rows.
- `RecipeDetail` — view + serving stepper: changing servings rescales ingredient quantities (× target/base) and totals macros (per-serving × target, now including Sugar). Edit/delete.
- `RecipeCard` / `RecipesPage` — card grid landing, with a **Library / Meal Plan** tab toggle.
- **Phase 2 — meal plan** (migration `033_recipe_ingredient_library.sql` renamed the table): `recipe_meal_plans` (date, `meal_slot` breakfast/lunch/dinner/snack, plus exactly one of: `recipe_id`, `custom_title`, or `library_ingredient_id`+`ingredient_quantity`+`ingredient_unit` — a raw ingredient logged straight to a day without a recipe wrapper, servings, notes). One entry per `(user_id, date, meal_slot)` — unique index, upserted. `MealPlanWeek` — 7-day × 4-slot grid, week nav, click a cell → `AssignMealModal` (Recipe / Ingredient / Custom mode toggle). Independent of the Daily schedule (its own calendar, by design).
- **Phase 3 — pantry → Shop** (`recipes/api/shopIntegration.ts`, crosses into `shop/api/shopApi.ts` deliberately): `RecipeDetail` shows a checkbox per ingredient ("I already have this" — session state, not persisted). "Add missing to Shop" pushes every unchecked ingredient into a `Groceries → Recipe Ingredients` Shop category (creating it if it doesn't exist yet), with quantity + the recipe title in the item's notes.
- **Visual/UX pass**: `RecipeBackdrop` — rotating header photo built from the user's own recipe `image_url`s (Media-style), gradient+emoji fallback when none exist yet (no hotlinked stock photo — verify-ability > convenience). `RecipeCard`/`RecipeDetail` now render `image_url` (was captured but never displayed). `MacroBar` — proportional protein/carbs/fat stacked bar (4/4/9 kcal-per-gram) below the macro numbers. `CookMode` — full-screen step-by-step guided view (large text, progress dots, persistent ingredient checklist, prev/next). `times_cooked` counter (migration `034`) + a 🔥 "I made this" button — organic favorites signal without a separate table. Library tab has a client-side search box (title/description/ingredient name).
- **Starter data** (migration `035_recipe_seed_turkish_classics.sql`): no Turkish recipe site has a public API and neither Spoonacular nor Edamam tag "Turkish" as a cuisine (checked) — seeded 10 classic/popular Turkish dishes (Mercimek Çorbası, Karnıyarık, Mantı, Menemen, İskender, Kuru Fasulye, Lahmacun, Ezogelin Çorbası, Türk Kahvaltısı, Baklava) with ingredients + editorial per-serving macro estimates (`macro_mode='manual'`) for every existing user, idempotent on re-run.
- **Phase 4 — AI paste-parse / URL-import / macro-estimate**: `ai-proxy` gained a second call mode alongside the existing conversational tool-calling loop — passing `responseSchema` in the request body routes into `callGeminiStructured`, a single-shot Gemini call with `responseMimeType: 'application/json'` + a Gemini-format JSON schema, returning `{ data }` instead of `{ text }` (no tools, no multi-turn loop; used for structured extraction, not chat). A third mode, `{ fetchUrl }`, fetches a page server-side (browser can't hit arbitrary third-party origins due to CORS) and returns its stripped-down readable text as `{ text }` — has an SSRF guard (blocks localhost/private IP ranges) and an 8s timeout. `src/features/ai/api/aiApi.ts` exposes `parseRecipeText(text)`, `parseRecipeFromUrl(url)` (fetchUrl → parseRecipeText), and `estimateRecipeMacros(ingredients, servings)` on top of this. The recipe-parse prompt always forces Turkish output — title/ingredients/instructions are translated regardless of source language. In `RecipeModal`: "✨ Paste recipe" reveals a Paste text / From URL toggle — either fills title/servings/instructions/ingredients + a macro estimate (mode forced to `manual`, still fully editable, nothing auto-saved); the URL mode also sets `source_url`. "✨ Estimate with AI" (manual macro mode only) fills the five macro fields from the current ingredient rows. All are one-shot fills the user reviews before saving — never call these tools from the general Ask AI chat panel, they're editor-only actions.
- **General Ask AI recipe tools**: separately, the main Ask AI chat panel (`aiApi.ts`'s `SYSTEM_PROMPT`, not the Recipes-editor structured-extraction path above) has its own conversational `get_recipes`/`create_recipe` tools in `ai-proxy`, for when the user just pastes/describes a recipe in normal chat rather than opening the Recipes editor — writes directly into `recipes`/`recipe_ingredients` (`macro_mode='manual'`). The system prompt has an explicit guardrail: a shared recipe is never `create_shop_item`/`create_shop_category`, even though it involves food/ingredients — this was a real bug (a pasted recipe got mis-filed as a Shop wishlist item under an AI-invented "Home & Living > Recipes" category, since no recipe tool existed yet for that chat panel).

### Training Feature Detail
Page layout (`TrainingPage`): faint training-photo header banner; **Hevy / Strava / Health** pill tabs + Sync/Settings on the **left**; content column (`max-w-4xl`, left-aligned) with `TrainingCalendar` **pinned to the right edge (440px)**, independent of the active tab.
- `HevyTab` sub-tabs: Workouts, Routines, Personal Records, **Muscles**, Body, Exercises.
- **Muscles sub-tab** (`WorkedMuscles.tsx`): a front/back body heatmap (`react-body-highlighter`, MIT/0-deps SVG) of which muscle groups this week's logged workouts hit. `hevyApi.fetchWorkoutExerciseTemplateIds(from,to)` flattens the week's `hevy_workout_exercises.exercise_template_id`s; each id → `primary_muscle_group` (via `useHevyExerciseTemplates`) → a body-muscle key through `HEVY_TO_BODY`, counted and banded into a 5-step amber intensity ramp. Front/Back toggle; **tap a muscle → detail card listing the distinct exercises that hit it this week + how many times each**. Test-grade: react-body-highlighter is click-only (no hover) — a durable version would hand-roll the SVG for hover tooltips.
- **Exercise demo GIFs** (`exerciseMedia.tsx`, wired into `ExerciseTemplatesTab`'s `TemplateCard` via `ExerciseThumb`): Hevy's API returns no exercise media, so animated GIFs come from **JahelCuadrado/ExerciseGymGifsDB** (1323 exercises, jsDelivr CDN, CORS-open, free — no key/proxy) — `useExerciseImageDb` loads the `api/en/exercises.json` manifest once, `matchExercise` fuzzy-matches Hevy titles by normalized name tokens + equipment bonus (threshold 0.5), graceful no-match fallback. Each card shows a small looping thumbnail; **tapping it opens a modal with the larger GIF + step-by-step instructions**. Every GIF URL is anchored to the `GIF_SOURCE` constant — self-host later = mirror the repo's gifs into Supabase Storage and swap that one constant, no UI/matching changes. (Replaced the earlier free-exercise-db static-photo test.)
- `TrainingCalendar` — week/month; shows Hevy workouts + Strava activities + **planned training sessions** (`time_blocks` where `category='training'`) as time-coloured dots (upcoming=blue, today=green, past=red). Click a workout → `HevyWorkoutDetail` modal.
- `RoutineModals` — create/edit routines. **Payload must match the Hevy OpenAPI schema exactly** (no extra keys → 400): set fields = `type, weight_kg, reps, rep_range:{start,end}, distance_meters, duration_seconds, custom_metric` (NO `rpe`/`index`); exercise = `exercise_template_id, superset_id, rest_seconds, notes, sets` (NO `index`/`title`). Set inputs render per exercise `type` via `setFieldsForType`.
- Hevy exercise `type` is the `CustomExerciseType` enum (`weight_reps`, `reps_only`, `bodyweight_reps`, `bodyweight_weighted`, `bodyweight_assisted`, `duration`, `weight_duration`, `distance_duration`, `short_distance_weight`, `floors_duration`, `steps_duration`) — typed as `string`, humanised labels in `ExerciseTemplatesTab`.
- Edge functions normalise Hevy responses (`unwrapEntity`) — Hevy may return an entity directly, wrapped, or array-wrapped. Incremental sync reads `event.workout` (updates) / `event.id` (deletes).
- **Routine payloads**: Hevy is strict about the PUT (update) body. (1) `rep_range: null` → 400 "must be of type object"; send `rep_range: {start,end}` only when a range is entered, otherwise OMIT the key and send fixed `reps`. (2) `folder_id` is **not allowed on PUT** (400 "not allowed") — it's only valid on create (POST); omit it on update. `RoutineModals.formToPayload` builds payloads this way (folder_id only when creating); `hevy-api` also defensively strips null `rep_range` and drops `folder_id` from update bodies.
- **Sync scope**: workouts use the events-delta feed (`/v1/workouts/events`). Routines, routine folders and body measurements have NO event feed, so `hevy-incremental-sync` also re-fetches those three collections in full and upserts them on every Sync — a routine created in the Hevy app now appears on Sync (no longer requires "Import all"). Exercise templates still only come via full re-import.
- **Planned session ↔ task auto-link**: `RoutinesTab`'s "Plan routine" creates a task with `source_type='training_session'`, `source_id=routine.id` (migration `039` — `tasks.source_type` check constraint). When the matching Hevy workout is later logged from that routine, `_shared/hevySync.ts`'s upsert path deletes the task (+ its linked `time_blocks` row) automatically — see the `_shared/hevySync.ts` entry in Edge Functions below. Freeform workouts (no `routine_id`, or a routine mismatch) can't be auto-matched — `HevyTab`'s Workouts sub-tab shows a manual "Kapat" fallback button when an open training-session task falls on the same calendar day as the workout. **Separately** (migration `043`, see AGENTS.md's "Linked-entity sync" section for the full design): deleting the plan's `time_blocks` row directly (not via a logged workout) also cascade-deletes its auto-created task, and editing the plan's date/time keeps the task's `due_date`/`due_time` in sync in both directions — this is a DB-trigger-level guarantee, not app code, so it holds regardless of which door the delete/edit came through.

DB (Hevy): `hevy_workouts`/`_exercises`/`hevy_sets`, `hevy_routines`/`_exercises`/`hevy_routine_sets` (routine sets also have `rep_range_start/end`), `hevy_exercise_templates`(+`_muscles`), `hevy_routine_folders`, `hevy_body_measurements`, `hevy_workout_events_cursor`.

**Health Auto Export (v2, migration `036` + `041_health_metrics_point_grain.sql`)**: Huawei's own Health Kit API is closed to individual developers (requires AppGallery-published app), so instead: Huawei Health on iOS already syncs into Apple HealthKit; the **Health Auto Export** app (App Store) reads HealthKit and POSTs to `health-export-webhook` on a schedule. `health_workouts` (comparable shape to `hevy_workouts`) and `health_metrics` are separate from Hevy's tables (shared `HEVY_USER_ID`, different source).

- **Point-in-time grain, not daily** (migration 041): `health_metrics` was originally one row per `(metric, day, source)` — a real bug, confirmed against production exports: Health Auto Export sends per-second/per-hour samples regardless of its own "Summarize"/"Time Grouping" settings, and every new point for the same day silently overwrote the previous one, so only the LAST point of the day ever survived (e.g. `active_energy` for a full day showing as 0.05 kcal instead of ~230 kcal). Fixed by storing every incoming point as its own row, keyed by `(user_id, metric_name, recorded_at, source)` — `recorded_at` is the point's exact timestamp; `date` stays a plain column (computed from the export's own local-time string at ingest, not derived from the UTC `recorded_at`, to avoid a midnight timezone-shift bug). No aggregation happens at ingest anymore — `health-export-webhook` just upserts every point.
- **Aggregation happens at query time**, per metric, via `src/features/training/healthMetrics.ts`'s `METRIC_AGGREGATION` classification (`sum` for cumulative quantities like steps/energy/distance/durations, `average` for rate/level metrics like speeds/dB/physical effort/respiratory rate/HRV, `minmaxavg` for `heart_rate`'s Min/Avg/Max-shaped points, `latest` for point-in-time measurements like weight/body fat/BMI/resting HR, `sleep` for `sleep_analysis`'s own stage-duration merge — unrecognized metrics default to `latest`, the safest fallback). The pure functions live in `healthAggregate.ts` (`computeDailySeries`/`computeHourlyBuckets`/`computeHeartRateDailySeries`/`computeSleepSummary`) and deliberately ignore `source` when merging (a day can have differing source strings, e.g. `"Furkan's Apple Watch"` at midnight vs `"Furkan's Apple Watch|Lasci"` once a second device joins later — the UI shows one number; raw rows stay source-separated in the DB for later filtering).
- **1000-row server cap silently truncated Week/Month views (real bug, fixed):** `fetchHealthMetricSeries` (`api/healthApi.ts`) had no pagination — PostgREST caps every response at 1000 rows server-side regardless of an explicit `.limit()`/`Range` header (confirmed by testing). High-frequency metrics like `active_energy`/`heart_rate` arrive roughly once a minute from Apple Watch, so a 7-day range alone can be 3000+ rows. With ascending order + the silent cap, the response was truncated to the OLDEST rows in range — the most recent days (today, yesterday) fell off the end entirely. Symptom: Day view (well under the cap) looked fine, Week/Month view was missing the last few days. Fixed by paginating in a loop (`.range(offset, offset+999)`, repeat until a page comes back short) until every row in the requested date range is actually fetched.
- **`HealthTab.tsx` UI** (Apple Health-inspired, own palette — not a copy): a pill-navigated set of sections — **Overview** (hand-rolled SVG `ActivityRings` for Move/Exercise/Stand + a collapsed-by-default workouts list), **Steps** (hourly count + distance/pace), **Energy** (active+basal stacked bars, always normalized to kcal), **Heart** (daily avg trend, canonical `BarLineChart` style, no range band), **Sleep** (last-night stage breakdown + trend, gaps for nights with no data), **Body** (weight/body-fat/BMI). No generic catch-all table anymore — see Mini-metric grid below; there was briefly an "All Data" tab but every known metric ended up with a home in a section or its mini-grid, so it always rendered empty and was removed. Steps/Energy/Heart share a `PeriodToggle` (Day/Week/Month, default Week); Sleep has its own Week/Month toggle. Charts use `recharts`; rings are custom SVG.
  - **Date navigation** (`DateNav.tsx` + `dateNav.ts`): every Day/Week/Month view shows the exact date/range at the top (e.g. "1–7 Jul (this week)") with prev/next arrows and a native date-picker to jump to any date — `rangeForAnchor`/`stepAnchor`/`labelForAnchor` compute the visible window from an `anchor` date (defaults to today, resets to today when the period toggle changes, never steps past today). **Stale-anchor bug (real, fixed):** `anchor` was plain `useState(todayStr())` — if the tab stayed open across midnight (or the PWA didn't reload) without an explicit period-toggle click, "today" moved on but the anchor never did, so a section silently froze on whatever day it was first opened. Since each section (Steps/Energy/Heart/Sleep) has its own independent anchor, two sections could show two different stale "last date"s depending on when each was last viewed — confirmed against live data (DB had fresh same-day rows while the UI was stuck days behind). Fixed with `useAnchorDate()` (`health/useAnchorDate.ts`): re-checks on focus/visibility/a 60s interval and advances the anchor to the new day **only if** it still equals the previously-known "today" — an intentional look-back (user manually navigated to a past date) is left untouched.
  - **Click-to-drill-down**: clicking a bar in a Week/Month chart (Steps/Energy/Heart) jumps that section straight to its Day view anchored on the clicked date (`BarLineChart`'s optional `onPointClick` prop; Steps/Energy wire the same behavior directly on their own `Bar`). Sleep has no Day view, so its trend chart doesn't drill down.
  - **Chart click "frame" (real bug, fixed twice)**: clicking/hovering a bar showed a visible rectangle behind it. First attempt suppressed the browser's a11y focus outline (`.recharts-wrapper *:focus { outline: none }` in `index.css`) — harmless to keep, but NOT the actual cause. The real cause is recharts' own `Tooltip` "cursor" highlight (a semi-transparent rect it draws behind the hovered/clicked category by default) — fixed by passing `cursor={false}` to every `<Tooltip>` in the Health charts (`BarLineChart.tsx`, `StepsSection.tsx`, `EnergySection.tsx`, `SleepSection.tsx`).
  - **Canonical chart style** (user-preferred, established with Body, reused for Heart — default for any future Health chart): a translucent `Bar` + a `Line` with dots on top, same color, via the shared `BarLineChart.tsx` component. `rangeKey` (optional min–max band) still exists on the component but nothing currently uses it — Heart was changed to match Body's plain look exactly, per explicit request.
  - **Mini-metric grid** (`MetricMiniCard.tsx` + `MetricMiniGrid.tsx` + `miniMetrics.ts`): every HealthKit metric without its own full chart gets a small card (max 4 per row: `grid-cols-2 sm:grid-cols-4`, never more) below the section's main widget — value + Today/7-day-avg/Latest label (per the metric's `AggType`) + a one-line explanation. Grouped onto the most-related section: Steps (mobility/gait + activity extras), Energy (nutrition), Heart (cardio recovery), Sleep (respiratory rate, wrist temp), Body (lifestyle & environment). `showTodayCount` adds an "N× today" line (occurrence count); `showTodayTimes` adds a list of the time-of-day of each occurrence (e.g. "08:44, 23:03") — used by handwashing/toothbrushing. This mini-grid is now the ONLY home for metrics without a full chart — `categorize()`/`CATEGORY_COLORS` (the old generic-table category classifier) were deleted as dead code along with the table. `push_count` ("wheelchair pushes") is very likely misdetected for non-wheelchair users — continuous per-minute fractional samples all day is not what real discrete wheelchair pushes look like; the card's description now points at Watch Settings → Accessibility → Wheelchair as the likely cause, not a bug in our aggregation.
  - `TrainingPage`'s right rail shows `TrainingCalendar` for Hevy/Strava but swaps to `HealthStatsPanel` (short, plain-computed — **no AI** — per-section analysis: averages, best/worst day, trend vs. the previous week) when the Health tab is active, since the calendar isn't relevant there. The Health tab's content column also drops its `max-w-4xl` cap at `2xl:` (see Layout width exception above) to fill large-monitor width instead of leaving it empty.
  - **kcal fix (real bug)**: Health Auto Export can export `active_energy`/`basal_energy_burned` in kJ depending on device locale even though every card in the tab labels the value "kcal" — `healthAggregate.ts`'s `qtyOf()` now converts kJ→kcal (÷4.184) at the source for these two metrics, fixing Energy Today, the Energy chart, `HealthStatsPanel`'s Energy stats, and `ActivityRings`' Move ring all at once (they all route through the same aggregation functions).
  - **Basal energy gap-filling (real bug, fixed)**: hours the Watch wasn't worn (charging, off overnight, removed mid-hour) recorded literal zero/partial basal energy even though resting metabolism never actually stops — a day's basal total silently under-counted by however many hours the Watch was off. `computeBasalEnergyDailySeries` (`healthAggregate.ts`) tops up each hour of the target day to at least the **median** of that SAME hour-of-day across the preceding `BASAL_REFERENCE_WINDOW_DAYS` (7) days (only hours with any data count as samples) — median rather than a single day's average so one unusually high/low reference day can't skew the floor, and per-hour-of-day rather than one flat number so a naturally-lower-basal hour (e.g. deep sleep) isn't over-corrected using a naturally-higher hour's rate. Applied to Energy's headline and its Week/Month chart (which now fetch `BASAL_REFERENCE_WINDOW_DAYS` extra buffer days via `shiftDateStr`); `HealthStatsPanel`'s basal average currently still uses the raw (non-topped-up) `computeDailySeries` — same follow-up candidate if that number looks off too.
  - **"Today" headlines now follow the anchor, not literal calendar-today**: Steps/Energy/Heart's headline card (steps/kcal/heart-rate-range + the today-only stats beside it) used to hardcode `todayStr()` regardless of which date `DateNav` had selected, so navigating to a past day changed the chart but not the headline above it. They now query by `anchor` and the heading text switches between "Steps Today" and "Steps · Wed, 2 Jul" (via `labelForAnchor('day', anchor)`) depending on whether the anchor is actually today. Sleep's headline already tracked the anchor correctly (it reads the last night in the currently-fetched range) so it didn't need this fix.
  - **Manual sleep entries**: Sleep has a "+ Manual" button (date + hours) for nights the Watch wasn't worn to sleep — saved as 3 rows (`Deep`/`Core`/`REM`, `source: 'manual'`) via `insertManualSleepEntry` (`healthApi.ts`), matching the same raw per-segment shape real Watch data uses so every existing render path (stage bar, totals, trend chart) handles it identically with no special-casing. The stage split isn't guessed blind — `estimateSleepStageProportions` (`healthAggregate.ts`) averages the user's own historical Deep/Core/REM shares (normalized, Awake excluded) from a fixed 30-day window, falling back to Apple's published typical adult split only when there's no real history yet. The trend chart's tooltip also now shows which source(s) contributed to a given night (e.g. "Manual" vs "Furkan's Apple Watch") so a manually-backfilled night is distinguishable from a real one.
  - **Chart tooltip showed the average twice (real bug, fixed)**: `BarLineChart` renders both a `Bar` and a `Line` on the same `dataKey`/`name` (the whole point of the "translucent bar + line" style) — recharts' default `Tooltip` shows one row per graphical element, so hovering showed the same number twice. Fixed with a custom `Tooltip` `content` renderer that dedupes by `dataKey` before rendering (affects Heart and Body, the two `BarLineChart` consumers).
- Importable Health Auto Export automation configs (daily/weekly-reconciliation/workouts/one-time-backfill) live in `docs/health-auto-export/` — recommended real-world settings confirmed against production data: **Summarize ON, Time Grouping: Hours, all Health Metrics enabled** (not a curated subset).
- Reminder from Apple's own platform docs: HealthKit is unreadable while the phone is locked and background task scheduling is opportunistic — so delivery is best-effort, not guaranteed-real-time, by OS design (not a bug in either app). **App must be set to "Export Version 2"** in Health Auto Export's Workout Configuration (current format — v1 is legacy, no `id` field, different field shapes). If a workout ever arrives without `id` anyway, the webhook falls back to a deterministic key (`name+start+end`) instead of dropping it — still idempotent on re-delivery, just not a real UUID; only a workout with no id AND no name/time to build that key from is actually skipped (counted in the response's `skipped_workouts`). Known gap: `stateOfMind`/`medications`/`symptoms`/`cycleTracking`/`ecg`/`heartRateNotifications` top-level payload arrays are not ingested. Workout numeric fields (`duration`, `activeEnergyBurned`, `totalEnergy`, and each of `heartRate.avg/min/max`) arrive as either a plain number or a `{qty, units}` quantity object depending on the field — the webhook unwraps either shape (`numOrQty()`) rather than assuming one.

Verified against the app's own docs (`help.healthyapps.dev` + the Lybron/health-auto-export GitHub wiki) across several research passes: no HMAC/request-signing exists for this integration — Bearer token / custom header over HTTPS is the documented and only supported auth model, so our `Authorization: Bearer <secret>` approach is correct, not a workaround. Batch-request split behavior (size/count triggers, sequential vs parallel, per-batch failure semantics) is undocumented by the vendor — the webhook is deliberately written to not depend on any of that: every request is processed independently and idempotently regardless of arrival order, duplication, or partial delivery. Recommended app config: **Export Version 2**, **Date Range = "Since Last Sync"** for the recurring automation (add a separate weekly "Previous 7 Days" automation as a reconciliation safety net if gaps are suspected), **Batch Requests ON** once route data / many metrics / fine time-grouping are enabled.

**Not done yet:**
- 🔶 **Exercise demo GIFs — follow-ups** (live): animated GIFs from ExerciseGymGifsDB are wired into `ExerciseTemplatesTab` (see Training Feature Detail). Open items: (a) optional true self-host — mirror the gifs into Supabase Storage and swap `GIF_SOURCE` (client already anchored to that one constant); (b) surface the same `ExerciseThumb` in the Muscles detail list + `HevyWorkoutDetail` (the fuzzy-match layer already supports it); (c) better fuzzy matching / a manual override map if the match rate is poor.
- Football data source (Calendar integration planned; no route wired)
- Activity Log / stats widget
- Routes widget (Home): visual improvement pass + refresh button
- AI update: `ai-proxy` system prompt needs updating to include Media features (episodes, rating, genres, upcoming)
- 🔶 **Finish migrating mutations to `useMutationWithFeedback`**: see the "Known gap" note under Toast feedback above — `useTodos.ts`'s create/update/toggle/delete, `useSchedule.ts`'s create-time-block/create-schedule-block, and most of media/calendar/shop/work/recipes/training-programs' `useMutation` hooks still rely on call-site-level toasting (works today, but inconsistent and easy to regress). `useTransitRoutes`/`useTransitStops` are plain async functions, not mutations at all.

---

## Coding Rules (Strict)

### Mobile-first — MANDATORY
Every component mobile-first. `min-h-[44px]` on every interactive element. No exceptions.

```tsx
// ✅
<button className="w-full md:w-auto min-h-[44px]">
// ❌
<button className="w-32 h-8">
```

Hover-only actions need an always-visible mobile fallback. No horizontal page overflow.

Modal pattern — use `@headlessui/react` Dialog (handles Escape, focus trap, portal automatically):
```tsx
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'

<Dialog open={isOpen} onClose={onClose} className="relative z-[60]">
  <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
  <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
      {/* content */}
    </DialogPanel>
  </div>
</Dialog>
```

### Toast feedback — MANDATORY
Every async action must show feedback on completion. Toasts appear bottom-left.
🟢 success · 🔴 error · 🟡 warning · ⚫ loading.

**For any new TanStack Query mutation, use `useMutationWithFeedback`**
(`src/shared/hooks/useMutationWithFeedback.ts`) instead of bare `useMutation`:
```ts
return useMutationWithFeedback({
  action:         'delete_time_block',   // logError context — the only required extra field
  successMessage: 'Deleted',             // optional — omit for silent-success on in-place edits
  mutationFn:     (id: string) => deleteTimeBlock(id),
  onSuccess:      () => qc.invalidateQueries({ queryKey: ['schedule'] }), // your own logic still runs
})
```
This exists because "every async action must show feedback" was, in practice, hand-copied
per call site — inconsistently applied and easy to forget (real bugs: the daily timeline's
drag/postpone/rename/delete and the to-do list's toggle/delete/reorder had **zero** feedback
on failure; two Developer-tab "clear logs" mutations toasted but never called `logError`,
so a failure to clear the error log was invisible in the error log itself). `useMutationWithFeedback`
bakes the guarantee into the mutation primitive itself — like a return-code check that can't
be skipped — instead of relying on every call site to remember its own try/catch/toast:
error is **always** toasted and logged to `app_error_logs`; success is silent by default
(matching the existing "edits feel live" convention) unless `successMessage` is given.

**Known gap (not fully migrated — do this incrementally when touching these files):**
several mutation hooks are called from multiple components, some of which already wrap
`mutateAsync` in their own complete `toast.loading/success/error` block (e.g. `useCreateTask`/
`useUpdateTask`/`useToggleTask`/`useDeleteTask` in `useTodos.ts`, `useCreateTimeBlock`/
`useCreateScheduleBlock` in `useSchedule.ts`) and some of which call `.mutate()` with no
feedback at all. These were deliberately NOT switched to `useMutationWithFeedback` yet —
doing so would double-toast the call sites that already handle it correctly. The real fix is
to migrate the hook **and** simplify every call site to drop its local toast duplication in
favor of the hook's guarantee — do this the next time one of these files is touched for
another reason, rather than as a big-bang rewrite. `useTransitRoutes`/`useTransitStops`
(`src/features/home/hooks/`) are plain async functions, not `useMutation` — same principle
applies if they're ever converted.

For genuinely one-off async actions that aren't a TanStack mutation at all (a button
handler calling an API directly), the manual pattern is still fine:
```ts
const tid = toast.loading('Saving…')
try {
  await doSomething()
  toast.dismiss(tid); toast.success('Saved ✓')
} catch (err) {
  toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
}
```

### Reference viewport sizes (design/testing baseline)
Use these three when checking responsive behavior — get the current size in the browser console with `window.innerWidth + 'x' + window.innerHeight`:
- **Mobile**: 852×393
- **Laptop**: 1469×680
- **Monitor**: 2450×1130

### Layout width — content-sized, left-aligned (MANDATORY)
Never stretch content edge-to-edge. Widgets are sized to their content, not the viewport.
- Page wrapper: `w-full px-4 sm:px-6 lg:px-8` (left indent, NOT `mx-auto` centered).
- Each content block gets a `max-w-*` capped to what it needs, **left-aligned** — leftover horizontal space stays on the right. Reference: reading/list column caps at `max-w-2xl`; small stat cards much smaller (`max-w-xs` / `~15rem`); a side rail (e.g. calendar) is a fixed `w-[360px]`.
- Small cards flow side-by-side (grid/flex-wrap), never stack full-width.
- Page background is `bg-canvas` (#EDE4D5, soft warm cream); cards stay white for contrast.
- **Exception — data-dense dashboards on large monitors**: a content column capped at `max-w-4xl` next to a fixed-width side rail leaves a large dead zone on 2xl+ (2450px-class) monitors. For these (e.g. Training → Health), drop the cap at `2xl:` (`2xl:max-w-none 2xl:flex-1`) so the column grows to fill the remaining flex space instead of leaving it empty — grids inside can also add a `2xl:grid-cols-*` step. Still left-aligned/content-sized below 2xl; this only kicks in once there's real estate to fill.

### Other rules
- Date format: always `en-GB` (DD/MM/YYYY). Never `en-US`.
- Never hardcode `amber-*` — use `accent-*`.
- Comments only when WHY is non-obvious.
- Component > ~150 lines → split it.
- No error handling for impossible scenarios. Only validate at system boundaries.

---

## Key Patterns

**Toast store:** `import { toast } from '../../../app/store'`

**Planning — `UnifiedPlanModal`:** The ONE modal for all task/time-block planning (`src/shared/components/plan-modal/`). Schedule + Task tabs, shared editable title, always-on-top z-index. Shape it entirely from the call site — never edit the modal folder:
- `config` → `tabs`, `defaultTab`, `heading`, `hide*/lock*` field keys per tab
- `defaults` → prefills (title/date/startTime/duration/category/color/section/priority/domain/dueDate…)
- `source` → `{ sourceType, sourceId, taskSourceType }`; `sourceType` MUST be a valid `time_blocks.source_type` (`task`/`training_session`/`movie`/`tv_episode`/`project_item`/`calendar`/`manual`)
- `scheduleExtra` / `taskExtra` → caller-owned children injected into a tab
- `task` → edit mode (Task tab) · `onSaved` → post-save hook
- Rules + changelog live at the top of `UnifiedPlanModal.tsx`; log every logic change there.

**RP5 Games:** Separate Supabase instance (`VITE_RP5_SUPABASE_URL`). Read from `v_games_summary` / `v_games_full` views. Write to raw `games` table. `series_name` only exists in the view — never select from raw `games`.

**Home widgets:** All use `WidgetShell` + `useWidgetState`. Disable queries when collapsed.

**Daily briefing (Home):** `DailyBriefing.tsx` (top of HomePage) — an AI-written Turkish morning digest. `briefingApi.ts::generateDailyBriefing()` gathers real data (today's tasks/schedule, upcoming+last training, weekly currency trend via `fetchCurrencyWeekTrend`, weather, TR/NO/world news headlines, media-in-progress, in-progress project items) into a context string and calls the shared `invokeAI` (exported from `aiApi.ts`) with a briefing-specific prompt (plain text, emoji section headers, NO markdown — rendered with `whitespace-pre-wrap`, no markdown lib). **Once-per-day** is enforced in `useDailyBriefing.ts`: React Query keyed by the date + `staleTime: Infinity` + `initialData` seeded from a `localStorage` cache (`lasci.dailyBriefing`, `{date,text}`) when the cached entry is for today — so it auto-generates exactly once per calendar day per browser; the ↻ button is the explicit manual regenerate (costs one AI request). localStorage (not a DB table) chosen deliberately: zero migration, single-user, per-browser is fine.

**TMDB images:** `https://image.tmdb.org/t/p/{size}{path}` (e.g. `w342`)

**Google Calendar:** OAuth scope `calendar.events` covers read + write. Token stored in `useCalendarStore`. Reconnect required if previously connected with read-only scope. **Two-way block↔event link (migration 038):** `time_blocks.google_calendar_event_id` stores the created event id; `scheduleApi.updateTimeBlock`/`deleteTimeBlock` (API layer, so ALL paths — modal, DayTimeline drag, task delete — are covered) sync/remove the calendar event when a block moves/deletes; `UnifiedPlanModal.linkCalendarEvent` stores the id on create and never re-creates when one exists (no more orphaned/duplicate events). All calendar calls are best-effort (try/catch + logError) — a sync failure never blocks the local write.

**Schedule cache invalidation:** time-block mutations (`useCreateTimeBlock`/`useUpdateTimeBlock`/`useDeleteTimeBlock`) invalidate the WHOLE `['schedule']` namespace + `['calendar']`, not a single day key — every consumer reads schedule under different sub-keys (`['schedule','day',date]` for Daily/Home/Work timelines via the shared `useTimeBlocks` hook, `['schedule','training-range',…]` for Training calendar/Home next-session). Never give a schedule view its own private query key (Work's old `['time-blocks']` key went stale because nothing invalidated it).

**@headlessui/react v2 — UI primitives (never use manual open/close state for these):**

| Use case | Component | Anchor / notes |
|---|---|---|
| Modal / drawer | `Dialog` + `DialogBackdrop` + `DialogPanel` | `transition` prop on both; `data-[closed]:` for exit animation |
| Search autocomplete | `Combobox` + `ComboboxInput` + `ComboboxOptions` + `ComboboxOption` | `immediate` if options should show on focus; `data-[focus]:bg-cream-50` on option |
| Floating action panel | `Popover` + `PopoverButton` + `PopoverPanel` | `anchor="top start"` / `anchor="bottom start"` via Floating UI |
| Dropdown menu | `Menu` + `MenuButton` + `MenuItems` + `MenuItem` | `anchor="bottom end"`; keyboard nav built-in |

All headlessui components handle: click-outside close, Escape key, focus trap, portal rendering, ARIA attributes. Never add these manually.

Reference files: `src/shared/components/plan-modal/UnifiedPlanModal.tsx` (Dialog), `src/features/home/components/ruter/StopSearchInput.tsx` (Combobox), `src/features/media/components/PlanThisButton.tsx` (Popover), `src/shared/components/SettingsMenu.tsx` (Menu).

---

## Environment Variables

| Variable | Where |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Main Supabase |
| `VITE_TMDB_API_KEY` | TMDB (client-safe) |
| `VITE_GOOGLE_CLIENT_ID` | Calendar OAuth |
| `VITE_RP5_SUPABASE_URL` / `VITE_RP5_SUPABASE_ANON_KEY` | RP5 games Supabase |
| `CLAUDE_API_KEY` / `OPENAI_API_KEY` | Supabase Vault only — never in client |
| `HEVY_API_KEY` / `HEVY_WEBHOOK_SECRET` / `HEVY_USER_ID` | Supabase Vault only — never in client |
| `HEALTH_EXPORT_WEBHOOK_SECRET` | Supabase Vault only — Health Auto Export's REST API automation sends this as `Authorization: Bearer <secret>`; reuses `HEVY_USER_ID` for the single-user id |

---

## Edge Functions (Supabase)

**Deploy: Edge Functions are deployed MANUALLY** (Supabase Dashboard, or `supabase functions deploy` via CLI). A GitHub Actions auto-deploy job was tried and removed — it kept failing/red on the runner and wasn't worth the noise. Manual deploy is clean now because **every function is self-contained (no `_shared/` imports** — the shared Hevy upsert logic is inlined into all 4 Hevy functions), so a Dashboard paste no longer hits the "Module not found `_shared`" bundling error. `supabase/config.toml` still records the per-function JWT settings (`hevy-sync`/`health-export-webhook` → `verify_jwt = false`) — set the same toggle in the Dashboard when deploying those two, or it's applied automatically if you deploy via the CLI. **DB migrations are also manual** (Dashboard → SQL Editor or `supabase db push`).

| Function | Purpose |
|---|---|
| `ai-proxy` | Gemini AI calls. **Generic DB layer** (`describe_database`, `db_query`, `db_insert`, `db_update`, `db_delete`) over a curated `DB_CATALOG` allow-list — the AI reads/writes any of the user's own tables (tasks, time_blocks, recipes+ingredients+meal_plans, shop_*, projects, media entries). Guardrails: default-deny allow-list (token/secret/auth tables unreachable), `access: 'rw'|'ro'` per table (hevy_*/strava_activities/health_metrics/health_workouts/movies/tv_series are read-only — synced externally), every op force-scoped to `user_id`, no DDL (structured ops, not raw SQL), update/delete refuse empty filters. Reads `app_error_logs` (read-only) too, so the AI can help diagnose failures. **Behavioral guardrails in the system prompt**: the AI must get explicit user confirmation BEFORE any delete (never auto-deletes), and must announce what it's about to do before any create/update/delete. Plus special-purpose tools that generic CRUD can't cover: `get_calendar_events`/`get_next_transit` (external APIs), `get_media`/`plan_media`/`mark_episode_watched` (media logic), `get_health_stats` (daily/weekly averages), `get_shop_categories`/`create_shop_category`/`create_shop_item`/`ask_clarifying_question` (Shop chat panel). **Health fix (real bug):** `get_health_stats` and the catalog both still pointed at `health_daily_stats`, a table dropped when migration 041 moved Health to point-in-time grain — the AI's health answers were silently broken (empty/stale) ever since. Rewritten to query `health_metrics` directly and aggregate with the same rules as the frontend's `healthAggregate.ts` (sum steps/energy, min/max/avg heart rate, latest resting HR, kJ→kcal normalization). The system prompt also now explicitly tells the AI to *analyze* health data (trends, comparisons, honest criticism) instead of just reciting numbers back. **Transit toolkit** — `plan_trip` (point-to-point EnTur journey planning with transfers), `get_next_transit` (departures from a saved stop by name OR any stop by exact id), plus `get_saved_transit`/`search_transit_stops`/`save_transit_stop`/`save_transit_route` (inspect/search/persist saved stops+routes; the save fns are plain inserts into `user_transit_stops`/`user_transit_routes` mirroring the client's `useTransitStops`/`useTransitRoutes` hooks). **Latency design (this was a real 3-4min pain point — fixed):** `plan_trip` is a ONE-SHOT call. The system prompt + tool descriptions tell the model to call it directly with the user's own words (`from:"ev", to:"iş"`) and NOT to look things up first — earlier "investigate first" wording caused ~5 sequential Gemini turns (each a full round-trip) vs the ~2 it takes now. `plan_trip` resolves both endpoints itself against saved stops/routes loaded ONCE (not re-queried per endpoint), resolving in parallel: empty→default saved stop; exact `NSR:StopPlace:` id→used as-is (name backfilled from the trip legs, no extra lookup — the old `fetchStopName` call was removed); "home"/"ev"/"work"/"iş" (+variants)→saved-label fuzzy match; else→geocoder top match. When a side won't resolve, it returns `{success:false, needs_clarification:true, candidates:[...]}` so the model asks ONE `ask_clarifying_question` with those options instead of firing more search turns. Only a regex-validated `NSR:StopPlace:` id or finite coords are ever interpolated into GraphQL (injection-safety). Anti-hallucination is enforced structurally (report only what the tool returns; call once and report) rather than via pre-verification turns. **Known follow-up (not done, needs testing):** Gemini `cachedContent` for the static systemInstruction+TOOLS, and not prepending the full `buildContext()` LIVE DATA dump to transit-only questions — both are token wins the expert review flagged but weren't shipped blind. New EnTur GraphQL fields (mode filters, service-disruption/situations) also deliberately NOT added speculatively — the schema wasn't verifiable in-session (EnTur API + docs blocked by the sandbox's egress policy, not by EnTur); add once verified. Also `responseSchema` (structured recipe extraction) + `fetchUrl` (server-side page fetch) modes. Dead `log_workout`/`get_workouts` removed (hit the dropped `training_sessions` table — training is now Hevy/Strava, read via `db_query`; planned sessions = `time_blocks` category='training'). **Gemini transient-error retry:** Gemini occasionally returns a "model overloaded"/high-demand 5xx that clears up within seconds if retried (~80% of requests were hitting this) — distinct from a 429 (real daily/per-minute quota, not helped by retrying, still surfaces immediately via `throwRateLimit`). `fetchGeminiWithRetry` wraps every Gemini `fetch` call (the tool-calling loop, the turn-limit summary call, and `callGeminiStructured`) and retries up to 6 times with a short backoff on 5xx only, so the user only sees a failure after genuinely exhausting attempts instead of on the first transient hiccup. |
| `calendar-oauth` / `calendar-token` / `calendar-disconnect` | Google Calendar OAuth |
| `football-api` | API-Football proxy (currently unused — free tier doesn't cover current season) |
| `news-proxy` | RSS feed proxy |
| `strava-auth` / `strava-activities` / `strava-disconnect` | Strava OAuth |
| `hevy-initial-sync` | Bulk import all Hevy data (workouts, templates, routines, body measurements) |
| `hevy-sync` | Webhook receiver — new workout from Hevy → upsert to Supabase. **Deploy gotcha (real bug, hit in production):** if workouts stop appearing automatically (manual Sync still works, but nothing arrives on its own), check Supabase Dashboard → Edge Functions → `hevy-sync` → **"Enforce JWT Verification" must be OFF** — Hevy sends its own bearer secret, not a Supabase JWT, so leaving this on makes Supabase reject every webhook call before our code even runs (same class of gotcha already noted for `health-export-webhook`). Confirmed via Edge Function logs + toggling the setting. |
| `hevy-incremental-sync` | Events-based incremental sync (workout edits/deletes since last cursor) + full re-fetch/upsert of routines, routine folders & body measurements (event-less collections) so Sync surfaces new Hevy-app routines without a full re-import |
| `hevy-api` | Write proxy — web → Hevy (create/update workouts, routines, body measurements) |
| `health-export-webhook` | Webhook receiver — Health Auto Export (iOS app, reads Apple HealthKit incl. Huawei Health data synced into HealthKit) POSTs `{data:{workouts,metrics}}` → upsert into `health_workouts`/`health_metrics`. Same auth pattern as `hevy-sync` (Bearer secret, no Supabase JWT — disable "Enforce JWT Verification" for this function). Every incoming metric point becomes its own row — idempotent on `(user_id,metric_name,recorded_at,source)` / workout `id` — no aggregation at ingest (see Training Feature Detail's Health Auto Export section for why), safe against Health Auto Export's "Batch Requests" splitting one export into multiple calls. |

**Hevy upsert logic (`upsertWorkoutToDb`/`upsertRoutineToDb`)** — the upsert-row→delete-exercises→re-insert-exercises+sets logic, plus the "a logged Hevy workout auto-closes its planned-session task" behavior (if `workout.routine_id` matches an open `tasks` row with `source_type='training_session'` from RoutinesTab's "Plan routine", that task + its linked `time_blocks` row get deleted). This was a shared `_shared/hevySync.ts` Deno module, but Supabase Dashboard deploys don't bundle sibling `_shared/` files (deploy-time "Module not found"), so it's now **inlined verbatim into all 4 Hevy functions** (`hevy-sync`/`hevy-initial-sync`/`hevy-incremental-sync`/`hevy-api`) — each is self-contained and deployable by any method (CI, CLI, or Dashboard paste). **Trade-off:** if this logic changes, update the copy in all four by hand (there's a header comment in each flagging this).

**DB Migrations:** Applied manually — Supabase Dashboard > SQL Editor or `supabase db push` (local CLI). Does not run automatically in GitHub Actions.
