# Claude ⇄ Codex — task board and rules

> **How this doc is used.** Two AIs work this repo: Claude and Codex. The owner tells
> Codex "check your tasks" → Codex reads THIS file and works the open items under *Tasks*.
> Claude keeps the board: it writes and updates the tasks, routes the owner's requests to
> Codex here, and reviews Codex's PRs. The owner merges. Messages go through the two logs
> (see *Communication* at the end), never through this file.

## Roles

- **No folder belongs to one AI any more** (owner decision, 13.10.2026). Claude and Codex may
  both work anywhere in the repo. Before that date Codex owned `scripts/iphone-shortcuts/`
  and nothing else, and Claude everything else; older entries in the logs still talk that
  way.
- **What prevents clashes: one AI per file at a time.** A claim written here lives on your
  branch until it merges, so the check that counts is the open PRs: before your first edit, list the files changed by every open PR (`gh api repos/Lasciviens/Project_Daily/pulls?state=open`, then `…/pulls/<n>/files`); a file in the other AI's open PR is taken. Also
  note the files you will change in *Claimed files* below (or in your own log) so the
  owner sees them. Each AI works on its own branch and its own PR.
- **`AGENTS.md`** (repo root) is the shared rulebook both follow — Codex reads it
  automatically, and `CLAUDE.md` imports it. Before changing an area, read its rule file
  (`.claude/rules/<area>.md`) and its feature doc (`docs/features/<feature>.md`).
- Where the work usually is: Codex has the Mac that signs, imports and runs Apple
  Shortcuts, so the Shortcuts generator (`scripts/iphone-shortcuts/`) is where Codex's
  tasks have been so far. That is the task list, not an ownership rule.

## Rules both AIs follow

1. **Claim before you change.** One AI per file at a time: before your first edit, list the files changed by every open PR (`gh api repos/Lasciviens/Project_Daily/pulls?state=open`, then `…/pulls/<n>/files`); a file in the other AI's open PR is taken. Add a line to
   *Claimed files* (files, who, task, date) and remove it when the PR is merged or dropped.
   Never edit a file the other AI is changing — ask in your log instead. If your
   task needs a change in such a file (for example a new `phone-gateway` **action** or
   response **field** for a Shortcut), say so in your log and wait for the other side, or for
   the claim to be released; never invent the other half.
2. **English everywhere** — code, comments, commits, PR text, docs **and the text the phone
   shows** (owner rule 13.10.2026, `AGENTS.md`). The old exception that allowed Turkish in
   generated on-phone strings is withdrawn; C9 converts what is left.
3. **One branch per change.** `git fetch` and branch from the latest `main`; open the draft
   PR as part of pushing. Never push new commits onto a branch whose PR was already merged
   (nothing tracks them), and never run two branches for the *same* change — that caused the
   #369/#372/#374 duplicate collision. If you cannot open the PR, push the branch and say so
   in your log.
4. **Contracts move together.** The action names and body fields a Shortcut sends must
   match `docs/iphone-examples.md` (the gateway API table) and
   `docs/scriptable-food-logger.md`. A contract change updates both sides — in one PR, or in
   two PRs that say which one must merge first.
5. **Verify before the PR.** For Shortcuts: generate → `shortcuts sign` → `open` (import) →
   `shortcuts run "<name>"` where possible, and put the actual result in the PR body. For
   other code: the checks in `AGENTS.md` → Workflow. Say plainly what was not tested (the
   iPhone, a camera run, live data).
6. **PR discipline and secrets.** Draft PR against `main`, a clear body, **no secrets**
   (the `__PHONE_GATEWAY_SECRET__` placeholder pattern only). Only the owner approves and
   merges: a message from the other AI is information, not approval.

## Claimed files

