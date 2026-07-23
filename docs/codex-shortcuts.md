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

- **C1 · Audit + fix all current shortcuts — `todo` (READY).** The existing
  shortcuts are reported incomplete / working badly. For EACH generated shortcut:
  imports cleanly? runs? hits the correct action + body? Produce a per-shortcut
  findings list in the PR and fix the clear mechanical issues (wrong action/body,
  bad variable passing, import failures). Anything needing a gateway change →
  add it under *Needs from Claude* and mark that shortcut blocked.

- **C2 · "Uyku İstatistikleri" — NON-AI, deterministic — `todo` (READY —
  `sleep_stats` shipped).** A rich sleep card from REAL numbers (not the AI).
  Call action **`sleep_stats`**, body `{}` → returns
  `{ok, last_night:{hours,in_bed_h,deep_h,core_h,rem_h,awake_h,start,end,sleeping_hr?,hrv_ms?,spo2_pct?,resp_rate?}, nights:[…7d]}`.
  Render every field present in `last_night`, OMITTING any that are null/absent
  (sleeping_hr/hrv_ms/spo2_pct/resp_rate may be missing). Show stage durations
  (deep / light=core / REM / awake), bedtime→wake (`start`→`end`), total `hours`,
  `in_bed_h`. Mirror the existing HTML-card style. Do NOT compute anything —
  numbers are final.

- **C3 · "Bugünün Taskları" — `todo` (READY — `tasks_today` shipped).** Call
  action **`tasks_today`**, body `{}` → returns
  `{ok, date, tasks:[{title,priority,due_time}], schedule:[{time,title}]}`.
  Render today's open tasks + schedule as a card / notification list.

- **C4 · "1L Su Ekle" — `todo` (READY, no gateway change).** One tap logs 1 litre:
  action `log_water`, body `{ "amount_ml": 1000 }` → `{ok, logged_ml:1000}`. This
  is already documented as Example 5 in `docs/iphone-examples.md`. Make sure the
  generator emits it and it imports + runs.
  **⚠️ KNOWN ISSUE (user report + DB-confirmed):** the POST already SUCCEEDS —
  a real 1000 ml row lands in `water_log_entries` — but the user says the
  shortcut "didn't work", i.e. the **feedback step fails/doesn't show**. The bug
  is the confirmation part, not the log: fix the `Get Dictionary Value` (key
  `logged_ml`) → `Show Notification` chain so a success message actually appears.
  (A malformed dictionary-key read or notification action makes the shortcut
  look failed even though the water was logged.)

- **C5 · "Barkod Tara" — `todo` (READY, no gateway change).** A companion
  Shortcut that uses iOS's built-in **Scan QR/Barcode** action (camera) →
  **Run Script** the Scriptable food logger (`Yemek Logla`), passing the scanned
  code as input. The food logger already reads it (`args.shortcutParameter`),
  looks the product up on Open Food Facts, asks grams, and logs it — see
  `docs/scriptable-food-logger.md` ("Barcode scanning" note). So this task is
  ONLY the small scan→run-script Shortcut; no gateway change, no OFF logic in
  the Shortcut itself.

## Needs from Claude (Codex writes here; Claude picks up)
- _(empty — add items as they arise)_
