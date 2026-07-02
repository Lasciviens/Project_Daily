# Lasci's Board — Master Project Guide

> Read this before touching any code. Single source of truth.
> Keep this file lean — no clutter, no outdated info, no verbose explanations. Every line must earn its place.

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

**Live URLs:** App: `https://lasciviens.github.io/Project_Daily/#/login` · Repo: `https://github.com/Lasciviens/Project_Daily`

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

---

## Routes

```
/#/login      → LoginPage (public)
/#/home       → HomePage
/#/daily      → DailyPage   (nav: grouped under "Personal" dropdown with Shop)
/#/shop       → ShopPage    (nav: grouped under "Personal" dropdown with Daily)
/#/recipes    → RecipesPage (nav: grouped under "Personal" dropdown)
/#/media      → MediaPage
/#/work       → WorkPage
/#/projects   → ProjectsPage
/#/training   → TrainingPage
/#/games      → GamesPage
/#/developer  → DeveloperPage
```

(No `/football` route — Football is deferred; see Features.)

Protected by `SessionGuard` in `src/app/router.tsx`.

---

## Features

| Feature | Status | Notes |
|---|---|---|
| Auth | ✅ | LoginPage |
| Daily + To-Do | ✅ | DayView, DayTimeline, WeekWidget, MonthWidget, AddTimeBlockModal, ToDoDrawer |
| Shop | ✅ | See Shop section below. Nav: "Personal" dropdown (Daily, Shop, Recipes) in `src/app/layout.tsx` |
| Recipes | 🚧 | Phase 1+2+3 done (CRUD + serving scaling + macros + weekly meal plan + pantry checkbox → Shop). See Recipes section. Phase 4: AI macro estimate / recipe parse |
| Media | ✅ | See Media section below |
| Work | ✅ | Vertical kanban (Overdue/To-do/In Progress/Waiting/Done), Developer tab inside Work, drag-and-drop, HeroTaskWidget (2 focus cards), WorkDayTimeline (work tasks only) |
| AI | ✅ | Gemini 2.5 Flash via Edge Function, create_task function calling |
| Calendar | ✅ | Google OAuth, read + write events, sync/refresh button in DayTimeline header |
| Games | ✅ | RP5 library proxy, 6 view modes, TierEditor, PlayQueue drag-and-drop |
| Training | ✅ | See Training section below. Hevy (workouts, PRs, routines, body) + Strava OAuth. Page-level calendar pinned right. |
| Projects | ✅ | Phases, items, status tracking |
| Developer | ✅ | Standalone `/developer` page (also a tab inside Work) |
| Home | ✅ | WidgetShell, Weather, Ruter transit, Currency, News, Recent Media, Games, Training |
| Command Bar | ✅ | `CommandBar` (⌘K) via `useUIStore.openCommandBar` |
| Football | ⛔ | Deferred — no route wired. API-Football free tier stops at 2024. Future: fixtures from Google Calendar. |

### Media Feature Detail
Full-width layout (no max-width constraint). Key components:
- `MediaSearch` — movie/TV radio toggle, genre/year/rating filters, TMDB `/discover` or `/search`
- `CompactLibraryStrip` — 4-col poster grid above Discovery; groups: Upcoming/Wishlist/Watching/Paused/Completed; collapse toggle
- `DiscoveryTabs` — Today/This Week/Popular/Upcoming/Norway tabs; manual sync only (24h stale)
- `EpisodesPanel` — season selector, per-episode watched checkbox (saves `watched_on` date), plan checkbox for adding to today's schedule as time blocks, Select All season
- `MediaDetailBody` — personal 1-10 rating, status buttons (save on click), upcoming auto-suggest for future releases
- `TonightPicker` — random movie/series from My List / Trending / Popular
- `ReleaseCalendar` — upcoming releases from wishlist
- `MediaStats` — library stats
- `MediaBackdrop` — rotating backdrop images (fixed, low opacity crossfade)

