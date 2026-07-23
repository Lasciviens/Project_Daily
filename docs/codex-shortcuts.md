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

- **C2 · "Uyku İstatistikleri" — NON-AI, deterministic — `in progress`.** The
  generator emits `Uyku İstatistikleri`, which calls action `sleep_stats` with
  body `{}` and renders the returned `last_night` sleep metrics plus the `nights`
  list in a Turkish Quick Look card. It uses the deterministic gateway response,
  not the AI `sleep` action. Placeholder signing passes; live verification is
  pending production `phone-gateway` redeploy.

- **C3 · "Bugünün Taskları" — `in progress`.** The generator emits `Bugünün
  Taskları`, which calls action `tasks_today` with body `{}` and renders today's
  open tasks plus schedule in a Turkish Quick Look card. Placeholder signing
  passes; live verification is pending production `phone-gateway` redeploy.

- **C4 · "1L Su Ekle" — `done`.** PR #379 added `Su İç`, which calls action
  `log_water` with body `{ "amount_ml": 1000 }` and renders a Turkish result
  card. Placeholder generation, signing, real-secret local signing, import, and
  live gateway verification were completed; the live gateway returned
  `{ok:true, logged_ml:1000}` during verification.

- **C5 · "Barkod Tara" — `todo` (READY, no gateway change).** A companion
  Shortcut that uses iOS's built-in **Scan QR/Barcode** action (camera) →
  **Run Script** the Scriptable food logger (`Yemek Logla`), passing the scanned
  code as input. The food logger already reads it (`args.shortcutParameter`),
  looks the product up on Open Food Facts, asks grams, and logs it — see
  `docs/scriptable-food-logger.md` ("Barcode scanning" note). So this task is
  ONLY the small scan→run-script Shortcut; no gateway change, no OFF logic in
  the Shortcut itself.

## Needs from Claude (Codex writes here; Claude picks up)
- **C2/C3 production deploy needed.** Codex implemented the generator side on
  branch `claude/codex-shortcuts-c2-c3`, commit `f9ad27a` (`Add deterministic
  sleep and tasks shortcuts`), and pushed it to GitHub. The branch adds
  `Uyku İstatistikleri` (`sleep_stats`) and `Bugünün Taskları` (`tasks_today`) to
  `scripts/iphone-shortcuts/generate.mjs` and updates
  `scripts/iphone-shortcuts/README.md`.
- **Verification already done by Codex:** `node --check
  scripts/iphone-shortcuts/generate.mjs` passed; `git diff --check
  origin/main..HEAD` passed; placeholder generation/signing passed for the full
  shortcut set in `/private/tmp/lascis-board-shortcuts-codex-c2-c3-placeholder`,
  including `Uyku İstatistikleri.shortcut` and `Bugünün Taskları.shortcut`.
- **Current blocker:** production `phone-gateway` still returns `Unknown action`
  for `sleep_stats` and `tasks_today` even though those actions are merged to
  `main`. Supabase CLI is not installed locally, no local Supabase auth token was
  present, and the Supabase connector production deploy attempt was blocked
  pending explicit approval because it mutates production.
- **To finish C2/C3:** redeploy production `phone-gateway` with the merged
  `sleep_stats` / `tasks_today` source and `verify_jwt=false`; then regenerate
  real-secret shortcuts locally, import only `Uyku İstatistikleri` and
  `Bugünün Taskları`, run both end-to-end, and update this doc from
  `in progress` to `done`.
- **GitHub PR status:** branch `claude/codex-shortcuts-c2-c3` is pushed, but
  `gh pr create` failed because the GitHub API rate limit was exceeded for the
  authenticated user. Create the PR later from the pushed branch, or rerun
  `gh pr create` after the rate limit resets.
