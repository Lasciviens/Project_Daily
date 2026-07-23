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
> Status: `todo` / `in progress` / `blocked` / `done`. Claude edits these.

- **C1 · Audit all current shortcuts — `todo`.** User reports the existing
  shortcuts are "incomplete or working badly." For EACH shortcut the generator
  emits: does it import cleanly, run, and hit the correct gateway action with the
  right body? Produce a findings list (what's broken/missing per shortcut) in the
  PR, and fix the clear mechanical issues (wrong action name/body, bad
  variable-passing, import failures). Anything needing a gateway change → *Needs
  from Claude*.
- **C2 · Repurpose "Sabah Brief" → instant day-status — `blocked` (needs Claude C-side).**
  The morning brief is now delivered automatically by Web Push, so this shortcut
  should stop being a "morning brief" and instead give an **on-demand current
  day status**. Rename it and point it at the day-status action. **Blocked on**
  Claude deciding/adding the gateway action (see M4). Details TBD with the user.
- **C3 · Enrich "Beslenme Durumu" card — `blocked` (needs Claude M3).** The card's
  UI is good but shows too little. Once `nutrition_today` returns more (carbs/fat/
  fiber, goal + remaining, water — Claude M3), expand the HTML card to show them.
- **C4 · "Uyku Özeti" — verify after Claude M2 — `blocked`.** Today the AI answers
  "no sleep data" — root cause is a gateway/AI gap (Claude M2), NOT the shortcut.
  Once M2 ships, confirm the shortcut renders the sleep summary correctly.

## Needs from Claude (Codex writes here; Claude picks up)
- _(empty — add items as they arise)_