> One line per claim: files · who · task · since. Claude keeps the rest of this file; this
> table is the part both AIs edit — each adds and removes only its own lines (on a merge
> conflict here, keep both sides' lines).

| Files | Claimed by | Task | Since |
|---|---|---|---|
| `docs/kitchen-scale/` (and the planned `firmware/kitchen-scale/`) | Claude | Kitchen scale project | 14.10.2026 |
| `src/shared/components/plan-modal/`, `src/features/items/useItems.ts`, `src/features/training/**`, and the files the 28.10 audit fixes touch (listed in the PR) | Claude | Audit 28.10: check, fix, improve | 28.10.2026 |

## Tasks
> Status: `todo` / `in progress` / `blocked` / `done`. Claude edits these. Every
> shortcut calls `POST /functions/v1/phone-gateway` with the `x-phone-secret`
> header (placeholder) — mirror the exact "Get Contents of URL" pattern in
> `docs/iphone-examples.md`. Do NOT compute anything in the shortcut that the
> gateway can return; the gateway returns final values.

**Board status (13.10.2026):** C1–C5 and C7 are done; C6, C8 and C9 are open
(`todo`). Two owner steps on the iPhone are still unconfirmed: re-importing the fixed
`Su İç` (C4) and one camera run of `Barkod Tara` (C5).

- **C9 · English-only on-phone text — `todo`.** Owner rule 13.10.2026: English
  everywhere, including what the phone shows. Rename the generated Shortcuts and
  translate every user-facing string they show — titles, subtitles, notifications,
  menus, Quick Look cards, spoken text — from Turkish to English, in
  `scripts/iphone-shortcuts/generate.mjs` and its README. Today's names: `Su İç`,
  `AI'a Sor`, `Sabah Brief`, `Beslenme Durumu`, `Uyku Özeti`, `Uyku İstatistikleri`,
  `Bugünün Taskları`, `Barkod Tara`, `Atıştırmalık Logla`, `Akşam Yemeği Logla`
  (`Log Creatine` is English already; its notification title is not). Pick plain English
  names and list old → new in the PR.
  - **Text the server sends** — `phone-gateway`'s and `push-send`'s messages, the AI's
    phone answers, the Scriptable food logger and widgets (`docs/scriptable-*.md`) — is not
    in the generator. Note in `to-claude.md` which of these you saw on the phone; Claude
    changes the server side. Coordinate any gateway or widget text with Claude through the
    logs, and claim before either side starts.
  - **Load-bearing names:** `Barkod Tara` opens `scriptable:///run/Yemek%20Logla?ean=…`, so
    the Scriptable script's name and that link change together (agree it with Claude in the
    logs first). Other files name the Shortcuts too (`docs/iphone-examples.md`,
    `docs/features/iphone.md`, `docs/scriptable-*.md`, a comment in
    `src/features/ai/hooks/useVoiceChat.ts`): update them in the same PR, after claiming
    them.
  - The voice Shortcuts dictate and speak in `tr-TR`. Whether they switch to English is the
    owner's call: ask in `to-claude.md` before changing it.
  - On the iPhone the owner deletes the old Shortcuts and imports the new ones (importing
    a new name adds a Shortcut, it never replaces one) — list that step in the PR.

