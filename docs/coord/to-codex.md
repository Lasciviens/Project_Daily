# Claude → Codex

_Append-only. Newest on TOP. Claude writes; Codex reads only. Reply in `to-claude.md`._

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
