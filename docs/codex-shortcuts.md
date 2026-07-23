# Codex — iPhone Shortcuts owner (task board + rules)

> **How this doc is used.** Codex is the AI that owns the iPhone **Shortcuts
> generator** (`scripts/iphone-shortcuts/`). The user tells Codex "check your
> tasks" → Codex reads THIS file and works the open items in the *Codex tasks*
> section. **Claude is the manager**: it writes/updates the tasks here, owns
> everything outside the generator (gateway, ai-proxy, web app, DB, migrations),
> and reviews Codex's PRs. The user only talks to Claude; Claude routes work to
> Codex through this file.

## Roles
- **Codex owns:** `scripts/iphone-shortcuts/**` — the Node generator that emits
  Apple `.shortcut` files (and its README). Nothing else.
- **Claude (manager) owns:** `supabase/functions/**` (phone-gateway, ai-proxy,
  push-send, …), `src/**` (web app), migrations, all other `docs/**`, and PR review.

## Rules Codex MUST follow
1. **Scope.** Touch ONLY `scripts/iphone-shortcuts/`. Never edit gateway/edge
   functions, web app, migrations, or other docs. If a task needs a new gateway
   **action** or response **field**, do NOT invent it — flag it for Claude (add
   a note under *Needs from Claude* below) and wait; Claude ships the gateway
   side, then you wire the shortcut.
2. **English-only in the repo** — code, comments, commit messages, PR text
   (CLAUDE.md rule). The ONE exception: **Turkish is allowed inside the
   generated shortcuts' user-facing strings** (notification/menu text the user
   reads on the phone) — that's the personal-device UX language, matching the
   existing widget/brief precedent. Repo artifacts English; on-phone text Turkish.
3. **One branch per feature.** `git fetch` + branch from the latest `main`.
   Do NOT spawn several parallel branches doing the *same* feature — that caused
   the #369/#372/#374 duplicate-collision Claude had to clean up. If unsure
   whether something's already in `main`, check before re-implementing.
4. **Stay in sync with the gateway contract.** The action names + body fields a
   shortcut sends MUST match `docs/iphone-examples.md` (gateway API table) and
   `docs/scriptable-food-logger.md`. If the contract needs to change, that's a
   Claude task (rule 1).
5. **Verify before PR.** Generate → `shortcuts sign` → `open` (import) →
   `shortcuts run "<name>"` where possible; put the actual result in the PR body.
6. **PR discipline.** Draft PR against `main`, clear body, **no secrets**
   (placeholder pattern only). Don't stack new commits on an already-merged branch.

## Codex tasks (open)
> Status: `todo` / `in progress` / `blocked` / `done`. Claude edits these. Every
> shortcut calls `POST /functions/v1/phone-gateway` with the `x-phone-secret`
> header (placeholder) — mirror the exact "Get Contents of URL" pattern in
> `docs/iphone-examples.md`. Do NOT compute anything in the shortcut that the
> gateway can return; the gateway returns final values.

- **C1 · Audit + fix all current shortcuts — `done`.** PR #379 audits the
  generated shortcuts and fixes the clear generator-side issues found during the
  pass. The current imported Shortcuts library has one correct copy of each
  generated shortcut: `Log Creatine`, `Su İç`, `AI'a Sor`, `Sabah Brief`,
  `Beslenme Durumu`, `Uyku Özeti`, `Atıştırmalık Logla`, and `Akşam Yemeği
  Logla`. The old numbered / ASCII-name duplicates were removed. The generated
  voice shortcuts use Turkish dictation / speech where applicable:
  `AI'a Sor`, `Atıştırmalık Logla`, and `Akşam Yemeği Logla` are set to
  `tr-TR`.

- **C2 · "Uyku İstatistikleri" — NON-AI, deterministic — `blocked` (needs gateway
  `sleep_stats`, Claude).** A rich sleep card from REAL numbers (not the AI).
  Show every sleep metric we have for last night, omitting any that are absent:
  total sleep (h) · time in bed · **stage durations** deep / light(core) / REM /
  awake · bedtime → wake · sleeping heart rate · HRV (ms) · SpO2 % · respiratory
  rate. Mirror the existing HTML-card style. **Wire once Claude ships
  `sleep_stats`**, which will return
  `{ok, last_night:{hours,in_bed_h,deep_h,core_h,rem_h,awake_h,start,end,sleeping_hr,hrv_ms,spo2_pct,resp_rate}, nights:[…7d]}`.

- **C3 · "Bugünün Taskları" — `blocked` (needs gateway `tasks_today`, Claude).**
  A deterministic list of today's open tasks + today's schedule. **Wire once
  Claude ships `tasks_today`**, returning
  `{ok, tasks:[{title,priority,due_time}], schedule:[{time,title}]}`. Render as a
  card / notification list.

- **C4 · "1L Su Ekle" — `done`.** The generator emits `Su İç`, which calls
  action `log_water` with body `{ "amount_ml": 1000 }` and renders a Turkish
  result card. Placeholder generation, signing, real-secret local signing, import,
  and live gateway verification were completed in PR #379; the live gateway
  returned `{ok:true, logged_ml:1000}` during verification.

## Needs from Claude (Codex writes here; Claude picks up)
- _(empty — add items as they arise)_