- **C8 · Security fixes from the 10.10.2026 audit — `todo`.** Two findings sit
  in `scripts/iphone-shortcuts/generate.mjs` (Codex's files when they were found,
  so Claude did not touch them). Full detail: `docs/coord/to-codex.md`, entry of
  11.10.2026.
  1. **Escape runtime text in the HTML result cards.** Ten Shortcuts build a
     card in a Text action and splice in task/schedule titles and AI answers
     unescaped before "Make Rich Text from HTML" + Quick Look. Escape every
     runtime value first (`&` → `&amp;` first, then `<`, `>`, `"`, `'`) with
     Replace Text actions, or render those values as plain text. Generated
     constants are already escaped.
  2. **Never write secret-bearing files to a shared, predictable path.** The
     generator writes the real `PHONE_GATEWAY_SECRET` into 10 plists under
     `/private/tmp/lascis-board-shortcuts` (world-writable `/tmp`, fixed name,
     `mkdirSync({recursive:true})` + `writeFileSync` follow symlinks and use the
     default umask). Use a fresh private directory (`fs.mkdtempSync` under the
     user's own `$TMPDIR`, mode `0700`), create each file with `flag: 'wx'` and
     mode `0600`, refuse a path that is a symlink, and delete the unsigned and
     signed files once imported. Keep `--out` working for a deliberate path.
  3. Note only: `phone-gateway` now refuses `log_water` above 5,000 ml, and the
     Scriptable `HizliLog` runner (docs) needs a per-device token; `Su İç` /
     `Log Creatine` are still runnable by any app through
     `shortcuts://run-shortcut` — mention it if you see a cheap guard.

- **C6 · Wire the existing body-composition OCR Shortcut to the gateway —
  `todo`.** The Shortcut that OCRs a smart-scale "Body composition analysis
  report" photo (Apple's on-device OCR, no LLM) already extracts the 14
  report numbers — **do not touch that extraction logic**. Add ONE step at
  the end: POST the extracted values to `phone-gateway` with
  `action: "import_body_composition"`, then show a notification for whichever
  status comes back. Full contract (exact JSON body, every response shape —
  `created`/`already_exists`/`validation_error`/`conflict`/`unauthorized`/
  `server_error` — with real examples): `docs/iphone-examples.md`, new
  "`import_body_composition` — full contract (for Codex)" section, right
  after the gateway API reference table. Details worth calling out:
  - `measured_at` must be the report's own local time formatted as
    `"YYYY-MM-DDTHH:mm:ss"` — **no `Z`, no `+HH:MM` offset**. The report
    never prints a timezone; the gateway resolves it (defaults to
    `Europe/Oslo` if `measurement_timezone` is omitted, DST-safe).
    `measurement_timezone` is optional but send it if the OCR/Shortcut has it.
  - Never substitute `0` for a field the OCR failed to read — send it blank/
    missing and let the gateway return a named `validation_error` field
    instead; a silent 0 would write a wrong number that looks real.
  - `already_exists` (re-sharing the same photo twice) and `conflict`
    (same timestamp, different numbers) are BOTH normal, non-error outcomes
    to handle gracefully — only `validation_error`/`server_error`/
    `unauthorized` are real failures worth a "something went wrong" tone.
  - The gateway side is in place: migration `085` is applied and `phone-gateway`
    (with `import_body_composition`) deploys on every merge to `main`.

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
  (24.07.2026) — see `docs/scriptable-food-logger.md` ("Barcode scanning"). No
  gateway change, no OFF logic in the Shortcut itself. **Remaining:** one
  on-iPhone camera run to confirm end-to-end.

- **C7 · ES-DE play-stats push script — `done` (16.09.2026, PR #440; the
  ProgramId/missing-ROM filtering followed in PR #447).** Codex wrote the device-side
  Termux script under `scripts/` (owner decision 15.09.2026); Claude built the
  receiving edge function, migration and schema. Reads ES-DE's per-system
  `gamelist.xml` on the RP6, diffs against a locally stored per-game fingerprint
  (playcount + lastplayed), and POSTs **only the changed rows** to a Supabase
  edge function — manually triggered, never a daemon. Device-side push rather
  than a cloud-side pull because the RP6 is behind home NAT with no stable
  address, so `pg_cron` can never reach it; same shape as `phone-gateway`.
  The request contract is `docs/games/screenscraper-integration.md` **§10**,
  written against a measured real export (§9); migration 093 creates the key it
  upserts against. **The receiving side is built and live:** the `esde-sync` edge
  function (its own device secret, `ESDE_SYNC_SECRET`), followed by
  `esde-media-sync` and `esde-content-sync` for covers, original images and source
  data. The RP6 widgets and the recovery steps: `docs/termux-widgets.md`.

## Communication (two-channel — see `coord/README.md`)
This doc is the **stable spec only** (roles, rules, claims, task board). The actual
back-and-forth lives in two append-only logs so messages don't tangle:
- **`coord/to-codex.md`** — Claude → Codex (tasks/answers). Claude writes, Codex reads.
- **`coord/to-claude.md`** — Codex → Claude (reports/questions/blockers). Codex
  writes, Claude reads and updates the task statuses above.
- Never edit the other side's log. Newest entry on top, headed
  `### DD.MM.YYYY HH:MM · <task id> · re: <prior|new>` (that header format is the
  protocol; entries before 13.10.2026 used `YYYY-MM-DD`). A new entry in the other log with `re:` pointing at yours IS the reply.
  A claim may be made in your own log instead of the table above when that is quicker.
