# Kobo reading tracker — plan

> **Temporary working document.** Same role as `docs/progress-redesign/PLAN.md` had: it
> exists so the plan survives between sessions while the feature is being built and
> critiqued. Once the feature ships and CLAUDE.md carries a "Books Feature Detail"
> section, **delete this file** — CLAUDE.md is the settled record, this is not.
>
> Status: **research complete, nothing built.** Second pass done: owner decisions folded in
> (§2.3 loans, §4.2 AI catalog, §4.4 glance board), four self-critique findings applied
> (§6.1), two of them resolved with source-level research (§4.2.1 book identity, §3
> Phase 1 incremental sync). **One item is still open and blocks the phase ordering** — see
> the *UNRESOLVED* block at the top of §3.

---

## 1. The device, as it actually is

Confirmed by the owner, not assumed:

| Fact | Value |
|---|---|
| Model | Kobo Clara BW (2024) |
| Firmware | **4.45.23697**, build `f576aa4ee9` |
| Hardware revision | **Unknown — must be checked (N365 vs P365)** |
| Library composition | **Almost entirely sideloaded EPUB.** No store purchases. Rare free library loans (Deichman, Oslo) — **deliberately out of scope for this tracker**, see §2.3 |

Established by research, from the device's own documented internals:

- MediaTek MT8113L, single-core 1.0 GHz, **32-bit ARMv7l**; Linux 4.9.77
- Userland is **BusyBox** (also PID 1), but libc is **glibc** — an unusual pairing, and a
  lucky one: precompiled Kobo binaries and KOReader's `koxtoolchain` glibc targets link
  cleanly against it
- Nickel lives in `/usr/local/Kobo`; onboard storage mounts at `/mnt/onboard`; **almost
  everything, Nickel included, runs as root**
- **Stock SSH server.** Rename `.kobo/ssh-disabled` → `.kobo/ssh-enabled` on the USB
  partition and reboot; the device prompts for a root password on first login. No hack, no
  patching, no third-party daemon. This is a vendor feature on the MediaTek-based Kobos
  (Clara BW / Clara Colour / Libra Colour).

### 1.1 The firmware cliff — the single biggest risk to this feature

Kobo ships **firmware 5.x** to Clara-class devices as of mid-2026 (European units now
arrive with it preinstalled). On 5.x:

- **NickelMenu does not work** and this is structural, not a missing patch: 5.x is built on
  **Yocto**, so a whole new cross-compilation toolchain is needed before Nickel mods can be
  built at all. The reader itself is now a Chromium/JavaScript renderer. No support timeline
  has been announced.
