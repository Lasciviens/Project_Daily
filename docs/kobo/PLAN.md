# Kobo reading tracker — plan

> **Temporary working document.** Same role as `docs/progress-redesign/PLAN.md` had: it
> exists so the plan survives between sessions while the feature is being built and
> critiqued. Once the feature ships and CLAUDE.md carries a "Books Feature Detail"
> section, **delete this file** — CLAUDE.md is the settled record, this is not.
>
> Status: **research complete, nothing built.** Awaiting critique before any code.

---

## 1. The device, as it actually is

Confirmed by the owner, not assumed:

| Fact | Value |
|---|---|
| Model | Kobo Clara BW (2024) |
| Firmware | **4.45.23697**, build `f576aa4ee9` |
| Hardware revision | **Unknown — must be checked (N365 vs P365)** |
| Library composition | **Almost entirely sideloaded EPUB.** No store purchases. Rare free library loans (Deichman, Oslo) |

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
| `OverDriveCards` / `OverDriveLibrary` / `OverDriveCheckoutBook` | library-loan bookkeeping — relevant here because of Deichman |

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

**KOReader as the primary reader; Nickel retained for the rare DRM'd library loan.**

Almost nothing is given up, because there are no store purchases. What is given up is
narrow and real:

- **KOReader cannot open DRM-protected content.** Deichman loans come through Kobo's
  OverDrive integration and are DRM'd, so those books are readable only in Nickel and their
  reading data will only ever be Nickel-quality. The seam is small but it is genuine, and
  the UI must be honest about it rather than silently mixing two definitions of a session.
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

Ordered so that each phase is independently useful and the riskiest work is last.

### Phase 0 — one-time Nickel backfill (optional, cheap, do it first if there is history)

Plug the device in, copy `KoboReader.sqlite`, parse it **in the browser** with `sql.js`
(SQLite compiled to WebAssembly — reads the file client-side, nothing uploaded), write rows
to Supabase. Zero device modification, zero firmware risk.

Value: it is the **only** record of reading done before the switch to KOReader, and — more
importantly for us — it gives a real sample of the owner's own data to design the schema
against instead of guessing.

Its limit must be stated plainly in the UI: `content.TimeSpentReading` is a **lifetime
aggregate per book**, so backfilled history has no day resolution at all. It can seed the
book collection and per-book totals; it cannot seed a daily chart.

**Worth checking before building this:** how much history the device actually holds. The
Clara BW is new; if there is nothing meaningful in it, skip Phase 0 and go straight to
Phase 1 — the sample-data argument is the only other reason to do it.

**Hard-won query details to copy rather than rediscover** (from `october`, `pettarin`,
`kobuddy` — all read directly, all confirmed from source):

- A book row, not a chapter row: `ContentType = '6' AND VolumeIndex = -1`. The `content`
  table holds **one row per chapter plus a master row per book**; getting this wrong
  multiplies book counts by chapter count.
- Sideloaded only: `ContentID LIKE '%file:///%'`.
- Real highlights, excluding dog-ears: `Type != 'dogear'`.
- Highlight join: `Bookmark INNER JOIN content ON Bookmark.VolumeID = content.ContentID` —
  note this joins the *chapter* row, so `content.Title` is the chapter and
  `content.BookTitle` the book.
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

Do not build this until daily use proves it is worth the fragility. Notes for when it
happens:

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
  koreader_md5        -- KOReader's book.md5, the cross-device identity key
  kobo_content_id     -- nullable; set for Nickel/OverDrive-sourced rows
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
  and renames.
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
- `books` and `book_highlights` should be `rw` in `ai-proxy`'s `DB_CATALOG` (dictating a
  review or a to-read note in chat is exactly the intended flow, same reasoning as
  `dev_requests`/`wish_items`); `reading_page_events` is `ro` at most. Requires an
  `ai-proxy` redeploy — add to the Pending manual steps table.

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

Daily integration: a `BooksCard` in `TodaySummary` is the obvious move, but the glance board
currently holds 6 cells plus Nutrition's double slot, under **explicit column counts and no
auto-fill** because the owner requires cells never to move. **Adding a 7th cell is a real
layout decision and is flagged here rather than assumed.**

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

---

## 6. Open questions — answer before writing code

1. **N365 or P365?** Not blocking while nothing is flashed, but it must be on record.
2. **Automatic firmware updates — off?** This is the one genuinely urgent item.
3. **Does the device hold meaningful pre-KOReader history?** Decides whether Phase 0 is
   worth building at all.
4. **Can KOReader's plugin HTTP client do TLS as written?** Gates Phase 1's shape.
5. **Where does KoInsight's plugin read highlight *text* from?** Decides whether highlights
   land in Phase 1 or Phase 3.
6. **A 7th `TodaySummary` cell — acceptable, or should Books stay off the glance board?**
7. **Deichman/OverDrive loans:** track them at Nickel quality alongside KOReader books, or
   leave them out of the tracker entirely and accept a gap? Mixing two definitions of a
   session in one number is the thing to avoid.

---

## 7. Sources

Device internals and SSH: `leo3418.github.io/2025/12/26/kobo-clara-bw-ssh.html`.
Schema: `karlicoss/kobuddy` (MIT, actively maintained — the best written specification of
`KoboReader.sqlite` anywhere), `marcus-crane/october` (MIT, Go — source of the book-row and
dog-ear filters), `pettarin/export-kobo` (MIT, frozen ~2017, SQL still correct),
`ogkevin/kobo.koplugin` dev docs.
KOReader: `koreader/koreader` `plugins/statistics.koplugin/main.lua`, the Statistics plugin
wiki, issues #11731 / #13644 (Clara BW detection), PR #11737.
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
