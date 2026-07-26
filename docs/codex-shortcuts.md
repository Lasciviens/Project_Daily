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

**Board status:** C1–C5 complete; open items are two device-side confirmations
(re-import `Su İç`, camera-run `Barkod Tara`).

- **C1 · Audit + fix all current shortcuts — `done`.** PR #379 audited the
  generated shortcuts and fixed the clear generator-side issues found during the
  pass. The current imported Shortcuts library was checked with
  `shortcuts list --show-identifiers` and had one correct copy of each generated
  shortcut: `Log Creatine`, `Su İç`, `AI'a Sor`, `Sabah Brief`,
  `Beslenme Durumu`, `Uyku Özeti`, `Atıştırmalık Logla`, and `Akşam Yemeği
  Logla`. The old numbered / ASCII-name duplicates were gone at last check. The
  generated voice shortcuts use Turkish dictation / speech where applicable:
  `AI'a Sor`, `Atıştırmalık Logla`, and `Akşam Yemeği Logla` are set to
  `tr-TR`.

- **C2 · "Uyku İstatistikleri" — NON-AI, deterministic — `done`.** The
  generator emits `Uyku İstatistikleri`, which calls action `sleep_stats` with
  body `{}` and renders the returned `last_night` sleep metrics plus the `nights`
  list in a Turkish Quick Look card. It uses the deterministic gateway response,
  not the AI `sleep` action. Live-verified after the production `phone-gateway`
  deploy (`sleep_stats` returns `ok:true`); `shortcuts run 'Uyku İstatistikleri'`
  exited 0.

- **C3 · "Bugünün Taskları" — `done`.** The generator emits `Bugünün
  Taskları`, which calls action `tasks_today` with body `{}` and renders today's
  open tasks plus schedule in a Turkish Quick Look card. `tasks_today` is
  live-verified; `shortcuts run` exited 0 (note: macOS stores the name in
  decomposed Unicode form).

- **C4 · "1L Su Ekle" — `done`.** PR #379 added `Su İç` (action `log_water`,
  body `{ "amount_ml": 1000 }`); real-secret import + live gateway verification
  returned `{ok:true, logged_ml:1000}` and a real 1000 ml row is DB-confirmed.
  The feedback step is fixed too: it reads `logged_ml` → a real
  `is.workflow.actions.notification` step titled `Su Eklendi` → "💧 … ml su
  eklendi". **Remaining is a device step for the user, not code:** delete the old
  installed `Su İç` and re-import the fixed one (re-importing the same name
  creates duplicates).

- **C5 · "Barkod Tara" — `done`.** A companion Shortcut that uses iOS's built-in
  **Scan QR/Barcode** action (`is.workflow.actions.scanbarcode`), then opens
  **`scriptable:///run/Yemek%20Logla?ean=<scanned code>`** — a URL handoff into
  the Scriptable food logger's `args.queryParameters.ean` path. Claude reviewed
  and **approved this over a literal third-party Run-Script intent**
  (24/07/2026) — see `docs/scriptable-food-logger.md` ("Barcode scanning"). No
  gateway change, no OFF logic in the Shortcut itself. **Remaining:** one
  on-iPhone camera run to confirm end-to-end.

## Communication (two-channel — see `coord/README.md`)
This doc is the **stable spec only** (roles, rules, task board). The actual
back-and-forth lives in two append-only logs so messages don't tangle:
- **`coord/to-codex.md`** — Claude → Codex (tasks/answers). Codex reads.
- **`coord/to-claude.md`** — Codex → Claude (reports/questions/blockers). Codex
  writes here instead of editing this spec. Claude reads + updates the board above.
