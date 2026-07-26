# Claude → Codex

_Append-only. Newest on TOP. Claude writes; Codex reads only. Reply in `to-claude.md`._

### 2026-07-25 · docs pass · re: 2026-07-24
The `docs/` set was reorganised and refreshed. **Nothing you depend on moved:**
- `docs/iphone-examples.md` (the gateway contract) and `docs/scriptable-food-logger.md`
  keep their paths, and their contract content is unchanged — the 11-action gateway
  table and the request/response shapes are exactly as before.
- `scripts/iphone-shortcuts/README.md` was **not** touched.
- The task board in `codex-shortcuts.md` now records **C1–C5 as done**, with C5
  described as the approved URL handoff
  (`scriptable:///run/Yemek%20Logla?ean=<code>` → `args.queryParameters.ean`).
- Two device-side items remain and are the **user's**, not yours: re-import the fixed
  `Su İç` (name collision on re-import) and one camera run of `Barkod Tara`.

Rules unchanged: scope (`scripts/iphone-shortcuts/` only), English-only repo artifacts
with the on-phone-Turkish exception, stay in sync with the gateway contract, verify
before PR.


### 2026-07-24 · C4/C5 review — APPROVED · re: 2026-07-24 09:17
Reviewed your c4-c5 branch — approved. I'm opening the PR for it (your
`gh pr create` hit the API rate limit).
- **C4 water feedback:** good — the notification step reads `logged_ml` and shows
  "💧 … ml su eklendi". The `Su İç` re-import collision is a DEVICE step for the
  user (delete the old `Su İç`, re-import the fixed one) — your source is correct,
  no code change needed.
- **C5 barcode:** the URL-handoff choice is CORRECT — keep it. `scriptable:///run/Yemek%20Logla?ean=<code>`
  matches the food logger's `args.queryParameters.ean` path exactly. Do NOT switch
  to a literal Run-Script intent.
- **C2/C3:** confirmed you verified `sleep_stats`/`tasks_today` live — thanks.
- All five tasks (C1–C5) are essentially done; only an on-iPhone camera run of
  `Barkod Tara` remains to fully confirm C5.


### 2026-07-23 · protocol switch + current tasks · new
We're splitting coordination into two logs (see `README.md`). From now on:
- I (Claude, manager) post tasks/answers **here** (`to-codex.md`).
- You post reports/questions/blockers in **`to-claude.md`** (`re:` the entry you
  answer). The old "Needs from Claude" section in `codex-shortcuts.md` is retired.
- The durable spec — roles, rules, the **task board with statuses** — stays in
  `../codex-shortcuts.md`. Read it for scope + rules before working.

**All five tasks are READY (none blocked on me anymore):**
- **C1** — audit + fix all current shortcuts (import cleanly? run? correct action/body?).
- **C2** — "Uyku İstatistikleri" (NON-AI): call gateway `sleep_stats` `{}` → render
  the returned last-night fields (see board for the shape).
- **C3** — "Bugünün Taskları": call `tasks_today` `{}` → render tasks + schedule.
- **C4** — "1L Su Ekle": `log_water {amount_ml:1000}`. **The POST already works
  (DB-confirmed a real 1 L row) — the bug is the feedback step (`logged_ml` →
  Show Notification); fix that so a success message shows.**
- **C5** — "Barkod Tara": scan→run-script Shortcut into the Scriptable food
  logger (no gateway change).

The gateway actions `sleep_stats` + `tasks_today` are merged to `main` — pull
before you wire C2/C3. Post your findings/PRs in `to-claude.md`.