DB tables: `movies`, `user_movie_entries` (statuses: watching/wishlist/completed/dropped/upcoming), `tv_series`, `user_tv_entries` (statuses: watching/wishlist/completed/dropped/paused), `watched_episodes` (season, episode, watched_on date)
Both movie and TV entries have: `rating int (1-10)`, `genres jsonb`, `personal_note`, `priority`
TMDB images: `posterUrl(path, size)` from `src/integrations/tmdb/client.ts`

### Shop Feature Detail
Wishlist/shopping-planner under `src/features/shop/`. Strict **2-level** category tree — `shop_categories.parent_id` null = top category, set = subcategory; items always attach to a subcategory (`shop_items.category_id`), never to a top category. Page is a fixed two-pane layout (`ShopPage`, `h-[calc(100vh-56px)]`): left = `ShopAIBox` chat panel (fixed width on desktop, fixed height on mobile, internal scroll + pinned input — never grows the page), right = category pills + wishlist grid (its own scroll).
- `ShopAIBox` — chat panel (separate from the app-wide ✦ Ask AI panel) using `sendShopMessage` (aiApi.ts) with a shopping-companion system prompt: converses naturally about plans (not just add-item commands), handles a pasted multi-item basket, and never guesses a new category silently.
- Clarifying questions use a real Gemini function call — `ask_clarifying_question(question, options[])` — not text-parsed conventions. `ai-proxy`'s loop short-circuits on this call (the "answer" must come from the human as a real next turn, not a synthesized tool response) and returns `{ text, quickReplies }`; `ShopAIBox` renders `quickReplies` as tappable buttons.
- `AddShopItemModal` — manual add: top category / subcategory cascading selects, each with "+ New…" to create on the fly.
- `ShopItemCard` — title, notes, price (+ `price_source`: `manual` or `ai_estimate`), platform, link, priority dot, region flag (🇹🇷/🇳🇴), planned date, mark bought/delete.
- No live price-lookup API (Prisjakt/Akakçe have no public free API) — price is manual entry; AI can only give a rough text estimate on request via the chat panel, never auto-writes a price.
- DB: `shop_categories` (id, user_id, name, parent_id), `shop_items` (category_id, title, notes, price, price_source, platform, url, priority, region `TR`/`NO`, planned_date, status `wishlist`/`bought`/`dropped`, source_type `manual`/`ai`). Migrations `029_shop.sql` (schema) + `030_shop_seed_categories.sql` (partial-unique indexes + a starter taxonomy — Electronics/Clothing/Home & Living/Personal Care & Health/Hobby & Games/Sports & Outdoor/Groceries/Books & Stationery — seeded idempotently for every existing user).
- AI tools (ai-proxy, shared with the main Ask AI panel too): `get_shop_categories`, `create_shop_category`, `create_shop_item`, `ask_clarifying_question` — same Gemini function-calling pattern as `create_task`.