- **KFMon breaks too** — reported on a Tolino Shine 5 (the Clara BW's twin) on `5.0.178115`:
  the launcher icon opens as a picture and NickelMenu stops appearing. The issue is closed
  with no documented fix in its visible content.
- **Every schema fact in this document is 4.x knowledge.** Nobody has published what 5.x
  does to reading-data storage. Even the pure USB-copy-the-sqlite approach should be
  treated as unverified on 5.x.

**Action, before any other work: turn off automatic firmware updates on the device.** This
is not hypothetical risk management — a silent overnight update to 5.x would take the
feature out entirely and there is currently no way back except a downgrade path the
community expects to be closed off.

Secondary note: Kobo shipped a mid-cycle hardware revision in April 2025 — **N365**
(original, 1500 mAh) and **P365** (revised, 1900 mAh) — and **firmware images are not
interchangeable between them.** Irrelevant while we never flash anything, but it must be
known before any firmware-adjacent step is ever taken.

---

## 2. Where the reading data actually is

Two rival sources live on the same device. They do not share data, and one of them is a
trap.

### 2.1 Nickel (stock firmware) — `/mnt/onboard/.kobo/KoboReader.sqlite`

Unencrypted SQLite, ~30 tables, never documented by Kobo; everything known is community
reverse-engineering.

**What is durable:**

| Table | Durable, useful columns |
|---|---|
| `content` | `ContentID`, `Title`, `BookTitle`, `Attribution` (author), `ISBN`, `___NumPages`, `___PercentRead`, `ReadStatus`, `DateLastRead`, **`TimeSpentReading`**, `MimeType`, `ContentType`, `VolumeIndex` |
| `Bookmark` | `BookmarkID`, `UUID`, `VolumeID`, `Text`, `Annotation`, `Type`, `ChapterProgress`, `DateCreated`, `DateModified`, plus ePub-CFI-ish `StartContainerPath`/`StartOffset`/`EndContainerPath`/`EndOffset` |
| `Event` | `EventType`, `EventCount`, `LastOccurrence`, `ContentID`, `Checksum`, `ExtraData` (blob) |

(`OverDriveCards` / `OverDriveLibrary` / `OverDriveCheckoutBook` also exist and hold
library-loan bookkeeping. They are **not read by anything in this plan** — see §2.3.)

**What is not durable, and this is decisive:** `AnalyticsEvents` is the only human-readable
per-session table (timestamps, seconds read, pages turned) and **Kobo wipes it every time
the device goes online.** Any sync — a book sync, a firmware check, anything. What survives
is `Event.ExtraData`, a **serialised Qt `QVariant` map with integrity checksums**;
`kobuddy`'s most recent work (July 2026) is specifically about decoding it, and every
attempt on MobileRead to hand-edit it has failed against the checksums.

The community workaround is to install an SQLite trigger into the device's own database
that refuses the delete. It survives reboots but **a firmware update resets it**, so it must
be reinstalled after every update.

**Three further traps specific to a sideloading reader — i.e. specific to this library:**

1. **kepub vs EPUB.** Kobo's expanded reading statistics are a **kepub feature**. A plain
   sideloaded EPUB is read by a different, older code path. Sideloaded books frequently
   record `TimeSpentReading` but generate **no page-turn events at all** — "ghost time".
   Session reconstruction silently loses hours. The only fixes are converting everything to
   kepub before transfer (Calibre's KePub plugin), or not using Nickel.
2. **Kobo's own annotation export covers purchased and Kobo Plus titles only — not
   sideloaded content.** Readwise's official integration has the same boundary. The
   inversion worth internalising: **DRM'd store books are the easy export case; your own
   DRM-free EPUBs are the hard one.** For this library, the official path is worth nothing.
3. **Reading time is elapsed-time-with-a-book-open, not reading.** Nickel appears to measure
   the gap between book-open and book-close events with no idle detection. One reported
   case: 10 unearned hours from falling asleep with a book open. Consistent with the
   mechanism; treat as the default assumption.

**Conclusion for this library: Nickel's data is the degraded kind.** It is a one-time
historical backfill at best, not a foundation.

### 2.2 KOReader — `settings/statistics.sqlite3`

Read from `plugins/statistics.koplugin/main.lua`, so this is the real schema:

| Table | Columns |
|---|---|
| `book` | `id` (PK), `title`, `authors`, `series`, `language`, **`md5`** (partial-file checksum — the cross-device book identity key, also what kosync uses), `pages`, `highlights`, `notes`, `last_open`, `total_read_time`, `total_read_pages` |
| `page_stat_data` | `id_book` (FK), `page`, **`start_time`** (unix ts), **`duration`** (seconds on that page), `total_pages`, `UNIQUE (id_book, page, start_time)` |
| `page_stat` | a *view* over `page_stat_data` that rescales historical page numbers when pagination changes (font-size changes etc.) |

That is a **timestamped, duration-bearing, per-page event log**, and no cloud sync deletes
it. A day's reading time is one query:
`SELECT SUM(duration) FROM page_stat_data WHERE start_time BETWEEN ? AND ?`.

**How KOReader measures, and where it is wrong:** a page's time counts only if it falls
between MIN (default 5 s) and MAX (default 90 s); anything outside is **discarded
entirely**, and per-page time is capped at `max_sec` (default 120 s) specifically to stop
idle time skewing the data. Sessions split at >~50 page turns or on suspend.

So: **KOReader undercounts by design, Nickel overcounts by design.** KOReader is the more
*reliable* of the two because the data is stable, queryable and never deleted — not because
its numbers are truer. Any "minutes read" figure we display is a **floor**, and the UI
should say so rather than implying precision.

### 2.3 The decision, given this library

**KOReader is the reader this tracker measures. Nothing else is measured.**

Almost nothing is given up, because there are no store purchases. What is given up is
narrow and real:

- **DRM'd library loans (Deichman/OverDrive) are out of scope entirely — settled, not an
  open question.** They are readable only in Nickel, so their sessions would only ever be
  Nickel-quality (overcounted elapsed-time-with-book-open, no page events on the sideload
  code path), and adding them to the same "minutes read" figure as KOReader's undercounted
  per-page log would make that one number dishonest. They are not tracked, not imported and
  not displayed. A loan read on the device simply does not appear.
- KOReader sees folders, not Kobo shelves/collections.
- Progress does not cross between the two readers.

What is gained, beyond the data: **the kepub conversion problem disappears entirely.**
KOReader reads plain EPUB natively with full statistics.

**KOReader version requirement:** the Clara BW needed device-detection fixes twice — first
for `spaBW` (PR #11737), then for the revised hardware's `spaBWTPV` codename (issue #13644,
fixed milestone **2025.08**). On firmware 4.45 with an older KOReader the device freezes for
~5 seconds and reboots. **Install a release ≥ 2025.08.**

---

## 3. Delivery plan — three phases

Each phase is independently useful and the riskiest work is last.

> **UNRESOLVED — research in flight.** The phase ordering below is **provisional** and may
> change.
>
> The problem: the headline feature is a **daily minutes goal plus a streak**, and both need
> *today's* data. But Phase 1's sync is a **manual tap inside KOReader**. An evening's
> reading that is never synced does not read as "unknown" — it reads as **zero**, so the
> goal shows as missed and the streak breaks, for a night that was actually read. Both
> numbers lie, and they lie in the direction that punishes the user. A tracker whose
> headline metric is wrong whenever the user forgets a tap is not a tracker.
>
> Three options are on the table, none chosen here:
> 1. **Accept a sync ritual** and make the UI honest about it — never render a bare zero for
>    a day with no sync; show "last synced N ago" and treat unsynced days as unknown rather
>    than as a broken streak.
> 2. **Move the automatic trigger earlier** — i.e. promote Phase 2 (NickelMenu / KFMon)
>    ahead of the goal-and-streak UI, accepting its fragility as a prerequisite.
> 3. **Hook the plugin to fire on book-close / suspend** from inside KOReader itself, so the
>    sync rides the reading session instead of a separate deliberate action.
>
> One relevant fact already confirmed while researching C3: KoInsight's `db_reader.lua`
> calls `ui.statistics:insertDB()` before reading, which flushes the currently-open book's
> in-memory page stats into `statistics.sqlite3` first — so a sync fired mid-session does
> capture the session so far, not just the last closed book. That helps option 3 and is
> neutral for the others.
>
> A separate research pass is answering this. **Do not pick an option here.**

### Phase 0 — one-time library-inventory import (small, cheap, browser-only)

Plug the device in, copy `KoboReader.sqlite`, parse it **in the browser** with `sql.js`
(SQLite compiled to WebAssembly — reads the file client-side, nothing uploaded), write rows
to Supabase. Zero device modification, zero firmware risk.

**This phase imports the library inventory only. It does not read reading statistics.**
Titles, authors, ISBNs, page counts, file paths, cover ids — nothing else.

**The one surviving justification:** KOReader writes a book into `statistics.sqlite3` only
once you actually **open** it. So KOReader can never tell us about a book sitting on the
device unopened, and Nickel's `content` table is the **only** complete inventory of what is
on the device. That is what this phase is for — seeding the Library grid and the reading
Queue with books that have not been started yet. Everything downstream of "has been opened"
comes from Phase 1.

Its limit, and the reason statistics are excluded: `content.TimeSpentReading` is a
**lifetime aggregate per book**, so it has no day resolution at all and cannot seed a daily
chart. Combined with the sideload "ghost time" and no-page-event traps in §2.1, a Nickel
time figure is not comparable with a KOReader one — the same reasoning that puts OverDrive
loans out of scope in §2.3 applies to Nickel's own numbers for our own books.

**Hard-won query details to copy rather than rediscover** (from `october`, `pettarin`,
`kobuddy` — all read directly, all confirmed from source):

- A book row, not a chapter row: `ContentType = '6' AND VolumeIndex = -1`. The `content`
  table holds **one row per chapter plus a master row per book**; getting this wrong
  multiplies book counts by chapter count.
- Sideloaded only: `ContentID LIKE '%file:///%'`.
- `ContentID` for a sideloaded book is its **`file:///mnt/onboard/...` path**. That is the
  join key to the actual EPUB on the USB mount, which is what makes the identity fix in
  §4.2.1 possible — keep the raw value, do not normalise it away on import.
- Real highlights, excluding dog-ears: `Type != 'dogear'`.
- Highlight join: `Bookmark INNER JOIN content ON Bookmark.VolumeID = content.ContentID` —
  note this joins the *chapter* row, so `content.Title` is the chapter and
  `content.BookTitle` the book. **Not used by this phase** (highlights come from KOReader);
  retained only as reference in case a one-off rescue of pre-KOReader highlights is ever
  wanted.
- Text and date fields are **sometimes hex-encoded** and paths are URI-encoded; both need
  decoding. Titles are stored in sort form ("Vegetarian, The").
- **Work on a copy, opened read-only.** Nickel is a live writer. Never delete
  `-journal`/`-wal` files to "unlock" anything.

### Phase 1 — KOReader + our own plugin → `kobo-sync` edge function (the real feature)

A KOReader plugin reads `statistics.sqlite3` and POSTs JSON to a Supabase edge function on
a menu tap.

**There is a working MIT-licensed template: KoInsight's `koinsight.koplugin`.** Its source
was read, so this contract is confirmed rather than inferred:

- `db_reader.lua` opens `DataStorage:getSettingsDir() .. "/statistics.sqlite3"` and runs
  `SELECT * FROM book`, `SELECT * FROM page_stat_data`, `SELECT md5 FROM book WHERE title = ?`
- `upload.lua` POSTs JSON with an explicit `Content-Length`; payload shape
  `{stats, books, annotations, device_id, version}`
- `call_api.lua` uses `socket.http.request()` with `ltn12` sink/source and
  `socketutil:set_timeout(LARGE_BLOCK_TIMEOUT, LARGE_TOTAL_TIMEOUT)`
- `main.lua` pulls in `ui/network/manager`, i.e. it can bring Wi-Fi up itself

**⚠ The one thing that must be verified before committing to this path:** no explicit
`ssl.https` usage was found in `call_api.lua`, and KoInsight's own documentation has users
configuring a plain `http://server-ip:3000`. Supabase is HTTPS-only. KOReader bundles
LuaSec and a certificate store, and other first-party plugins (e.g. `wallabag.koplugin`) do
use HTTPS — **so it is possible, but it is not proven for this code path.** Verify before
building anything on top of it. If LuaSec turns out to be awkward, the fallback is shelling
out to a bundled `curl` from the plugin.

#### Incremental sync is not optional — design it in from the start

**Confirmed by reading KoInsight's `db_reader.lua` on `master`
(`plugins/koinsight.koplugin/db_reader.lua`): `progressData()` runs a bare
`SELECT * FROM page_stat_data` — the entire history, on every sync.** It then expands each
row into a JSON object that repeats the 32-character `book_md5` and the `device_id` on
**every single row**. That is the template's one genuinely bad decision and it must not be
copied.

**What it costs.** Measured against the row shape the plugin actually emits
(`{"page":…,"start_time":…,"duration":…,"total_pages":…,"book_md5":"<32 hex>","device_id":"…"}`
plus its separating comma) that is **~146 bytes per row**. At the volume already estimated
in §4.2 — ~30 min/day at ~30 s/page ≈ **60 rows/day** — the full-history payload grows:

| History | Rows | KoInsight row shape | Lean shape (md5 hoisted to the book, short keys) |
|---|---|---|---|
| 1 day | 60 | 8.5 KB | 2.3 KB |
| 1 week | 420 | 60 KB | 16 KB |
| 1 month | 1,800 | 257 KB | 70 KB |
| **1 year** | **21,900** | **3.05 MB** | **0.84 MB** |
| 2 years | 43,800 | 6.10 MB | 1.67 MB |

So after a year, a daily tap uploads **~3 MB to deliver ~8.5 KB of new data** — a ~360×
waste, every day, from a 1 GHz single-core ARMv7 device on Wi-Fi. And it is worse than pure
bandwidth: `upload.lua` computes `Content-Length` as `#body`, so the whole JSON string must
be materialised in memory, on top of the Lua table it was encoded from, and the encode
itself is CPU-bound on that hardware.

**The design.**

- **Cursor: a `start_time` high-water mark.** `page_stat_data` carries a dedicated index for
  exactly this — `CREATE INDEX page_stat_data_start_time ON page_stat_data(start_time)`
  (confirmed in `statistics.koplugin/main.lua`'s `STATISTICS_DB_PAGE_STAT_DATA_INDEX`) — so
  `WHERE start_time > ?` is index-backed and cheap on-device. The table's own
  `UNIQUE (id_book, page, start_time)` has `id_book` leading and would not have served.
- **Query with a deliberate overlap:** `WHERE start_time > (mark - lookback)` with a
  lookback of about a day, `ORDER BY start_time ASC`. The overlap costs nothing because the
  server is idempotent, and it absorbs rows flushed late.
- **Where the mark lives:** a **plugin-owned `LuaSettings` file** in
  `DataStorage:getSettingsDir()`, not `G_reader_settings`. Deleting one file is then a
  complete, obvious reset that touches nothing else. (KoInsight reaches into
  `G_reader_settings` for its `device_id`; that is a device identity, which is a different
  lifetime from a sync cursor.)
- **Batch, and advance per batch.** Send ascending-`start_time` chunks and advance the mark
  **only after each batch is acked 2xx**, and only to the **maximum `start_time` actually
  contained in that acked batch** — never to "now". This is the same lesson CLAUDE.md
  already records for `google-tasks-sync`'s `last_success_at`: advancing a cursor past data
  that was not actually processed permanently skips it. Sizing the chunk is a job for once
  real payloads are measured; rows are far smaller than `esde-sync`'s, so its 150 is
  probably too conservative.
- **Hoist repeated fields.** Send `{books: [{md5, …}], stats_by_book: {<md5>: [[page,
  start_time, duration, total_pages], …]}}` rather than repeating the md5 and device id on
  every row. That is the third column in the table above — a ~3.6× reduction before any
  cursor work at all, and the two optimisations compose.

**Failure modes, stated rather than discovered later:**

- **Re-sync / full re-push.** Keep an explicit "Full re-sync" menu action that resets the
  mark to 0. It must always be safe, and it is: `UNIQUE (user_id, book_id, page,
  started_at)` on `reading_page_events` mirrors KOReader's own key, and KOReader itself
  inserts with `INSERT OR IGNORE` against that same triple. **Incremental sync is a
  bandwidth optimisation and never a correctness mechanism** — every correctness guarantee
  lives in the server's unique key, and a full re-push must remain permanently safe.
- **Clock moving backwards** (timezone fiddling, an RTC reset after a flat battery, an NTP
  correction after a long offline stretch) writes rows with a `start_time` *below* the mark,
  which the cursor then skips forever. The lookback window absorbs small skew; anything
  larger needs the full re-sync action. A `rowid` cursor would be monotonic where a
  timestamp is not, but `page_stat_data` is rewritten wholesale by the statistics plugin's
  own DB-merge path (`DELETE … FROM income_db.page_stat_data …` in `main.lua`), so rowids
  are not stable across a merge. **Recommendation: `start_time` plus lookback plus a visible
  full re-sync escape hatch**, not rowid.
- **Clock jumping forward** to a bogus future date poisons the mark and silently suppresses
  everything after it. Refuse to advance the mark beyond `now + a small skew allowance`.
- **Restore / reinstall.** Settings lost, DB intact → mark resets to 0 → one large full
  re-push, idempotent, harmless. DB restored to an older state, mark intact → the server
  already holds those rows. Both directions are safe *because* of the unique key.
- **Known limitation, no fix planned:** KOReader can delete stats (per-book reset, or a full
  statistics reset — several `DELETE FROM page_stat_data` paths exist in `main.lua`). We
  receive no tombstones, so rows deleted on-device stay on the server. Deleting must be a
  deliberate action in our own UI.

**Second thing to verify:** where highlight *text* comes from. KOReader's
`statistics.sqlite3` carries only `highlights` and `notes` **counts** on the `book` row; the
actual text lives in per-book sidecar files (`.sdr/metadata.epub.lua`). KoInsight's payload
has an `annotations` key, so its plugin reads them from somewhere — find out where before
promising highlights in this phase. If it turns out to be sidecar-walking, that is a
separate, larger piece of work and highlights should move to Phase 3.

### Phase 2 — on-device trigger (only once the feature proves itself)

Phase 1 needs a manual tap inside KOReader. Making it automatic means a **NickelMenu** entry
(`cmd_spawn` runs an arbitrary shell command) or **KFMon** (opening a dummy "book" launches
an action), plus a shell script and a working HTTPS client.

Do not build this until daily use proves it is worth the fragility — **unless the
*UNRESOLVED* block at the top of §3 lands on option 2**, in which case this phase becomes a
prerequisite of the goal-and-streak UI rather than a follow-up to it, and this heading is
wrong. Notes for when it happens:

- **NickelMenu documents support for FW 4.6+ but is "thoroughly tested" only on
  4.20–4.31.** KFMon is tested 4.7–4.28. This device is on **4.45** — both are *expected* to
  work and **neither is confirmed at this firmware**. Test before depending on it.
- **BusyBox `wget` is a bad HTTPS client.** Upstream offers either "ignore certificates
  entirely" or "shell out to a separate `openssl` binary that must exist". Which options
  Kobo compiled in, and whether a CA bundle is present, is **unknown**. Check on-device over
  the stock SSH: `busybox wget --help`, `ls /etc/ssl/certs`, `which curl openssl`.
- The community's standard answer is to ship your own `curl` (KoboCloud bundles NiLuJe's
  build for exactly this reason). Since the device is glibc + ARMv7l, those prebuilt
  binaries run; `koxtoolchain` gives a matching cross-compiler if a small static Go binary
  is preferred instead (Kobo-UNCaGED is the precedent — a Go binary doing real networking
  from inside the Nickel environment).
- `NickelDBus` can expose Nickel state over D-Bus (`qndb` CLI); its documented
  `pfmDoneProcessing` signal — content import finished — would be a natural "sync now"
  trigger. Whether it exposes Wi-Fi state is **unconfirmed**; check with `qndb` on-device.

### Deliberately NOT doing

- **Kobo's cloud/store API.** `/v1/library/{uuid}/state` on `storeapi.kobo.com` genuinely
  carries reading state — `StatusInfo`, `Statistics` (spent-reading minutes) and
  `CurrentBookmark` (`ProgressPercent`, `Location`) — proven by `calibre-web`'s server-side
  emulation of it. But it is unofficial, credential-based, changeable at will, **and it only
  covers store-synced titles**, of which this library has essentially none. No value here.
- **The Calibre branch.** `KoboTouchExtended` is archived (Sept 2025) and is a *send-to-device*
  driver anyway — wrong direction. "Kobo Utilities" can store reading state into Calibre
  custom columns, but it is a GUI `InterfaceAction` plugin, not reachable from `calibredb`.
  Adding Calibre as a dependency to read a SQLite file we can already read buys nothing.
- **kosync** (`koreader-sync-server`). Confirmed progress-only: an MD5 document hash, a
  percentage, a position string, a device name. **No reading time, no sessions, no
  highlights.** Wrong protocol for a tracker. (KoInsight can act as a kosync server *as well*
  as a stats dashboard, which is why the two get confused.)
- **Readwise / StoryGraph.** StoryGraph's native Kobo integration (June 2026) and Readwise's
  official integration both cover store purchases and Libby loans only — **not sideloaded
  books** — and neither back-syncs. For this library they are close to useless.

---

## 4. Architecture in this repo

### 4.1 Ingest — `kobo-sync`, a new edge function

Mirrors `esde-sync` exactly, and for the same reason: **a different physical device with a
different lifecycle gets its own door.** Revoking the Kobo must never revoke the RP6
handheld or the iPhone.

- Auth: static, revocable device secret `x-kobo-secret` === `KOBO_SYNC_SECRET`
- Acts as the single user (`HEVY_USER_ID`) **server-side** via the service-role key; the
  service key never reaches the device
- Deploy with **"Enforce JWT Verification" OFF** — the secret is not a Supabase JWT. This
  brings the count in CLAUDE.md's list from nine to ten.
- Self-contained, no `_shared` imports, per this repo's deploy convention
- Batched (`esde-sync` caps at 150; size the cap once real payload sizes are measured),
  every batch independent and idempotent so a retry or a full re-push is always safe

Phase 0's browser import writes through the normal authenticated client, not this function.

### 4.2 Schema

**Point-in-time grain, aggregate at query time.** This repo already learned this lesson the
expensive way: `health_metrics` originally stored one row per metric per day and silently
overwrote every point but the last (migration 041 fixed it). The same shape applies here, so
store the page events and aggregate on read — do not store daily totals.

```
books
  id, user_id
  koreader_md5        -- KOReader's partial-file md5 (§4.2.1) — computable from the file alone,
                      --   so the Phase 0 inventory import computes it too
  kobo_content_id     -- nullable; the Nickel `content.ContentID`, i.e. the file:/// path.
                      --   Justified by the Phase 0 inventory import (re-import matching,
                      --   and the path that the md5 is computed from). NOT for OverDrive —
                      --   loans are out of scope (§2.3).
  title, author, series, language
  isbn, page_count, publisher, published_year, description, cover_url
  read_status         -- want | reading | finished | paused | dropped   (mirrors games.play_status)
  rating              -- personal 1-10, matching media/games convention
  review              -- "yorumlarım": long-form, the user's own text
  notes
  started_at, finished_at   -- auto-stamped on first transition, never clobbered (games.setPlayStatus precedent)
  queue_order         -- the reading queue (games.play_order precedent)
  source              -- koreader | kobo | manual
  needs_review
  UNIQUE (user_id, koreader_md5) WHERE koreader_md5 IS NOT NULL

reading_page_events
  id, user_id, book_id
  page, started_at (timestamptz), duration_seconds
  source              -- koreader | kobo
  UNIQUE (user_id, book_id, page, started_at)   -- mirrors KOReader's own unique key; makes re-push idempotent

book_highlights
  id, user_id, book_id
  text, annotation, chapter_progress, highlighted_at
  source, external_ref
  UNIQUE (user_id, source, external_ref)

reading_settings           -- singleton, PK is user_id (athlete_profile / day_targets precedent)
  daily_minutes_goal, streak_min_minutes, ...
```

Notes on the choices:

- `koreader_md5` as the identity key is KOReader's own answer to "is this the same book on
  another device", and it is what kosync uses. Filename and title both fail on re-downloads
  and renames. **How the two ingest paths are made to agree on it: §4.2.1.**
- `UNIQUE (user_id, book_id, page, started_at)` deliberately mirrors
  `page_stat_data`'s own `UNIQUE (id_book, page, start_time)` — that is what makes a full
  re-push safe, which is what makes the plugin allowed to be dumb.
- Volume is a non-issue: ~30 min/day at ~30 s/page is ~60 rows/day, ~22k rows/year. Tiny
  against the free tier's 500 MB.
- `reading_page_events` is high-frequency bulk-synced data → **no `trg_audit`**, per the
  existing exemption for `hevy_*`/`health_*`. `books` is user-authored → audit it.
- Pre-migration-safe throughout, per the `wishesApi.ts` convention: every read degrades to
  `[]`/defaults on a missing table, every write throws a **named** "migration NNN not
  applied" error rather than failing silently.
- **`books` and `book_highlights` are `rw` in `ai-proxy`'s `DB_CATALOG` — settled.**
  Dictating a review or a to-read note in chat is exactly the intended flow, the same
  reasoning that makes `dev_requests` and `wish_items` `rw`. `reading_page_events` is `ro`
  at most — it is bulk-synced device data the AI has no business writing. This **requires an
  `ai-proxy` redeploy**, which must be added to CLAUDE.md's *Pending manual steps* table
  alongside the migration (the catalog lives in the function, not the client, so the
  entries are inert until it redeploys).

### 4.2.1 Book identity: making the two ingest paths agree — **RESOLVED**

The problem this fixes: `UNIQUE (user_id, koreader_md5) WHERE koreader_md5 IS NOT NULL`
permits unlimited NULL rows, so a book landing first via the Phase 0 inventory (no md5) and
later via KOReader (md5) would create **two rows for the same book**, with no matching
strategy at all.

**The md5 is computable from the file alone, so the inventory import can compute the same
value and the problem disappears.** Confirmed by reading the source, not inferred:

`koreader/koreader` → `frontend/util.lua`, `util.partialMD5(filepath)`:

```lua
local step, size = 1024, 1024
local update = md5()
for i = -1, 10 do
    file:seek("set", lshift(step, 2*i))
    local sample = file:read(size)
    if sample then update(sample) else break end
end
return update()
```

Precisely: **one running MD5 fed with up to twelve 1024-byte samples**, read at byte
offsets `1024 << (2*i)` for `i = -1 … 10`, stopping early at the first read past EOF. With
`lshift = bit.lshift` (LuaJIT, shift counts taken mod 32) the `i = -1` term evaluates to
offset **0**, so the offsets are **0, 1 KiB, 4 KiB, 16 KiB, 64 KiB, 256 KiB, 1 MiB, 4 MiB,
16 MiB, 64 MiB, 256 MiB, 1 GiB**. A typical few-MB EPUB therefore contributes six or seven
samples. The digest is `require("ffi/sha2").md5`, which returns **lowercase hex**.

The chain from that function to the `book.md5` column is also confirmed:
`frontend/apps/reader/readerui.lua` computes `util.partialMD5(file)` on first open and
caches it in the book's sidecar as `partial_md5_checksum`; `plugins/statistics.koplugin/main.lua`
reads that setting into `self.doc_md5` and writes it as `book.md5`.

**Recommendation — confidence: high** (the algorithm is read directly from source and is
purely a function of file bytes; the residual risk is implementation error on our side, not
uncertainty about the spec):

1. **Compute `partialMD5` in the browser during the Phase 0 inventory import.** The device
   is mounted as USB mass storage at that moment, so the EPUB files are reachable in the
   same session as `KoboReader.sqlite`; `content.ContentID` gives each book's
   `file:///mnt/onboard/...` path to match against the picked folder. Read only the twelve
   1 KiB slices via `File.slice()` — no full file is read, so this is milliseconds per book
   regardless of library size. Feed the slices to any streaming MD5 in the order above.
   Both paths then produce the identical key and the unique index does the deduplication
   for free, with no matching heuristic anywhere.
2. **Keep `kobo_content_id` (the file path) as a secondary key**, but as a *tiebreaker and
   audit trail only, never the primary*. It is genuinely stable while the file is not moved
   or renamed, but KOReader itself does not key on it, and any reorganisation of the
   on-device folders breaks it silently. It earns its place because it is the input the
   md5 was computed from, which makes an identity mismatch debuggable.
3. **Ship a manual merge action anyway.** Two facts make duplicates inevitable no matter how
   good the hashing is: replacing a book's file (a re-download, an EPUB→kepub conversion, a
   metadata rewrite by Calibre) changes the bytes and therefore changes the md5; and
   **KOReader's own book table is keyed `UNIQUE (title, authors, md5)`, not by md5 alone**
   (`main.lua`'s `book_title_authors_md5` index), so KOReader itself will hold two rows for
   the same book across a file replacement and will happily sync us both. A "these two are
   the same book" merge — pick a survivor, repoint `reading_page_events.book_id` and
   `book_highlights.book_id`, delete the loser — is required, not optional. The unique key
   makes the repoint safe: duplicate `(page, started_at)` pairs collide and are dropped.
4. **A normalised title+author match is a *suggestion engine for that merge action, never
   an automatic merge*.** Case-fold, strip diacritics and punctuation, strip a leading
   article, and undo Kobo's sort-form titles ("Vegetarian, The" → "the vegetarian") before
   comparing. Surface likely pairs in the Library's Needs-Review view — the `NeedsReviewTab`
   shape the Games feature already uses — and let the owner confirm. Auto-merging on a
   fuzzy title match would silently fuse two volumes of a series; that is worse than a
   visible duplicate.

**What could still invalidate step 1:** nothing in the algorithm, but the claim that the
EPUB files are reachable in the same browser session as the sqlite copy depends on how the
import UI picks files (a directory picker versus a single-file picker). If that turns out
awkward, step 1 degrades gracefully to "no md5 on inventory rows" and steps 3–4 carry the
whole load — which is the situation this finding started from, so it is a fallback, not a
regression.

### 4.3 Aggregation

One pure, import-free module — `readingAggregate.ts` — verified by a throwaway
`scripts/verify-reading-aggregate.cjs` through sucrase, per the no-unit-test-framework
convention. It owns:

- daily minutes from page events, over a bounded date range (never the whole history)
- session reconstruction by clustering page events on a gap threshold
- streak computation against `reading_settings`
- reading speed (pages/hour), and per-book progress

**Do not compute a composite "reading score".** House rule, and the Health feature's
"no derived sleep metrics" precedent.

### 4.4 UI

Route `/#/books` → `BooksPage`, shaped like the Games page since that is explicitly the
model the owner named:

- **Library** — collection grid, cover-forward, filter/sort, the `gameCardKit` anatomy
- **Queue** — reading order, drag-to-reorder (`PlayQueue` precedent)
- **Today / Goal** — daily minutes ring + streak
- **Stats** — time-of-day heatmap, per-book time-to-finish, reading speed
- **Notes** — highlights + the owner's own reviews

Nav placement: the mobile bottom bar's 5 slots are full, so Books goes in the **More sheet
plus the desktop nav row** — the same placement Wishes has. Anything in the More sheet needs
the desktop row too or it is unreachable above `sm:`.

Daily integration: **Books gets a cell on the `TodaySummary` glance board — settled.**

The supporting fact, verified in the code rather than assumed
(`src/features/daily/components/TodaySummary.tsx`, lines 38–44): the board is
`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4` with **six cards**, of which
Nutrition takes `sm:col-span-2` — so **seven grid units today**, which leaves a ragged last
row at every breakpoint above `sm`. A `BooksCard` makes **eight**, and eight divides
exactly into all three column counts: 4 full rows at `sm:2`, a completed final row at
`lg:3` (currently half empty), 2 full rows at `2xl:4`.

So this does not strain the "explicit column counts, no auto-fill, a module never leaves
its slot" rule — **it tidies the grid.** Nutrition keeps its double slot; no existing cell
moves at any breakpoint.

The new cell takes on the same contract as every other one: it uses the shared
`summary/cellKit.tsx` anatomy (Cell / CellHeader icon-chip / CellLink, link-outs in ink and
accent reserved for the primary action), and **an empty state collapses to a compact row IN
PLACE — it never disappears and never leaves its slot.** A day with no reading shows the
cell saying so, not a gap.

`NEVER_HIDES` applies: new reading surfaces only ever ADD rows. No book/reading predicate
goes into any existing task, media or brief query.

### 4.5 Book metadata and covers

- **Covers via `<img src>` directly.** No CORS involved, no proxy, no cost. Open Library's
  own guidance says exactly this.
- **Metadata through an edge function**, not the browser. Open Library and Google Books both
  have long-standing unresolved CORS gaps for `fetch()`, and Hardcover requires a Bearer
  token that must never ship in client code. Precedent: `food-search`, `news-proxy`.
- Default **Open Library** (keyless, ISBN-addressable, page counts, covers); **Hardcover**
  (GraphQL, free token, 60 req/min, max query depth 3) as enrichment if coverage
  disappoints; Google Books third.
- Cache in a shared catalog table with no `user_id`, `SELECT` for `authenticated`, written
  only by the edge function's service role — the `movies` / `steam_apps` shape.

---

## 5. Metric choice — minutes, and why

A "page" on an e-reader is a function of screen size and font size, not the book. Change the
font and the page count changes; it is not comparable across books, devices, or even one's
own settings history. Percent-complete is length-normalised but rewards short books.
**Minutes is the only metric stable across books, devices, font sizes and formats** — and it
is also the number both systems measure worst, which is why the UI must present it as a
floor rather than a measurement.

On streaks: the better of the two existing KOReader streak plugins defaults to "opening a
book counts" with an *optional* low threshold. A high daily minimum converts a streak from a
habit signal into a failure generator. Default low, make it configurable, and never
retroactively re-filter imported history against a threshold set later.

And the failure generator this feature is most likely to build by accident is not a
threshold set too high — it is **a day with no sync being counted as a day with no
reading.** That is the open question in §3's *UNRESOLVED* block, and whatever it resolves
to, the streak rule must distinguish **zero minutes** from **no data**.

---

## 6. Open questions — answer before writing code

1. **N365 or P365?** Not blocking while nothing is flashed, but it must be on record.
2. **Automatic firmware updates — off?** This is the one genuinely urgent item.
3. **Can KOReader's plugin HTTP client do TLS as written?** Gates Phase 1's shape.
4. **Where does KoInsight's plugin read highlight *text* from?** Decides whether highlights
   land in Phase 1 or Phase 3. Partially narrowed while researching incremental sync:
   `upload.lua` gets them from a sibling `annotation_reader.lua`
   (`KoInsightAnnotationReader.getAnnotationsByBook()`), **not** from
   `statistics.sqlite3` — consistent with sidecar-walking. Read that file before promising
   highlights in Phase 1.
5. **Are the EPUB files reachable in the same browser session as the sqlite copy?** Decides
   whether the Phase 0 inventory can compute `partialMD5` itself (§4.2.1 step 1) or falls
   back to manual merging.
6. **Phase ordering versus the goal-and-streak honesty problem** — see the *UNRESOLVED*
   block at the top of §3. Being researched separately; not an item to answer here.

**Answered and closed since the first draft:** whether to track Deichman/OverDrive loans
(no — §2.3), whether `books`/`book_highlights` are AI-writable (yes, `rw` — §4.2), whether
Books gets a glance-board cell (yes — §4.4), and whether the device holds enough
pre-KOReader history to justify Phase 0 (irrelevant — Phase 0 was rescoped, §3).

---

## 6.1 What this plan got wrong in its first draft

Recorded rather than silently edited away, so a future session sees the reasoning and not
just the corrected text.

- **Phase 0's stated rationale was wrong.** The first draft justified the Nickel import
  partly as "it gives a real sample of the owner's own data to design the schema against."
  That argument is void twice over: Nickel's data shape and KOReader's data shape are
  **different**, so it would have been sampling the wrong thing entirely and would have
  biased the schema toward the source we decided not to trust; and the device is new, so
  there is little history to sample in the first place. The phase survives, but only on a
  much narrower and genuinely load-bearing justification — **KOReader writes a book into
  `statistics.sqlite3` only once it has been opened, so Nickel's `content` table is the
  only complete inventory of unopened books.** Scope shrank accordingly: inventory only, no
  statistics.
- **Book identity had a hole big enough to double the library.** The schema keyed on
  KOReader's `md5` with a partial unique index that permits unlimited NULLs, and then
  specified a second ingest path that produces no md5 at all — so the same book arriving
  from both paths would simply become two rows, with nothing anywhere to reconcile them.
  This was not a trade-off that had been weighed; it was a gap. Resolved in §4.2.1, and the
  resolution turned out to be much better than a matching heuristic: the hash is computable
  from the file alone, so both paths can produce the same key.
- **Incremental sync was treated as an optimisation to add later.** The plan named
  KoInsight's plugin as the template without noticing that the template re-uploads the
  entire history on every sync. At this library's reading volume that reaches ~3 MB per tap
  within a year, to deliver ~8.5 KB of new data, from a 1 GHz single-core device. Designing
  the cursor in from the start costs almost nothing; retrofitting it after the plugin is in
  daily use costs a migration of the device's own state. Designed in §3, Phase 1.
- **The headline feature's dependency on sync freshness went unexamined.** A daily minutes
  goal and a streak both need today's data, and Phase 1 delivers data only when the user
  remembers to tap. An unsynced night reads as a zero, not as unknown — so the streak
  breaks on a night that was actually read. The first draft put the automatic trigger in
  Phase 2 "only once the feature proves itself" without noticing that the feature cannot
  prove itself while its headline number is wrong. Still open; see the *UNRESOLVED* block
  in §3.

---

## 7. Sources

Device internals and SSH: `leo3418.github.io/2025/12/26/kobo-clara-bw-ssh.html`.
Schema: `karlicoss/kobuddy` (MIT, actively maintained — the best written specification of
`KoboReader.sqlite` anywhere), `marcus-crane/october` (MIT, Go — source of the book-row and
dog-ear filters), `pettarin/export-kobo` (MIT, frozen ~2017, SQL still correct),
`ogkevin/kobo.koplugin` dev docs.
KOReader: `koreader/koreader` `plugins/statistics.koplugin/main.lua`, the Statistics plugin
wiki, issues #11731 / #13644 (Clara BW detection), PR #11737.
Book identity (§4.2.1), all read from `koreader/koreader` `master` source, not documentation:
`frontend/util.lua` (`util.partialMD5`, the sample offsets and the early-EOF break),
`frontend/apps/reader/readerui.lua` (computes it on first open, caches it in the sidecar as
`partial_md5_checksum`), `plugins/statistics.koplugin/main.lua` (reads that setting into
`doc_md5`, writes it as `book.md5`; also the `book_title_authors_md5` unique index showing
md5 is **not** KOReader's sole book key), and `koreader/koreader-base` `ffi/sha2.lua`
(the `md5` used, lowercase-hex output).
Incremental sync (§3, Phase 1): `plugins/statistics.koplugin/main.lua`
`STATISTICS_DB_PAGE_STAT_DATA_SCHEMA` / `…_INDEX` (the `page_stat_data(start_time)` index,
the `UNIQUE (id_book, page, start_time)` constraint, the `INSERT OR IGNORE`, and the
`DELETE`/DB-merge paths), and `Ko-Insight/KoInsight` `master`
`plugins/koinsight.koplugin/db_reader.lua` + `upload.lua` (the unbounded
`SELECT * FROM page_stat_data`, the per-row md5/device-id repetition, the `#body`
`Content-Length`, and the `ui.statistics:insertDB()` pre-sync flush).
Plugin template: `Ko-Insight/KoInsight` (MIT). Dashboards for prior art: `paviro/KoShelf`,
`VirInvictus/Colophon`, `gildo/talpa`, `timchurchard/kobo-readstat`, `mfdaves/kobo-db-tools`.
Streaks: `advokatb/readingstreak.koplugin`, `fiksr/habitreads.koplugin`.
On-device: `pgaskin/NickelMenu`, `NiLuJe/kfmon`, `shermp/NickelDBus`,
`shermp/Kobo-UNCaGED`, `divx118/KoboCloud`, `koreader/koxtoolchain`.
Cloud API evidence: `janeczku/calibre-web` `cps/kobo.py`, `subdavis/kobo-book-downloader`.
Firmware 5.x: `notmarek/KoboTolinoFindings`, `pgaskin.net/NickelMenu`, MobileRead
"Nickelmenu on 5.x firmware".
Gotchas from practitioners: MobileRead threads on Event/reading stats and Clara BW +
KOReader/NickelMenu; Jordan Chong's Kobo dashboard write-up (ghost time, hex-encoded
fields); Akkana Peck's Kobo sqlite posts (chapter-vs-book rows).