### Recipes Feature Detail
Personal recipe collection under `src/features/recipes/` (nav: Personal → Recipes). **Phase 1+2+3 shipped** = CRUD + serving scaling + macros + weekly meal plan + pantry checkbox → Shop; later phase adds AI macro-estimate / recipe-paste-parse. Built fresh in Supabase (RecipeSage was evaluated as an integration/self-host target but rejected — AGPL + separate tRPC service + needs its own server; no consumer recipe app has a usable public API).
**Table naming standard**: every table for this feature is `recipe_*` (matches `shop_*`/`hevy_*` elsewhere) — the one exception is `recipes` itself, which is the feature's root entity (like `tasks`/`movies`/`projects`), not a satellite table.
- DB (migration `031_recipes.sql` + `033_recipe_ingredient_library.sql`): `recipes` (title, description, `servings` base count, instructions, `macro_mode` `manual`/`from_ingredients`, per-serving `calories`/`protein_g`/`carbs_g`/`fat_g`/`sugar_g`, image_url, source_url) + `recipe_ingredients` (name, `quantity` nullable=to-taste, unit, note, sort_order, `library_ingredient_id` nullable FK) + `recipe_ingredient_library` (reusable ingredient catalog — name, unit, macros **always per 100g**, unique per `(user_id, name)`). Ingredient quantities are stored for the base `servings`; macros are stored **per serving**.
- Macro modes: `manual` = typed in directly. `from_ingredients` = computed server-side on save (`computeMacrosFromIngredients` in `recipesApi.ts`) by summing each linked library ingredient's per-100g macros × `quantity/100`, ÷ servings — only ingredients with a `library_ingredient_id` AND a weight/volume unit (g/ml) contribute; others are skipped (surfaced in the UI). `RecipeModal` shows a live client-side preview (`previewMacros`) using the same math against the already-loaded library.
- `RecipeModal` — create/edit: title, base servings, dynamic ingredient rows (qty/unit/name/remove); in `from_ingredients` mode each row can link to a library ingredient or create one inline (`NewIngredientInline`). Macro fields use full labels (Calories/Protein/Carbs/Fat/Sugar), never P/C/F abbreviations. Save replaces all ingredient rows.
- `RecipeDetail` — view + serving stepper: changing servings rescales ingredient quantities (× target/base) and totals macros (per-serving × target, now including Sugar). Edit/delete.
- `RecipeCard` / `RecipesPage` — card grid landing, with a **Library / Meal Plan** tab toggle.
- **Phase 2 — meal plan** (migration `033_recipe_ingredient_library.sql` renamed the table): `recipe_meal_plans` (date, `meal_slot` breakfast/lunch/dinner/snack, plus exactly one of: `recipe_id`, `custom_title`, or `library_ingredient_id`+`ingredient_quantity`+`ingredient_unit` — a raw ingredient logged straight to a day without a recipe wrapper, servings, notes). One entry per `(user_id, date, meal_slot)` — unique index, upserted. `MealPlanWeek` — 7-day × 4-slot grid, week nav, click a cell → `AssignMealModal` (Recipe / Ingredient / Custom mode toggle). Independent of the Daily schedule (its own calendar, by design).
- **Phase 3 — pantry → Shop** (`recipes/api/shopIntegration.ts`, crosses into `shop/api/shopApi.ts` deliberately): `RecipeDetail` shows a checkbox per ingredient ("I already have this" — session state, not persisted). "Add missing to Shop" pushes every unchecked ingredient into a `Groceries → Recipe Ingredients` Shop category (creating it if it doesn't exist yet), with quantity + the recipe title in the item's notes.

### Training Feature Detail
Page layout (`TrainingPage`): faint training-photo header banner; Hevy/Strava pill tabs + Sync/Settings on the **left**; content column (`max-w-4xl`, left-aligned) with `TrainingCalendar` **pinned to the right edge (440px)**, independent of the active tab.
- `HevyTab` sub-tabs: Workouts, Routines, Personal Records, Body, Exercises.
- `TrainingCalendar` — week/month; shows Hevy workouts + Strava activities + **planned training sessions** (`time_blocks` where `category='training'`) as time-coloured dots (upcoming=blue, today=green, past=red). Click a workout → `HevyWorkoutDetail` modal.
- `RoutineModals` — create/edit routines. **Payload must match the Hevy OpenAPI schema exactly** (no extra keys → 400): set fields = `type, weight_kg, reps, rep_range:{start,end}, distance_meters, duration_seconds, custom_metric` (NO `rpe`/`index`); exercise = `exercise_template_id, superset_id, rest_seconds, notes, sets` (NO `index`/`title`). Set inputs render per exercise `type` via `setFieldsForType`.
- Hevy exercise `type` is the `CustomExerciseType` enum (`weight_reps`, `reps_only`, `bodyweight_reps`, `bodyweight_weighted`, `bodyweight_assisted`, `duration`, `weight_duration`, `distance_duration`, `short_distance_weight`, `floors_duration`, `steps_duration`) — typed as `string`, humanised labels in `ExerciseTemplatesTab`.
- Edge functions normalise Hevy responses (`unwrapEntity`) — Hevy may return an entity directly, wrapped, or array-wrapped. Incremental sync reads `event.workout` (updates) / `event.id` (deletes).

DB (Hevy): `hevy_workouts`/`_exercises`/`hevy_sets`, `hevy_routines`/`_exercises`/`hevy_routine_sets` (routine sets also have `rep_range_start/end`), `hevy_exercise_templates`(+`_muscles`), `hevy_routine_folders`, `hevy_body_measurements`, `hevy_workout_events_cursor`.

**Not done yet:**
- Football data source (Calendar integration planned; no route wired)
- Activity Log / stats widget
- Routes widget (Home): visual improvement pass + refresh button
- Dark Mode: full dark/light toggle; apply `dark` class on `<html>`, define dark variants
- AI update: `ai-proxy` system prompt needs updating to include Media features (episodes, rating, genres, upcoming)

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
Every async action must show feedback. Pattern:
```ts
const tid = toast.loading('Saving…')
try {
  await doSomething()
  toast.dismiss(tid); toast.success('Saved ✓')
} catch (err) {
  toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
}
```
Toasts appear bottom-left. 🟢 success · 🔴 error · 🟡 warning · ⚫ loading.

### Layout width — content-sized, left-aligned (MANDATORY)
Never stretch content edge-to-edge. Widgets are sized to their content, not the viewport.
- Page wrapper: `w-full px-4 sm:px-6 lg:px-8` (left indent, NOT `mx-auto` centered).
- Each content block gets a `max-w-*` capped to what it needs, **left-aligned** — leftover horizontal space stays on the right. Reference: reading/list column caps at `max-w-2xl`; small stat cards much smaller (`max-w-xs` / `~15rem`); a side rail (e.g. calendar) is a fixed `w-[360px]`.
- Small cards flow side-by-side (grid/flex-wrap), never stack full-width.
- Page background is `bg-canvas` (#EDE4D5, soft warm cream); cards stay white for contrast.

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

**TMDB images:** `https://image.tmdb.org/t/p/{size}{path}` (e.g. `w342`)

**Google Calendar:** OAuth scope `calendar.events` covers read + write. Token stored in `useCalendarStore`. Reconnect required if previously connected with read-only scope.

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

---

## Edge Functions (Supabase)

**Deploy: manual via Supabase Dashboard or CLI.** The GitHub Actions pipeline only builds and deploys the frontend — `db-migrations` and `deploy-functions` jobs were removed (were failing; to be re-added properly later).

| Function | Purpose |
|---|---|
| `ai-proxy` | Gemini AI calls — function-calling tools incl. tasks/schedule/media/training/projects/transit/**shop** (see Shop Feature Detail) |
| `calendar-oauth` / `calendar-token` / `calendar-disconnect` | Google Calendar OAuth |
| `football-api` | API-Football proxy (currently unused — free tier doesn't cover current season) |
| `news-proxy` | RSS feed proxy |
| `strava-auth` / `strava-activities` / `strava-disconnect` | Strava OAuth |
| `hevy-initial-sync` | Bulk import all Hevy data (workouts, templates, routines, body measurements) |
| `hevy-sync` | Webhook receiver — new workout from Hevy → upsert to Supabase |
| `hevy-incremental-sync` | Events-based incremental sync (edits/deletes since last cursor) |
| `hevy-api` | Write proxy — web → Hevy (create/update workouts, routines, body measurements) |

**DB Migrations:** Manuel olarak uygulanır — Supabase Dashboard > SQL Editor veya `supabase db push` (local CLI ile). GitHub Actions'ta otomatik çalışmıyor.
