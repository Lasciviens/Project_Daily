# Kobo integration — plan (reading tracker, book delivery, fun)

> **Temporary working document.** Same role as `docs/progress-redesign/PLAN.md` had: it
> exists so the plan survives between sessions while the feature is being built and
> critiqued. Once the feature ships and CLAUDE.md carries a "Books Feature Detail"
> section, **delete this file** — CLAUDE.md is the settled record, this is not.
>
> Status: **research complete, nothing built.**
> - **Fourth pass (2026-09-29).** Scope widened, at the owner's request, from the reading
>   tracker to three goals: follow the books, **push books from the phone or the laptop**
>   (§8), and **fun extras** (§9). It adds working from the owner's MacBook terminal
>   (§10), one numbered roadmap (§11) and the owner's to-do list (§12).
> - It also corrects the third pass. The firmware cliff was overstated: 5.x is opt-in for
>   Kobo-branded devices and KOReader now runs on it (§1.1). The glance-board facts had gone
>   stale (§4.4). The storage limit was never considered (§4.6). See §7.
> - **Third pass.** The unattended-sync question that blocked the phase ordering is
>   **answered** (§3.0): automatic sync is achievable, it rides `NetworkConnected` plus an
>   on-disk outbox, and it folds into Phase 4 rather than being a later phase.
> - **Second pass.** It folded in the owner's decisions (§2.3 loans, §4.2 AI catalog, §4.4
>   glance board) and four self-critique findings (§7). Two of those were resolved with
>   source-level research (§4.2.1 book identity, §3 Phase 4 incremental sync).
>
> **Every KOReader claim in §2–§5 was verified by reading
> `koreader/koreader` @ `dcf6e3b426ffca0de52e543c725a8000ea64f105`**; the fourth pass read
> `7fedb854` (2026-09-29) and says so where it matters. The `file:line` citations are the
> point of this document — preserve them when editing it.

---

## 0. Start here — the whole thing on one page

**What KOReader is.** A free, open-source reading app (AGPL) that is installed *next to*
Kobo's own reading software ("Nickel"), not instead of it. Kobo's software stays untouched.
You tap a KOReader entry to switch, and exiting KOReader brings Nickel back. We use it
because it keeps a detailed, timestamped reading log (Nickel's is lossy, §2.1) and because
it accepts **plugins** (small add-on programs written in Lua) — so we can teach it to talk
to Lasci's Board.

**The picture:**

```
  iPhone / MacBook ── upload ──▶ Lasci's Board: Books → "Send to Kobo"
                                   │
                                   ▼
                     Supabase: kobo-inbox bucket (temporary, capped, §4.6)
                                   │  OPDS feed (Phase 2: one tap)
                                   │  plugin download (Phase 4: no tap)
                                   ▼
  Kobo Clara BW ── KOReader + our plugin "lascisboard.koplugin"
                                   │  reading minutes, progress, status/rating,
                                   │  later highlights and looked-up words
                                   │  (queued on the device, sent when Wi-Fi is up)
                                   ▼
                     kobo-sync edge function ──▶ books · reading_page_events ·
                                                 book_highlights · …
                                   ▼
          Books page · Daily glance card · Home "Now reading" · AI chat · fun extras
```

**The phases** (full detail, gates and who does what: §11):

| # | Phase | Code? | What you get |
|---|---|---|---|
| 0 | Get the device ready | none (you + Claude on the Mac) | Backup, firmware check, KOReader installed, Wi-Fi bugs tested |
| 1 | Books today, zero code | none | Calibre wireless from the Mac; Instapaper articles; dictionaries |
| 2 | Send to Kobo v1 | small | Upload on the phone or Mac → one tap on the Kobo |
| 3 | Books page + library | medium | Your whole library in the app, covers, queue |
| 4 | Reading tracker | large | Minutes, streak, goal, progress — automatically; Send to Kobo becomes zero-tap |
| 5 | Highlights and words | medium | Highlights, notes and looked-up words in the app |
| 6 | Fun | pick | Two or three items from §9 |

**What you do first:** §12.1. **Decisions only you can make:** §12.3.

---

## 1. The device, as it actually is

Confirmed by the owner, not assumed:

| Fact | Value |
|---|---|
| Model | Kobo Clara BW (2024) |
| Firmware | **4.45.23697**, build `f576aa4ee9` (as reported in the first pass). Kobo's update server now offers 4.45 devices **4.46.23836** (24.08.2026), still the 4.x line (§1.1). **Re-check before Phase 0**, since the device may have updated. |
| Hardware revision | **Unknown — must be checked (N365 vs P365).** The last three characters of `.kobo/version` say which: **`391` = N365** (codename `spaBW`), **`395` = P365** (`spaBWTPV`, made by TPV, larger battery). KOReader reads it the same way (`frontend/device/kobo/device.lua`). A unit bought in Europe after spring 2025 is probably a P365. |
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
  (Clara BW / Clara Colour / Libra Colour). It is real OpenSSH on port 22, but a forced
  command on root means **scp/sftp never negotiate** — pipe commands and files through
  stdin instead (`koinsaari/kobo-netbird`, tested on 4.45.23646). KOReader's own SSH server
  (dropbear, port 2222, SFTP included) is the easier one for copying files (§10).
- 512 MB RAM, 16 GB storage, 6" Carta 1300 at 1448×1072 / 300 ppi, Wi-Fi 2.4 + 5 GHz,
  Bluetooth 5.0, USB-C, no page-turn buttons.
- **MediaTek quirk that matters for sync:** any suspend attempt while plugged in hangs the
  kernel, so KOReader simply does not suspend while charging
  (`frontend/device/kobo/device.lua`).

### 1.1 The firmware cliff — real, but not the automatic cliff the third pass feared

**Revised 2026-09-29** (fourth pass). The third pass wrote that Kobo "ships firmware 5.x to
Clara-class devices", that "a silent overnight update to 5.x would take the feature out
entirely", and that automatic updates had to be turned off first. The evidence now says
otherwise, and the corrected picture is below. Sources are in §13.

**Two firmware lines exist side by side.**
- **4.x** continues: 4.45.23697 (26.05.2026), then **4.46.23836** (24.08.2026).
- **5.x/6.x** is Kobo's Qt6 line, built with Yocto, with a Chromium-based EPUB renderer.
  Updates arrive as `update.tar` rootfs images, not `KoboRoot.tgz`. The newest is
  **6.0.274403** (September 2026), "just a newer 5.x version that got a major version bump".

**For a Kobo-branded Clara BW, 5.x/6.x is opt-in, not automatic.**
- 5.x came as an *accessibility* update. You opt in under Settings → Accessibility → Enable
  ("SYSTEM UPDATE REQUIRED"). It **factory-resets the device** (books, sideloaded files,
  annotations, settings and linked accounts are removed), and it is "only available for
  readers in European Union". Whether that gate includes Norway (EEA, not EU) is
  unconfirmed.
- 6.0.274403 is offered "as an opt-in optional update when people are syncing … It's not
  being installed automatically" (MobileRead, 24.09.2026).
- **Kobo's own update server, queried directly on 29.09.2026:** a Clara BW on 4.45.23697 is
  offered **4.46.23836** — for both N365 (product ID 391) and P365 (395). Only a device
  already on 5.15/5.18 is offered 6.0.
- Some new units now ship with 5.x from the factory. This owner's device is on 4.x, so that
  does not apply.

**Why 5.x/6.x must still be refused:**
- **6.0 has a data-loss bug.** On 5.18.270971 and 6.0.274403, the Libra Colour, Clara BW and
  Clara Colour lose sideloaded books, annotations and reading stats. Kobo's advice: "Don't
  roll back or reinstall an older version … Doing so permanently deletes the missing
  content."
- **NickelMenu does not load on 5.x.** pgaskin's v0.6.0 says "Firmware 5.x is not supported
  yet". An unofficial Qt6 fork (`nicoverbruggen/NickelMenu` `qt6-1.0`, 23.09.2026) exists;
  whether it launches KOReader is unconfirmed.
- **KOReader runs on 5.x now**, but with gaps. 2026.07 merged "Kobo v5 support" (#12401), and
  releases ship a separate `koreader-kobov5-*.zip`. It launches through a v5 KFMon build
  (community recipe, KFMon issue #25). In that build **KOReader's SSH server is
  unsupported**, OTA updates aren't available yet, and USB mass storage misbehaved on
  5.18.264769. So even the worst case is no longer a dead end — just a much worse place to
  develop.
- **Every Nickel schema fact in §2.1 is 4.x knowledge.** KOReader's own files (§2.2) are the
  same on both lines, which is one more reason the tracker measures KOReader only.

**Downgrading, for the record** (never needed while we refuse the opt-in):
- An opt-in device has "Revert to previous version" in Device information. It resets again,
  and it must **not** be used after the 6.0 data-loss bug hits.
- notmarek's universal downgrade package flashes 4.40.23081 and accepts only `spaBW`
  codenames — **never use it on a P365**, which needs ≥ 4.42.23296. pgaskin's firmware
  links are also N365-only.

**So the action is narrower than "turn off updates", which Kobo does not offer anyway**
(there is no settings toggle; updates are found when Nickel syncs):
1. **Never accept a 5.x/6.x prompt**, whether an "accessibility" or "optional" update.
2. **Keep Nickel off Wi-Fi where possible.** While KOReader runs, `koreader.sh` kills Nickel
   and its helpers, so KOReader's own Wi-Fi use cannot trigger a Kobo update check.
3. **A 4.x minor update (4.46) is acceptable.** It stays 4.x, `.adds/koreader` is untouched
   and NickelMenu persists, but KFMon must be reinstalled afterwards. This is one reason to
   prefer the NickelMenu-only install (§10.2).
4. Harder blocks exist and are **not recommended**: kobopatch's "Block WiFi firmware
   upgrade" (it warns of a boot loop on sign-out or factory reset; its patch set stops at
   4.39, so porting is needed) and an `affiliate=RakutenBooks` edit (side effects
   unconfirmed).

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
~5 seconds and reboots. **Install a release ≥ 2025.08.** The current stable is **2026.07.1**
(01.08.2026, `koreader-kobo-v2026.07.1.zip` for 4.x; the v2026.07.2 tag is identical and
exists only to produce a nightly artifact). NiLuJe's one-click package still bundles 2026.03
(which already knows `spaBWTPV`), so update in-app to 2026.07.1 after installing it.

---

## 3. Reading-tracker build plan (roadmap Phases 3 and 4)

**Two roadmap phases (§11), plus a fallback that may never be needed.** (This section
predates book delivery coming into scope; "delivery" here used to mean shipping the
tracker. Getting books *onto* the device is §8.) The riskiest work is last — and the piece
that used to *be* last, automatic unattended sync, turns out to be nearly free and now lives
inside Phase 4.

### 3.0 Unattended sync — **RESOLVED**

The question that used to block the phase ordering: a daily minutes goal and a streak both
need *today's* data, but a sync that only happens on a manual tap turns an unsynced evening
into a **zero** rather than into "unknown" — the streak breaks on a night that was actually
read. A tracker whose headline number is wrong whenever the owner forgets a tap is not a
tracker.

**Answer: unattended sync is achievable — but not on book-close and not on suspend. The
trigger is `NetworkConnected` plus a persistent on-disk outbox, which is exactly the
architecture KOReader's own KOSync plugin already ships.** It needs no NickelMenu, no KFMon,
no shell script and no second binary, so it folds into Phase 4 as a few dozen lines of Lua
plus two stock settings the owner switches on.

#### Why suspend and close cannot carry a network request

- **Wi-Fi is already torn down before any plugin hears `Suspend`.** `Device:onPowerEvent`
  (`frontend/device/generic/device.lua:462-496`) calls `network_manager:disableWifi()`, and
  only *then* does `Device:_beforeSuspend` (`generic/device.lua:1099-1101`) broadcast
  `Event:new("Suspend")`. `Kobo:suspend()` (`kobo/device.lua:1382-1387`) kills it a second
  time, with a source comment naming this exact plan: *"Murder Wi-Fi (again…) if NetworkMgr
  is attempting to connect… (Most likely because of a rerunWhenOnline in a Suspend
  handler)"*.
- **This is hardware, not policy.** `generic/device.lua:481-484` states that suspending with
  Wi-Fi on will *"at best fail, and at worst **deadlock the system**"*. Documented real
  incident: [koreader#12614](https://github.com/koreader/koreader/issues/12614) — automatic
  progress sync on suspend produced an unwakeable device needing a paperclip reset. It was
  fixed by killing Wi-Fi *harder*
  ([PR #12616](https://github.com/koreader/koreader/pull/12616)), not by making the sync
  work.
- **The budget does not fit regardless.** `suspend_wait_timeout = 15` seconds
  (`generic/device.lua:84`) against a connect path that `NetworkMgr:connectivityCheck`
  allows **45 s** (`frontend/ui/network/manager.lua:82-84`).
- **`CloseDocument` fires synchronously** (`frontend/apps/reader/readerui.lua:883`) inside
  `ReaderUI:onClose`, which then immediately tears down the document and the dialog. An
  async callback scheduled from there fires against a dead ReaderUI.
- **KoInsight's "aggressive sync on suspend" must not be copied.** It busy-waits with
  `os.execute("sleep 0.5")` inside `onSuspend` to block the UIManager loop so the scheduled
  suspend cannot run. That is the #12614 hang class, deliberately induced.

#### What does work

KOSync's own answer: `plugins/kosync.koplugin/KOSyncQueue.lua` — an on-disk `Persist` store
(`settings/kosync_queue.lua`, `codec="dump"`), drained on `NetworkConnected`. Its
`_onCloseDocument` (`kosync.koplugin/main.lua:942-965`) sends only if the device is *already*
online and otherwise **queues instead of forcing the radio up**.

Two stock KOReader settings then supply a free, silent network window:

- **`auto_restore_wifi`** — `NetworkListener:onResume`
  (`frontend/ui/network/networklistener.lua:220-228`) runs `restore-wifi-async.sh` (pure
  shell, zero UI) on every wake, then `scheduleConnectivityCheck()`, which broadcasts
  `NetworkConnected`. KOReader's own menu text calls this *"silently"* (`manager.lua:990`).
- **`auto_disable_wifi`** — `networklistener.lua:133-176` polls tx_packets and kills the
  radio after a quiet period (5 → 30 min).

Together: silent Wi-Fi on every wake, an event to hook, and a radio that tears itself back
down. Zero taps, and no battery cost beyond what the owner already pays for
restore-on-resume.

#### The NetworkMgr API, as it actually is

Correcting this document's earlier guesses — all `frontend/ui/network/manager.lua`:

| Call | Line | Behaviour |
|---|---|---|
| `enableWifi(cb, interactive)` | :358 | **Bypasses the user's setting.** Do not use. |
| `beforeWifiAction(cb)` | :605 | **Respects** `wifi_enable_action` |
| `runWhenOnline(cb)` | :698 | Runs now if online, otherwise after a connect |
| `willRerunWhenOnline(cb)` | :727 | Whether a callback is already parked |
| `goOnlineToRun(cb)` | :753 | Blocking; **hard-refuses** unless `wifi_enable_action == "turn_on"` |
| `isOnline()` / `isConnected()` / `isWifiOn()` | :641 / :187 / :182 | Three different questions |
| `afterWifiAction(cb)` | :621 | |

**Rule for our plugin, and the reason for it: never call `enableWifi`, and never bring the
radio up behind the user's setting.** `wifi_enable_action` **defaults to `"prompt"`**
(`manager.lua:1007`) — i.e. a dialog, i.e. a human tap. KOSync treats that setting as the
user's standing consent and **auto-disables itself if it drifts**
(`kosync.koplugin/main.lua:102-105`, `:1066-1073`); we do the same. Note also that even a
non-interactive `enableWifi` is not silent — Kobo's `turnOnWifi` shows a "Scanning for
networks…" InfoMessage (`manager.lua:1116-1119`).

#### Two hard constraints, recorded prominently because they kill the obvious alternatives

1. **`UIManager:scheduleIn` runs on `CLOCK_MONOTONIC`, which does not advance during
   suspend** — `frontend/ui/time.lua:245`, `:300` say so explicitly. A polling timer
   therefore measures *awake* time: "every 30 minutes" becomes "every 30 minutes of
   reading". **A polling loop is not a viable trigger.** Consistent with the ecosystem: no
   shipped plugin does periodic unattended network work, and kosync's own source comment
   says it deliberately does not force the radio up.
2. **On Kobo, KOReader replaces Nickel.** While Nickel is in the foreground, KOReader's
   process does not exist — no plugin, no scheduler, no outbox drain. This also kills
   **NickelDBus as a KOReader-side trigger**: its signals only fire while Nickel runs, which
   is precisely when KOReader does not.

#### RTC wakeup — real, but unproven here

`Device.wakeup_mgr:addTask(secs, cb)` sets a genuine RTC alarm
(`frontend/device/wakeupmgr.lua`, `koreader-base/ffi/rtc.lua:102-140`), giving a silent
~30-second window before `Kobo:suspend()` puts the device back to sleep. **Unconfirmed on
MediaTek MT8113** — no in-tree quirk flag, no report either way, and KOReader's source
carries MTK warnings elsewhere. **Prototype it before designing anything around it, and
never make it the primary trigger.**

#### TLS is not a blocker — this document's earlier caveat was simply wrong

`socket.http` dispatches `https://` to LuaSec transparently: LuaSocket's `http.lua` (pinned
commit `a3bcaed1`) carries a `SCHEMES` table whose `https.create` does
`require("ssl.https")`, and **LuaSec v1.3.2 is bundled**
(`koreader-base/thirdparty/luasec/CMakeLists.txt`). So KoInsight using plain `socket.http`
is **not** evidence against HTTPS, and the "verify before building on it" warning this plan
used to carry was a false alarm rather than a caution to soften.

**What *is* true is narrower: certificate verification is off by default.** A CA bundle
ships (`koreader-base/thirdparty/certifi/` → `data/ca-bundle.crt`) and **nothing wires it
up** — `grep -rn "ca-bundle\|cafile\|cacert"` across the Lua tree returns zero hits, LuaSec
1.3.2 defaults to `verify="none"`, and KOReader's own async client hard-codes
`verify = "none"` (`frontend/httpasync.lua:138-139`). So HTTPS to Supabase **connects and
works, with the server certificate unverified**; verifying it means passing LuaSec params
pointing at that bundle. Whether the file is actually present in the shipped Kobo tarball is
**unconfirmed — a to-verify-on-device item**, not an assumption to build on.

Working request shape, taken from shipped production code doing HTTPS against
`app.wallabag.it` (`plugins/wallabag.koplugin/main.lua:885-920`):

```lua
socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
local code, resp_headers = socket.skip(1, http.request{
    method  = "POST",
    url     = url,
    headers = headers,
    source  = ltn12.source.string(body),
    sink    = ltn12.sink.table(sink),
})
socketutil:reset_timeout()
-- resp_headers == nil means a network error, not an HTTP status
```

SQLite from Lua is `local SQ3 = require("lua-ljsqlite3/init")`.

#### What this resolution costs the design

Nothing structural, but it **relocates the failure mode: sync is now late, never a false
zero.** The minutes are captured in `statistics.sqlite3` and then in the outbox whether or
not a radio ever comes up. Lateness is still fatal to a *naive* streak, so it forces two
server-side rules — the real design consequence of this whole finding. They are stated in
**§4.1** (back-dated records, idempotency, `last_seen`) and **§5** (retroactive streaks,
"0 minutes" ≠ "no data") and are not optional polish.

### 3.0.1 Write our own plugin, or reuse BookOrbit's? — **DECIDED 30.09.2026: A, our own (§12.4)**

A prior draft assumed we would write our own plugin. That assumption went unexamined, and
it is the largest remaining decision in this document, so it is recorded as open rather
than silently settled.

**BookOrbit** (`github.com/bookorbit/bookorbit`, ~4.5k stars, actively developed) is a
self-hosted reading platform whose monorepo contains **both** a Kobo store-API emulator
**and** `koreader-plugin/bookorbit.koplugin/` — 37 Lua modules, ~19k lines, plus ~12k lines
of Busted specs. It already implements, in shipped and tested code, the exact architecture
§3.0 arrives at independently. Every claim below was verified by reading its source.

**What it confirms about our design** (independent corroboration, arrived at from KOSync):

- `_onCloseDocument` (`main.lua:1172`) and `_onSuspend` (`:1217`) capture and persist; they
  do not depend on the network. Bound only when `auto_sync` is on, which **defaults off**.
- A real on-disk outbox, `bookorbit_lifecycle_outbox.lua` (535 lines), whose header states
  the same conclusion in its own words: *"Close and suspend handlers must not run network
  I/O, so they capture a snapshot and persist it here instead."*
- Offline it queues **without touching the radio**: close/suspend call the drain
  non-interactively, so `if NetworkMgr:isConnected() then submit() … else return false`.
  There is no `NetworkMgr:enableWifi` call anywhere in the plugin.
- Drained on `NetworkConnected` (`:1230`), book open (`:897`), startup (`:189`), plus
  close, suspend, manual and a self-chaining `"recovery"` pass — one entry per invocation,
  re-chaining on success, so a backlog clears a book at a time rather than in a burst.
- HTTPS works through `socket.http` + `ltn12` + `socketutil`, with **no TLS options set at
  all** — confirming §3.0's finding that certificates go unverified by default.

**Three corrections to how this project is usually described:**

1. **The every-N-pages push carries no statistics.** `pages_before_update` (default 10,
   10-second re-arming debounce, `bookorbit_progress_sync.lua:361`) sends progress only —
   `{document, percentage, progress, device, device_id, timestamp}`. Reading-time data
   moves on close/suspend/manual and nowhere else.
2. **The outbox has no eviction and no expiry.** At the hard limit (1000 entries / 200 MiB)
   `enqueue` **refuses the new entry** rather than dropping an old one. After
   `MAX_ATTEMPTS = 5` an entry is *parked*, not deleted — skipped by automatic drains so it
   cannot head-of-line-block, and only a manual sync retries it.
3. **The licence is stricter than "AGPL".** `AGPL-3.0-only` **plus `ADDITIONAL_TERMS.md`**
   (§7(b)-(e), effective 10 Sep 2026) requiring a prominent, non-removable "Powered by
   BookOrbit" notice in every interactive UI of a covered work. Those terms travel with any
   reused code and cannot be stripped.

#### The three options

- **A — write our own minimal plugin.** Full control of the wire contract and our own pace.
  Cost: we reimplement the queue, backoff, phase-level acks and subprocess-forking that
  BookOrbit already has tested, and we will get some of it wrong first.
- **B — run BookOrbit's plugin unmodified and implement its server contract in
  `kobo-sync`.** No plugin for us to maintain, mature code on the device. We hold no
  BookOrbit code, so its §7 attribution term does not reach our app. Cost: we track their
  API, and a change upstream is our problem.
- **C — run BookOrbit itself and read from its API.** A second server to operate. Heavy for
  one reader.
- **D — run KoInsight's plugin unmodified and implement its two endpoints** (added in the
  fourth pass). The endpoints are `POST /api/plugin/device` and `POST /api/plugin/import`;
  the payload is in §3 Phase 4. Zero Lua from us, and statistics would flow within days. It
  was rejected as a long-term path for three reasons already on record: it re-sends the
  entire history on every sync (§3, the 3 MB-a-day table); it has **no auth header at all**,
  so the secret would have to live in the URL path; and its only automatic trigger is the
  busy-waiting "sync on suspend" that §3.0 refuses. At most it is a throwaway bootstrap.

**Not chosen here — it is the owner's call.** Option B looks strong on effort alone, but A's
control over the contract is worth more than it first appears given every other ingest path
in this repo is ours end to end.

**New evidence from the fourth pass, which tilts it towards A.** Three of the owner's new
goals need device-side behaviour that neither BookOrbit's nor KoInsight's plugin has:
- zero-tap Send to Kobo (download the inbox on `NetworkConnected`, §8.2 step 2);
- the "Today" sleep screen (§9.2);
- vocabulary sync (§9.3).

So under B or D **we would still write and maintain a plugin**, just a second one next to
theirs. Under A it is one plugin, one wire contract and one device secret. **Recommendation:
A**, taking B's contract details (below) as the checklist of things to get right.

#### If B — the contract, read out of their source

Worth recording either way, because these are the decisions a stats sync has to get right
and they are cheap to copy and expensive to rediscover:

- **Every request carries `deviceTime`**, and the source says why: *"KOReader datetimes are
  local wall clock with no timezone; the server needs our clock to mint device datetimes
  that are not in our future."* This repo has paid for that lesson twice already
  (`phone-gateway`'s `import_body_composition`, `esde-sync`).
- **The stats event is KOReader's `page_stat_data` row unchanged** —
  `{page, startTime, durationSeconds, totalPages}`, grouped under a book `hash`. Do not
  invent a different shape.
- **Sessions are derived server-side**, not sent: a gap **> 1800 s** splits a session,
  clusters **< 10 s** are discarded, and
  `duration = min(Σ event durations, endEpoch − firstStart)` — so idle gaps inside a cluster
  are excluded while wall clock still caps the total.
- **Idempotency is a derived key, never a client id:**
  `kor:${deviceId.slice(0,8)}:${bookFileId}:${clusterStartEpoch}`, upserted on
  `(userId, sessionId)`. A client-generated UUID would not survive re-clustering when a late
  batch extends a session; they additionally scan backwards and delete/reinsert overlapping
  sessions when a late batch merges two clusters.
- **Responses carry `unmatched: string[]`** so the device learns which hashes the server
  does not know, without holding a library list itself.
- Server-side validation worth mirroring: `page ≥ 0`, `startTime ≥ 1`,
  `0 ≤ durationSeconds ≤ 86400`, `totalPages ≥ 1`, hash matched against an MD5 hex regex,
  ≤50 books per request. The plugin caps its own body at 900 KiB and batches 500 events.
- `deviceId` is load-bearing for dedup, not decoration — their README warns that a cloned
  device with a *different* `device_id` double-counts reading time.

#### Licensing, factually

KOReader itself is **AGPL-3.0** (`COPYING`); in discussion #11652 a maintainer reads it as
or-later, but the project has never formally declared it. **Whether a `.koplugin` is a
derivative work is genuinely unresolved** — no KOReader policy, no CONTRIBUTING statement,
no case law — and community practice is visibly split: `koreader/contrib` and
`readingstreak.koplugin` are AGPL-3.0, `kobo.koplugin` is GPL-3.0, and **KoInsight, the
closest analogue to what we would build, is MIT**.

What matters practically: **`kobo-sync` is not affected either way.** AGPL §13 obliges
offering source to users interacting with *the covered work* over a network; our edge
function is separate software containing no AGPL code, and the person running the plugin is
the person holding it. Publishing our plugin in a public repo incurs nothing extra either —
publishing source is how AGPL obligations are *satisfied*, not how they are triggered.

If we take option A, licensing the plugin **AGPL-3.0-or-later** — matching KOReader itself
and `koreader/contrib` — sidesteps the derivative-work question rather than betting on an
answer, at no cost to us.

### Phase 3 — one-time library-inventory import (small, cheap, browser-only)

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
comes from Phase 4.

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

### Phase 4 — KOReader + our own plugin → `kobo-sync` edge function (the real feature)

A KOReader plugin reads `statistics.sqlite3`, writes what it finds into an on-disk outbox,
and drains that outbox to a Supabase edge function over HTTPS whenever KOReader sees the
network come up. A manual "Sync now" menu action exists as well, but it is the escape hatch,
not the mechanism — **automatic sync is part of this phase**, on the evidence in §3.0.

**There is a working MIT-licensed template: KoInsight's `koinsight.koplugin`.** Its source
was read, so this contract is confirmed rather than inferred:

- `db_reader.lua` opens `DataStorage:getSettingsDir() .. "/statistics.sqlite3"` and runs
  `SELECT * FROM book`, `SELECT * FROM page_stat_data`, `SELECT md5 FROM book WHERE title = ?`
- `upload.lua` POSTs JSON with an explicit `Content-Length`; payload shape
  `{stats, books, annotations, device_id, version}`
- `call_api.lua` uses `socket.http.request()` with `ltn12` sink/source and
  `socketutil:set_timeout(LARGE_BLOCK_TIMEOUT, LARGE_TOTAL_TIMEOUT)`
- `main.lua` pulls in `ui/network/manager`, i.e. it can bring Wi-Fi up itself — **and this
  is one of the two things not to copy** (the other is the unbounded history upload below).
  Our plugin queues and waits for `NetworkConnected`; it never forces the radio up behind
  `wifi_enable_action`. See §3.0.

**On HTTPS — settled, and not a risk (§3.0).** An earlier draft of this section flagged
KoInsight's plain `socket.http` usage and its `http://server-ip:3000` documentation as
evidence that TLS might be a blocker. It is not: `socket.http` dispatches `https://` to
LuaSec transparently and LuaSec v1.3.2 is bundled. No `curl` fallback is needed and none
should be designed in. The only residual item is that **certificate verification defaults to
off** and wiring the shipped CA bundle up is unverified on-device — see §3.0. Use the
`wallabag.koplugin` request shape quoted there.

#### The plugin's trigger design

Concretely, from §3.0:

1. **`onCloseDocument` and `onSuspend`: write to the outbox, never send.** Defer the
   `statistics.sqlite3` read to `UIManager:nextTick` so the statistics plugin's own flush
   lands first — its flush points are `onCloseDocument`
   (`plugins/statistics.koplugin/main.lua:2672`), `onSuspend` (`:2694`) and `onSaveSettings`
   (`:2689`, default every **15 min**), and `broadcastEvent` walks the window stack top-down,
   so the ordering is not otherwise guaranteed.
2. **`onNetworkConnected`: drain the outbox**, oldest entry first, over HTTPS, deleting an
   entry **only on a confirmed 2xx**.
3. **`onReaderReady` / `Start`: opportunistic drain** if `NetworkMgr:isOnline()` already.
4. **Recommend — never force — `auto_restore_wifi` and `auto_disable_wifi`** to the owner.
   They are what turn (2) from a hook into an actual unattended sync. In the setup list
   below.
5. **Optional, off by default:** if `wifi_enable_action == "turn_on"`, also
   `runWhenOnline(drain)` on `CloseDocument`. Never when the setting says otherwise — see
   §3.0's rule.

This composes with the incremental-sync cursor below rather than replacing it: **the outbox
decides what to send, the cursor decides what to read.** The cursor may only advance on a
2xx, so an entry still sitting unsent in the outbox can never let the cursor move past its
rows.

One already-confirmed detail that makes a mid-session drain worth doing: KoInsight's
`db_reader.lua` calls `ui.statistics:insertDB()` before reading, flushing the currently-open
book's in-memory page stats into `statistics.sqlite3` first — so a sync fired mid-session
captures the session so far, not just the last closed book.

**Device setup, one-time, all inside KOReader's own menus** (add these to the runbook when
one is written):

- install KOReader **≥ 2025.08** (§2.3)
- turn on **`auto_restore_wifi`** — "automatically restore Wi-Fi connection after resume"
- turn on **`auto_disable_wifi`** — "disable Wi-Fi connection when inactive"
- leave `wifi_enable_action` wherever the owner wants it; the plugin respects it either way
  and must never work around it
- install the plugin and paste the device secret

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
separate, larger piece of work and highlights should move to Phase 5.

### The Nickel-side fallback (only if needed) — an on-device trigger outside KOReader

**This is no longer the automation path, and it is no longer a planned phase.** §3.0 moved
automatic sync into Phase 4, where it costs a few dozen lines of Lua and two stock settings
instead of a Nickel mod, a shell script and a second HTTPS binary. This section survives
only as the answer to a scenario that may never arise: KOReader's own `NetworkConnected`
window turning out to be too rare in this owner's actual routine (reads with Wi-Fi
permanently off, never resumes with it restored), or a firmware change breaking the plugin
path entirely.

If that day comes, it means a **NickelMenu** entry (`cmd_spawn` runs an arbitrary shell
command) or **KFMon** (opening a dummy "book" launches an action), plus a shell script and a
working HTTPS client. Notes for then:

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
- **KoboCloud's real mechanism is now confirmed, and its choices are the useful part:** udev
  rules on `KERNEL=="wlan*", ACTION=="add"` (`src/etc/udev/rules.d/97-kobocloud.rules`),
  firing whenever the Wi-Fi module is inserted. Notable corollary: it ships **its own ARM
  `curl` and its own CA bundle** — strong evidence that stock Kobo firmware has no
  TLS-capable HTTP client at all, which is exactly the cost this fallback carries and Phase
  4 does not.
- `NickelDBus` is **ruled out as a KOReader-side trigger** (§3.0 constraint 2): its signals
  only fire while Nickel is running, which is precisely when KOReader's process does not
  exist. It remains usable only *within* this Nickel-side fallback, where its documented
  `pfmDoneProcessing` signal (content import finished) would be a natural "sync now" hook.
  Whether it exposes Wi-Fi state is **unconfirmed**; check with `qndb` on-device.

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
- **A polling timer inside the plugin.** `UIManager:scheduleIn` runs on `CLOCK_MONOTONIC`,
  which does not advance during suspend (§3.0) — "every 30 minutes" silently means "every 30
  minutes of reading". Not a trigger.
- **`crond`.** Frozen during suspend-to-RAM, no catch-up semantics for the minutes it missed,
  and not running on stock firmware in the first place. Dead end.
- **KFMon as a scheduler.** It is a *launcher* — inotify on a file being opened. No timer, no
  boot trigger, no network trigger. It can only appear in the Nickel-side fallback, and only as
  the thing a human tap starts.
- **Sync on suspend or on book-close.** Both are structurally impossible and one of them is
  dangerous; full evidence in §3.0, including the real device-hang incident it caused
  upstream.
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
  brings the count in CLAUDE.md's list from ten to eleven (it was nine when this section was
  first written; `screenscraper-media` joined since).
- **One device door, two route families** (fourth pass). The same function also serves the
  read-only Send-to-Kobo feed (§8.2): `…/kobo-sync/opds/<token>/…`. The feed is authorised by
  its **own** path token, `KOBO_OPDS_TOKEN`, separate from `KOBO_SYNC_SECRET`. A feed URL
  is easy to leak (it sits in KOReader's catalogue list and in logs), and it can only list
  and download inbox files. The write routes (`/sync`, `/deliveries/<id>/ack`) require the
  `x-kobo-secret` header. Rotating either secret leaves the other working, and one function
  means one Dashboard deploy and one JWT toggle.
- Self-contained, no `_shared` imports, per this repo's deploy convention
- Batched (`esde-sync` caps at 150; size the cap once real payload sizes are measured),
  every batch independent and idempotent so a retry or a full re-push is always safe

**Three rules that §3.0 forces on this function.** Sync is *late*, not absent — which
removes the false-zero problem but not the lateness, and lateness reaches the server as
back-dated and repeated data:

- **Back-dated rows are normal input, never an exception.** A batch arriving on Wednesday
  routinely carries Monday's and Tuesday's pages, because that is how an outbox drained on
  `NetworkConnected` behaves. The function stores each row at its own `started_at` and must
  **never** clamp, re-stamp or reject a row for being older than the request. Nothing
  downstream may treat "received today" as "read today" — and the streak is computed
  retroactively for exactly this reason (§5).
- **Idempotent on re-sends and on overlapping days.** Three separate mechanisms re-send rows
  the server already holds: the cursor's deliberate lookback window, the "Full re-sync"
  action, and any outbox entry retried after an unconfirmed response. Insert through
  `UNIQUE (user_id, book_id, page, started_at)` with **ignore-on-conflict, never an
  update** — a re-send must not be able to change a stored duration, and a
  partially-applied batch must be safe to replay whole. The response should report how many
  rows were genuinely new, so a drain that did nothing is visible rather than looking like
  a successful sync.
- **Every request carries a `last_seen`** (the device's own clock at send time), stamped
  onto `reading_settings` (or this function's own small state row). This is what lets the UI
  say *"not heard from the device since ‹timestamp›"* instead of rendering a silent zero —
  see §5. It is the one piece of state the sync exists to carry that is not a page event.

Phase 3's browser import writes through the normal authenticated client, not this function.

### 4.2 Schema

**Point-in-time grain, aggregate at query time.** This repo already learned this lesson the
expensive way: `health_metrics` originally stored one row per metric per day and silently
overwrote every point but the last (migration 041 fixed it). The same shape applies here, so
store the page events and aggregate on read — do not store daily totals.

```
books
  id, user_id
  koreader_md5        -- KOReader's partial-file md5 (§4.2.1) — computable from the file alone,
                      --   so the Phase 3 inventory import computes it too
  kobo_content_id     -- nullable; the Nickel `content.ContentID`, i.e. the file:/// path.
                      --   Justified by the Phase 3 inventory import (re-import matching,
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

book_highlights                -- Phase 5; shape revised in the fourth pass to match KOReader's
  id, user_id, book_id         --   real `annotations` array (§4.2.2), not Nickel's Bookmark table
  text, note, chapter, drawer, color, pageno
  pos0, pos1                   -- EPUB xpointers; kept so a highlight can be re-found
  highlighted_at, updated_at   -- from `datetime` / `datetime_updated` (local wall clock, no TZ — §4.2.2)
  deleted_at                   -- soft delete when a book's array no longer contains it
  source, external_ref         -- external_ref = hash(datetime | pos0 | pos1): KOReader's own match key
  UNIQUE (user_id, source, external_ref)

book_deliveries                -- Phase 2, Send to Kobo (§8.2)
  id, user_id, storage_path, filename, mime, size_bytes, title, author
  status                       -- queued | downloaded | expired | cancelled
  created_at, downloaded_at, device_id

book_words                     -- Phase 5, KOReader Vocabulary Builder rows (§9.3)
  id, user_id, word, book_title
  prev_context, next_context, highlight, looked_up_at
  meaning_tr, definition_nb    -- filled by the app (Gemini / Ordbok API), cached
  UNIQUE (user_id, word)       -- KOReader's own key is `word` (PRIMARY KEY)

reading_settings           -- singleton, PK is user_id (athlete_profile / day_targets precedent)
  daily_minutes_goal, streak_min_minutes, last_seen, ...
```

Also on `books`, from the book's sidecar (§4.2.2), one-way device → app in Phase 4:
- `summary.status`: `reading` → `reading`, `complete` → `finished`, `abandoned` → `dropped`.
- `summary.rating`: 1–5 stars → our 1–10 by ×2.
- `percent_finished` → a cached `progress_pct`.

A status the owner changes in the app does not flow back to the device in Phase 4. A later
two-way sync would need `summary.modified` as the last-writer-wins clock.

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
permits unlimited NULL rows, so a book landing first via the Phase 3 inventory (no md5) and
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

1. **Compute `partialMD5` in the browser during the Phase 3 inventory import.** The device
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

### 4.2.2 Where highlights, notes and book status actually live (fourth pass, read from source)

Answers the old open question 4 ("where does highlight *text* come from?"). Read at
`koreader/koreader@7fedb854`:

- **The book's sidecar**, `metadata.<ext>.lua`. It is a Lua table literal, not JSON. By
  default (`document_metadata_folder = "doc"`) it sits in `<book path minus extension>.sdr/`
  next to the book. The `dir` and `hash` settings move it under `<koreader>/docsettings/` or
  `<koreader>/hashdocsettings/<md5[1..2]>/<md5>.sdr` (`frontend/docsettings.lua:118-146`).
  `DocSettings:findSidecarFile()` checks every location.
- **The `annotations` array** (since v2024.07, PR #11563) is sorted by position. Fields
  (`frontend/apps/reader/modules/readerannotation.lua:66-83`):
  - `datetime` (creation, `"YYYY-MM-DD HH:MM:SS"` **local time with no timezone** — the same
    lesson as `deviceTime` in §3.0.1) and `datetime_updated`.
  - `drawer` (`lighten`/`underscore`/`strikeout`/`invert`; **no `drawer` means a page
    bookmark**, not a highlight) and `color` (a name).
  - `text` (+ `text_edited`), `note`, `note_format` (nil/`html`/`md`, v2026.07), `chapter`,
    `pageno` (changes with font/layout), `pageref`.
  - `page`/`pos0`/`pos1`: xpointers for EPUB, tables for PDF.
  - KOReader matches an annotation to itself by `datetime` + `pos0`/`pos1`
    (`readerannotation.lua:454-477`), so that is our `external_ref`.
- **Legacy books** may still carry `highlight`/`bookmarks` tables. There the names are
  swapped: `bm.notes` held the highlighted text and `bm.text` the user's note
  (`migrateToAnnotations`, `readerannotation.lua:159-236`). Read `annotations` and fall back
  to the legacy tables only when it is absent, as the exporter does (`clip.lua:363-386`).
- **Other sidecar keys worth taking:** `partial_md5_checksum` (the same id as
  `statistics.sqlite3`'s `book.md5`, §4.2.1), `doc_props` (title, authors, series,
  language), `percent_finished`, and `summary = {status, modified, rating, note}`.
- **How to collect them without walking the whole disk:** capture the closing book's array
  in `onCloseDocument` into the same outbox as its page events (no network needed). A manual
  "Full re-sync" walks `ReadHistory` with `DocSettings:findSidecarFile` +
  `DocSettings.openSettingsFile` (read-only) — the same approach KoInsight's
  `annotation_reader.lua` uses. **Always send a book's array even when it is empty**:
  KoInsight's server never learns that a book's *last* annotation was deleted, because an
  empty array is never sent (its own FIXME, `upload-service.ts:155-200`).
- **Existing export paths we are not using, and why:**
  - The Exporter plugin can register a third-party target
    (`Provider:register("exporter", …)`, `plugins/exporter.koplugin/main.lua:118-133`).
    Its only built-in target that takes a configurable HTTPS URL is Nextcloud Notes
    (Markdown bodies to parse).
  - The contrib MyBibliotheca exporter posts structured JSON with kosync-style auth, but
    only manually and only for the current book.
  - KOReader 2026.07's "Cloud storage+" syncs the whole `statistics.sqlite3` and vocabulary
    database over WebDAV/FTP/Dropbox. It is manual too, needs PROPFIND (unconfirmed on
    Supabase), and parsing SQLite would not fit a function's 2 s CPU budget.
  - Our own plugin reading the sidecar directly beats all of these.

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

- **Library** — collection grid, cover-forward, filter/sort, the Games page card anatomy (`test-game/components/TgGameCard.tsx`)
- **Queue** — reading order, drag-to-reorder (the Games page queue precedent: `test-game/components/TgQueueViewDrag.ts`)
- **Today / Goal** — daily minutes ring + streak
- **Stats** — time-of-day heatmap, per-book time-to-finish, reading speed
- **Notes** — highlights + the owner's own reviews
- **Send to Kobo** — upload, the inbox with each file's status, cancel (§8.2). It is the
  first tab to ship (roadmap Phase 2), so the page exists before the library does.

Nav placement: the mobile bottom bar's 5 slots are full, so Books goes in the **More sheet
plus the desktop nav row** — the same placement Wishes has. Anything in the More sheet needs
the desktop row too or it is unreachable above `sm:`.

Daily integration: **Books gets a cell on the `TodaySummary` glance board — settled.**

The supporting fact, **re-verified 2026-09-29** against the current code
(`src/features/daily/components/TodaySummary.tsx`, lines 38–44). The board changed after the
first pass. It now sizes by its **own** width, not the viewport:
`grid-cols-1 @[36rem]:grid-cols-2 @[55rem]:grid-cols-3 @[90rem]:grid-cols-4`, with **six
cards**. Nutrition is `@[36rem]:col-span-2 @[55rem]:row-span-2 @[90rem]:row-span-3`. So
today's grids are:

| Columns | Today (6 cards) | With a Books cell (7) | With Books + Nutrition `row-span-3` at 3 columns |
|---|---|---|---|
| 1 | 6 stacked | 7 stacked | same |
| 2 | `N N / T W / H G / S ·` — one hole | `N N / T W / H G / S B` — **full** | same |
| 3 | `N N T / N N W / H G S` — full | `… / B · ·` — **a lone Books cell on a 4th row** | `N N T / N N W / N N H / G S B` — **full** |
| 4 | `N N T W / N N H G / N N S ·` — one hole | `N N T W / N N H G / N N S B` — **full** | same |

(N Nutrition, T Training, W Watch next, H Health, G Games, S Shop, B Books.)

So a Books cell **fills the existing holes at 2 and 4 columns**, and at 3 columns it needs
Nutrition to span three rows (as it already does at 4 columns) to avoid a ragged row. That
is one class change on an existing cell (`@[55rem]:row-span-3`), and at that one step it
moves Health, Games and Shop once (H to row 3 column 3, G and S to row 4). It is a
deliberate layout decision, declared per column step and not content-driven, so it stays
inside the "explicit column counts, no auto-fill, a module never leaves its slot" rule. The
glance-board E2E check (cell x/w identical between a full and an empty day) must be
re-run after the change. The first pass's argument ("eight grid units divide exactly")
described the old `sm:/lg:/2xl:` grid and no longer applies.

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
- Source order (revised in the fourth pass):
  1. **Nasjonalbiblioteket** (`api.nb.no/catalog/v1/items?q=isbn:…`, no auth) for Norwegian
     ISBNs. Open Library's Norwegian data is poor; in the researcher's test *Snømannen* came
     back as "Snomannen [Imported]" with no cover, while NB returned the correct title,
     publisher, pages, series, language and a cover thumbnail. Its licence is unconfirmed —
     check before caching covers.
  2. **Open Library** (keyless, ISBN-addressable, page counts, covers; send a `User-Agent`
     with contact; 1 req/s anonymous; cover-by-ISBN is limited to 100 per IP per 5 min, so
     cache the cover id, not the ISBN URL).
  3. **Hardcover** (GraphQL, personal token, free plan 5,000/day and 60/min) as enrichment.
  4. Google Books last: it needs a key, and the keyless shared pool already returns 429.
- Cache in a shared catalog table with no `user_id`, `SELECT` for `authenticated`, written
  only by the edge function's service role — the `movies` / `steam_apps` shape.

### 4.6 Storage budget — the Kobo is the library, Supabase is only the post office

Added 2026-09-29, when book delivery (§8) came into scope. It is a hard constraint, not a
preference:

- The project is on the **Free plan: 1 GB of file storage in total, 50 MB per uploaded
  file, 5 GB egress a month** ([Supabase storage limits](https://supabase.com/docs/guides/storage/uploads/file-limits)).
  Over 1 GB the whole project goes read-only and then answers with 402 (CLAUDE.md, Scrape
  page section).
- The `game-media` bucket already holds ~537 MB of ES-DE originals plus ScreenScraper
  copies, and the ScreenScraper budget defaults to 800 MB (hard cap 950 MB).
- **Every existing guard measures `game-media` only.** `game_media_usage()` filters
  `WHERE o.bucket_id = 'game-media'` (`supabase/migrations/104_screenscraper_v2.sql:151`),
  and the three uploaders (`screenscraper-sync`, `esde-media-sync`, `esde-content-sync`)
  compare against that figure. A new books bucket would be **invisible to them**, so both
  could each stay "under budget" while the project as a whole crosses 1 GB.

So:

1. **Books never live in Supabase.** The device (and Calibre on the Mac) holds the library.
   A file sits in Storage only between upload and the device downloading it. It is deleted
   once the device confirms, or after 7 days undelivered, whichever comes first.
2. **The inbox is capped**: ≤ 50 MB per file (the Free plan's own per-file limit anyway)
   and ≤ 150 MB in total. Anything larger (comics, big PDFs) goes over USB or Calibre wireless instead.
3. **One project-wide usage figure, shipped in the same change as the bucket.** The
   migration that adds the books bucket also adds a `storage_usage_total()` (all buckets).
   Every uploader, including the three existing ones, then checks *project total + this
   upload ≤ 950 MB*, not its own bucket alone. The per-bucket guards cannot simply be kept:
   950 MB (the game-media ceiling) + 150 MB (the inbox cap) = 1.1 GB, which is past the
   1 GB wall. If the project-wide check has to wait, the game-media ceiling must drop to
   850 MB in the same release.
4. Egress is not a concern: a few MB per book, a few books a week.

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
reading.** §3.0 makes sync *late* rather than absent, which removes the false zero at the
source but not the lateness. Two rules follow, and neither is optional polish:

1. **The streak is computed retroactively, at read time, from whatever rows exist now** —
   never incrementally, and never stored as a counter that a missing day decrements.
   **"No row for yesterday" must never mean "streak broken."** Only a **synced** day with
   genuinely zero minutes breaks it. A batch landing on Wednesday carrying Monday's pages
   then repairs Monday in place and the streak is simply correct again, with no special-case
   repair code anywhere — because nothing was ever written down as broken. This is also
   what makes §4.1's back-dated-records rule load-bearing rather than pedantic.
2. **The UI distinguishes "0 minutes" from "not heard from the device since
   ‹timestamp›"**, backed by the `last_seen` in §4.1. A day *after* the last `last_seen` is
   **unknown** and renders as such; a day *before* it with no rows is a real zero. A streak
   that silently resets because a radio did not come up is worse than having no streak.

---

## 6. Open questions — answer before writing code

0. **Write our own plugin, or reuse BookOrbit's or KoInsight's? (§3.0.1)** The largest
   open decision in this document, and the owner's to make (§12.3). It changes what Phase 4
   even is: option A is a plugin we write and maintain, B and D are someone else's wire
   contract. The fourth pass adds a recommendation (A) with its reason, but still does not
   decide.
1. **N365 or P365?** Now answerable in seconds: the last three characters of
   `.kobo/version` are `391` or `395` (§1). Still not blocking while nothing is flashed, but
   the downgrade package must never meet a P365 (§1.1).
2. **~~Automatic firmware updates — off?~~ Reframed (§1.1).** There is no toggle to turn off,
   and 5.x/6.x is opt-in for this device. The rule is "never accept a 5.x/6.x prompt; a 4.x
   minor update is fine". The urgent part is only the owner knowing that rule.
3. **~~Can KOReader's plugin HTTP client do TLS as written?~~ Answered — yes (§3.0).** What
   is left is much narrower and gates nothing: **is `data/ca-bundle.crt` actually present in
   the shipped Kobo tarball?** HTTPS works either way; this only decides whether the server
   certificate can be verified rather than trusted blindly. Check on device.
4. **~~Where does KoInsight's plugin read highlight *text* from?~~ Answered (§4.2.2).** From
   each book's sidecar `annotations` array, found with `DocSettings:findSidecarFile()`: the
   open book on suspend, and every `ReadHistory` book on a manual sync. Our design captures
   the closing book's array in `onCloseDocument` (no network), with a history walk on *Full
   re-sync*. Highlights are Phase 5 because of the server tables and UI they need, not
   because ingest is hard.
5. **Are the EPUB files reachable in the same browser session as the sqlite copy?** Decides
   whether the Phase 3 inventory can compute `partialMD5` itself (§4.2.1 step 1) or falls
   back to manual merging.
6. **How often does `NetworkConnected` actually fire in this owner's routine?** Not
   blocking, and not answerable in advance — it decides only whether the Nickel-side
   fallback ever needs to exist. Measure it in daily use.
7. **Does RTC wakeup work on MediaTek MT8113?** (§3.0.) Only worth answering if (6) turns
   out badly, or if the sleep-screen card (§9.2) should refresh itself. Prototype before
   designing around it.
8. **Do KOReader's open Wi-Fi reboot bugs hit this device?** #13197 (reboot when Wi-Fi is
   switched on in KOReader) and #16046 (reboot when KOReader restarts while Wi-Fi is stuck).
   **Blocking for everything networked** — the tracker's sync, Send to Kobo and the
   sleep-screen card. Tested in Phase 0 (§11).
9. **Which install path works on a Clara BW on 4.45/4.46?** NickelMenu-only (preferred) or
   the one-click package (§10.4). Reports are mixed and none covers this exact device.
   Answered in Phase 0.
10. **May Nasjonalbiblioteket's catalogue covers be cached?** Its API licence is
    unconfirmed (§4.5, §9.5). Until it is known, link covers, don't copy them.
11. **Is Norway inside Kobo's "EU only" gate for the 5.x accessibility update?** Only
    matters if the owner ever wants accessibility features. The answer to "should we opt
    in" is no either way (§1.1).

**Deliberately NOT answered here:** question 0. A prior pass in this document slid from
"find the answer" into "pick the answer" on a question that was the owner's. §3.0.1 lays
out A/B/C/D with the evidence and a recommendation, and stops there.

**Answered and closed since the first draft:** whether to track Deichman/OverDrive loans
(no — §2.3), whether `books`/`book_highlights` are AI-writable (yes, `rw` — §4.2), whether
Books gets a glance-board cell (yes — §4.4), whether the device holds enough pre-KOReader
history to justify Phase 3 (irrelevant — Phase 3 was rescoped, §3), **how automatic sync is
triggered** (§3.0 — `NetworkConnected` plus an on-disk outbox, folded into Phase 4, which
also settles the phase ordering), **whether TLS is a blocker** (it is not — §3.0),
**where highlight text lives** (the sidecar, §4.2.2) and **whether a firmware update can
silently end the feature** (no — 5.x/6.x is opt-in here, §1.1).

---

## 7. What this plan got wrong — first draft and third pass

Recorded rather than silently edited away, so a future session sees the reasoning and not
just the corrected text.

- **Phase 3's stated rationale was wrong.** The first draft justified the Nickel import
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
  daily use costs a migration of the device's own state. Designed in §3, Phase 4.
- **The headline feature's dependency on sync freshness went unexamined.** A daily minutes
  goal and a streak both need today's data, and Phase 4 delivered data only when the user
  remembered to tap. An unsynced night reads as a zero, not as unknown — so the streak
  breaks on a night that was actually read. The first draft put the automatic trigger in
  a later phase "only once the feature proves itself" without noticing that the feature cannot
  prove itself while its headline number is wrong. **Now resolved (§3.0)**, and the
  resolution inverted the phase ordering rather than patching it: automatic sync is an
  outbox inside a plugin we were writing anyway plus two settings the owner switches on, so
  it belongs in Phase 4 and the old second phase stopped being an automation phase at
  all. The remaining honesty rules moved to §4.1 and §5.
- **HTTPS was recorded as a possible hard blocker. It was not one — the claim was wrong,
  not merely cautious.** §3 used to carry a "⚠ the one thing that must be verified" warning
  built on KoInsight using plain `socket.http` and documenting an `http://server-ip:3000`
  server, and it proposed shelling out to a bundled `curl` as the fallback. LuaSocket
  dispatches `https://` to LuaSec by scheme and LuaSec is bundled, so the evidence never
  supported the worry. The real, much smaller finding underneath it — certificate
  verification defaults to `verify="none"` and nothing wires the shipped CA bundle up — was
  missed entirely by looking at the wrong layer. Recorded because the mistake is
  generalisable: *"plugin X doesn't visibly require the TLS library"* is not evidence that
  the runtime cannot do TLS.
- **Two on-device trigger options were carried for a while that cannot work at all**, and
  would have cost real build time before failing: a polling `scheduleIn` timer (monotonic
  clock, does not advance across suspend) and NickelDBus (its signals only exist while
  Nickel runs, which is exactly when KOReader does not). Both are now in the "deliberately
  NOT doing" list with their reasons, so they cannot be re-proposed cheaply.

**Found in the fourth pass (2026-09-29):**

- **The firmware cliff was overstated, and the action it drove does not exist.** The third
  pass wrote that Kobo "ships 5.x" to this device class and that "a silent overnight update
  to 5.x would take the feature out entirely", and made "turn off automatic firmware
  updates" the first action. Kobo offers no such setting. For a Kobo-branded Clara BW, 5.x
  is an opt-in accessibility update, 6.0 is an opt-in prompt, and Kobo's own update server
  offers a 4.45 device only 4.46. KOReader also runs on 5.x now. The real risk is narrower
  and different: **accepting** an opt-in, especially 6.0 with its data-loss bug. The lesson:
  a scary claim about a vendor's rollout should be checked against the vendor's update
  endpoint, not only against forum anecdotes.
- **A code fact went stale between passes.** §4.4's glance-board argument was true against
  the `sm:/lg:/2xl:` grid it was written for. The board was then rebuilt on container
  queries, which made a Books cell produce a ragged row at three columns. Code-derived
  claims in a long-lived plan need re-verifying when the phase that depends on them starts.
- **Storage was never considered**, because delivery was not in scope. Once it was, the
  1 GB wall and a guard that counts only one bucket turned out to be a hard constraint on
  the design (§4.6) — books pass through Supabase, they never live there.

---

## 8. Getting books onto the Kobo — "push from my phone or my laptop"

Added 2026-09-29, when the owner asked for it. Everything here was read from source or
vendor docs on that date. Links are in §13.

### 8.1 What already works, with no code from us

| Route | From | Lands in | Verdict |
|---|---|---|---|
| **USB drag and drop** | Mac | Nickel's library, and a folder KOReader can open | Works today. Eject properly so Nickel imports. |
| **Calibre over USB** | Mac | Nickel (calibre ≥ 8.0 converts EPUB → KEPUB on send; the old plugins are no longer needed) | Works. Best for bulk. |
| **Calibre wireless → KOReader** | Mac, same Wi-Fi | KOReader's calibre inbox folder | **The laptop "push", zero code.** calibre → *Start wireless device connection*; KOReader → *Calibre → Connect*. TCP 9090 plus UDP discovery; same local network only. |
| **send.djazz.se** | Phone or Mac | Nickel, through the Kobo's beta browser | Works, but both devices must be in use at the same moment and a third-party server holds the file briefly. |
| **Instapaper** (built into Nickel since firmware 4.43, 26.08.2025; replaced Pocket) | iPhone share sheet | Nickel → *My Articles* | **The article route, zero code, free.** Folders, highlights and PDFs don't sync. |
| **KOReader News downloader** | Any RSS/Atom feed | KOReader | Turns feeds into EPUBs. Since 2026.03 it also saves an item whose link *is* an EPUB unchanged, so a private feed of our own books would work too. |
| Kobo-store emulation (calibre-web, Komga, BookLore) | a server | Nickel over Wi-Fi | **Skip.** Needs an always-on server, and it is fragile on 4.45+: "Sync failed" on every sync (CWA #1418); on a Clara BW with 4.46 new books arrive only after a forced full sync and progress doesn't sync (calibre-web #3714). |
| Native Dropbox / Google Drive | Phone or Mac | Nickel | **Not supported on the Clara BW** (flagship models only). A config hack exists; unreliable. |
| Email to Kobo | — | — | Does not exist, officially or otherwise. |
| Kobo Books iOS app | iPhone | the app only | Files imported there never reach the e-reader. |

**DRM:** KOReader cannot open DRM-protected books (Kobo store, library loans, protected Apple
Books titles). Those stay in Nickel. This owner's library is DRM-free sideloaded EPUB, so
it is unaffected (§1).

### 8.2 The route we build: "Send to Kobo"

The idea: upload a book anywhere; it appears on the Kobo. Two steps, so the first is useful
long before the tracker plugin exists.

**Step 1 (roadmap Phase 2), no plugin needed: our own OPDS feed.** OPDS is the standard
Atom feed that e-reader apps browse to download books, and KOReader has a built-in OPDS
browser.

1. **Upload**:
   - The app gets a Books → *Send to Kobo* sheet: a file picker on the iPhone, drag and drop
     on the Mac.
   - The browser uploads straight to Storage with the normal user session.
   - Later, an iOS share-sheet Shortcut (Codex's side, a new C task): it asks the function
     for a signed upload URL (`createSignedUploadUrl`, valid 2 h), then PUTs the file
     directly to Storage. The file never passes through a function, which matters because
     functions have 2 s of CPU and a 150 s wall clock on Free.
2. **Hold** it in a private `kobo-inbox` bucket (`<user>/<delivery id>/<file>`) under
   §4.6's caps. A `book_deliveries` row tracks it:
   - Columns: `id`, `user_id`, `storage_path`, `filename`, `mime`, `size_bytes`, `title`,
     `author` (read from the EPUB's OPF in the browser at upload; optional),
     `status queued|downloaded|expired|cancelled`, `created_at`, `downloaded_at`,
     `device_id`.
   - Owner-only RLS. Status is written by the function with the service role.
3. **Serve** an OPDS 1.2 feed from the Kobo's own edge function (§4.1), newest first. The
   rules below come from KOReader's `opdsparser.lua` / `opdsbrowser.lua` / `opdsclient.lua`:
   - **Always Atom XML**, even though KOReader asks for OPDS 2.0 JSON first; its OPDS 2
     path is untested with login and sync.
   - **The token goes in the URL path, not HTTP Basic.** KOReader supports Basic auth, but
     on a same-host redirect it forwards the Basic header to Storage, and whether Supabase's
     gateway tolerates that is unconfirmed. A path token sends no header at all. Links must
     be absolute, because KOReader drops a query string when resolving relative links.
   - **Stable download links**: `/…/opds/<token>/books/<id>/<name>.epub`. That route
     answers GET and HEAD with a 302 to a short-lived signed Storage URL. Never put an
     expiring signed URL in the feed itself: KOReader's catalogue sync remembers the first
     entry's link as its "last seen" marker. It follows up to 5 redirects and refuses
     HTTPS → HTTP.
   - `type="application/epub+zip"` on every acquisition link (there is no mapping for
     `application/kepub+zip`). Double-quoted attributes. A single `<author><name>`. Only
     the five basic XML entities. A `next` link must carry a `type`, or KOReader ignores it.
   - Send `ETag` / `Last-Modified`; KOReader revalidates and accepts a 304.
   - KOReader names downloads `Author - Title.epub` unless *Use server filenames* is ticked.
     With it ticked, it reads `filename="…"` from the HEAD response's
     `Content-Disposition`. A lone `filename*=` is not understood.
4. **On the Kobo, once**: add the feed as a catalogue with *Sync catalog* ticked. From then
   on **one tap, *Sync all catalogs*, pulls every new book** (up to 50 since the last-seen
   link) into the sync folder.
5. **Clean up**: the download route marks the row `downloaded`. A sweep deletes the file
   24 h after download, or 7 days after upload if never downloaded. The grace period lets a
   failed download be retried. The sweep runs inside the function on each feed request,
   plus a daily pg_cron call. It must delete **through the Storage API**, never by deleting
   `storage.objects` rows in SQL, which leaves the file behind.

**Step 2 (roadmap Phase 4, once our plugin exists): no tap at all.** The plugin checks the
inbox in the same `NetworkConnected` window it drains the outbox in (§3.0). It downloads
new files into `/mnt/onboard/Books/Inbox/` and confirms each one
(`POST …/deliveries/<id>/ack`). The server deletes the file on the ack instead of waiting a
day. **This is the real push**: upload on the phone, pick up the Kobo, the book is there.

**Optional later, Nickel too:** a tiny static page on GitHub Pages (Supabase rewrites
`text/html` to `text/plain` on its default domain) for the Kobo's beta browser. It lists
the inbox with the token in the URL and offers `.kepub.epub` downloads (kepubify has a
WASM build that converts in the browser at upload time). Only worth it if some books should
be read in Nickel.

**Two risks to test first, in Phase 0 on the owner's device, because every KOReader network
feature depends on them:** KOReader issues **#13197** (the device reboots when Wi-Fi is
switched on from KOReader) and **#16046** (a reboot when KOReader restarts while Wi-Fi is
stuck). Both are open.

### 8.3 Web articles

- **Now:** Instapaper's built-in Nickel integration (above). Nothing to build.
- **Later (optional):** a "send this link to the Kobo" action in the app that calls
  Instapaper's Simple API (`POST /api/add`, Basic auth; credentials in Vault, never in the
  client). Or, KOReader-side: Readeck (self-hosted, EPUB export) with `readeck.koplugin`, or
  Wallabag. Converting articles to EPUB ourselves (Readability + `epub-gen-memory` in an
  edge function) is possible, but the 2 s CPU limit makes big pages a risk. Only if the
  Instapaper route disappoints.

---

## 9. Fun features — a menu to pick from, not a commitment

Researched 2026-09-29. Each item says what it is, what it depends on, a rough effort
(S = hours, M = days, L = weeks) and the catch. **None is scheduled**: roadmap Phase 6 (§11)
is "pick two or three from this list once the tracker works". Items marked "needs Phase 4"
use the reading data the tracker brings in.

### 9.1 Around the reading data (needs Phase 4)

| Idea | What | Effort | Catch |
|---|---|---|---|
| **Now reading on Home** | Cover, % read, "≈ 2 h 10 min left" (KOReader's own average-time-per-page idea, computed server-side from page events), last read | S | "Time left" is a floor, like every minutes figure (§2.2) |
| **Streak heatmap and year in books** | GitHub-style 365-day heatmap, books finished per month, a year-end "Wrapped" page. Community precedent: HabitReads (streak freeze, badges), Reading Insights, KoShelf | M | Streaks follow §5's retroactive rule; never a stored counter |
| **Reading sessions in the Daily agenda** | Reconstructed sessions (§4.3) show as done rows in `DayAgenda`, next to planned blocks | S–M | Additive only (`NEVER_HIDES`); never written into `time_blocks` |
| **Reading vs sleep** | Health → Sleep shows "nights you read after 22:00" beside sleep onset, as two lanes on one axis, never a correlation score | M | Must follow the Health page's no-derived-metric rule and say "side by side, not cause and effect" (the `RecoveryLoadPanel` precedent) |
| **Ask the AI about your reading** | `books`/`book_highlights` in `DB_CATALOG` (already settled, §4.2) plus `EMBED_SOURCES` for highlights, so "what did I highlight about habits?" works through `semantic_search` | S | Needs the `ai-proxy` redeploy that §4.2 already lists |

### 9.2 The Kobo as a calm display

- **A "Today" card as the sleep screen.** An edge function renders a 1072×1448 greyscale
  PNG: today's first tasks, MET weather, the next Ruter departures from Home, one highlight
  and one Norwegian word. Our plugin downloads it whenever the radio is already up (the
  same `NetworkConnected` window as the outbox, §3.0) and points KOReader's sleep screen at
  it. Put the reader down and it shows "Bus 25 in 6 min · 12° · 3 tasks". Effort M.
  - Rendering: Supabase documents an OG-image example with satori + resvg
    ([example](https://supabase.com/docs/guides/functions/examples/og-image)). CLAUDE.md
    notes that WASM bundles need a **CLI deploy**, not a Dashboard paste. A cheaper first
    version skips the PNG and sets KOReader's sleep-screen *message* text instead.
  - The image is only as fresh as the last wake with Wi-Fi. A scheduled refresh would need
    RTC wakeups, which are unproven on MT8113 (§3.0). So it is "fresh when you last put it
    down", which is the honest label.
  - Precedents: WeatherLockscreen (KOReader plugin, timed "active sleep" refresh),
    koreader-live-sleepscreen (fetch before sleep, about 10 s awake), customisablesleepscreen
    (progress, daily goal, a random highlight) —
    [WeatherLockscreen](https://github.com/loeffner/WeatherLockscreen) ·
    [live-sleepscreen](https://github.com/file99/koreader-live-sleepscreen) ·
    [customisablesleepscreen](https://github.com/pxlflux/customisablesleepscreen.koplugin).
- **A mini dashboard on KOReader's home screen.** The Bookshelf plugin (v5.2.3,
  28.09.2026, needs KOReader ≥ 2026.03) supports custom Lua "micromodules". One that reads a
  small JSON endpoint (next departure, first task, temperature) shows the dashboard every
  time a book is picked. Effort M.
  [bookshelf.koplugin](https://github.com/AndyHazz/bookshelf.koplugin)
- **Not recommended here: a full wall display** (TRMNL client, FBInk loops). It needs
  NickelMenu (4.x only), keeps the device awake and drains the battery. It would stop being
  a reader. [trmnl-kobo](https://github.com/usetrmnl/trmnl-kobo)
- **Supabase gotcha for anything the Kobo browser opens:** on the default domain a GET that
  returns `text/html` is rewritten to `text/plain`
  ([limits](https://supabase.com/docs/guides/functions/limits)). XML (OPDS), JSON and PNG
  are unaffected; any HTML page for the device belongs on GitHub Pages.

### 9.3 Learning Norwegian while reading

- **Dictionaries on the device** (StarDict, in `.adds/koreader/data/dict/`), effort S:
  - **Ordbøkene for lesebrett**: Bokmålsordboka + Nynorskordboka (CC BY 4.0, Språkrådet /
    UiB), 93,492 headwords and 337,328 inflected forms, so tapping "drakk" finds "drikke"
    ([repo](https://github.com/sinic/ordboekene-for-lesebrett)).
  - Wiktionary Bokmål→English (28,432 entries) and Turkish→English (27,511)
    ([downloads](https://xxyzz.github.io/wiktionary_stardict/)).
  - TDK Güncel Türkçe Sözlük converter for Turkish books (AGPL, build it yourself)
    ([repo](https://github.com/anezih/guncel-turkce-sozluk-kindle-kobo-stardict)).
  - English ↔ Turkish, both directions, from the same author
    ([fono-sozluk-stardict](https://github.com/anezih/fono-sozluk-stardict); licence
    unconfirmed).
  - **No offline Norwegian↔Turkish dictionary exists.** LEXIN has Bokmål–Turkish online
    only, with no download or API found.
- **Words of the day.** KOReader's Vocabulary Builder already keeps every looked-up word
  with about 15 words of context and a spaced-repetition schedule
  (`settings/vocabulary_builder.sqlite3`: `vocabulary(word, title_id, create_time,
  review_time, due_time, review_count, prev_context, next_context, streak_count,
  highlight)`, `title(id, name, filter)`; [db.lua](https://github.com/koreader/koreader/blob/7fedb854cc145427a827431555208b82237161fb/plugins/vocabbuilder.koplugin/db.lua#L7-L33)).
  Our plugin sends new rows alongside page events. The app shows "3 words today" with the
  Ordbok API definition ([ordbokapi.org](https://ordbokapi.org/), CC BY 4.0, open CORS) plus
  a Gemini Turkish meaning and example sentence. Effort M.
- **A morning paper in easy Norwegian.** KOReader's built-in News downloader turns
  [Klar Tale's RSS](https://www.klartale.no/rss) (Norway's easy-read news) into a daily
  EPUB. Zero code, effort S.
  [News downloader](https://github.com/koreader/koreader/wiki/News-downloader)
- **Parallel books.** `bilingual_book_maker --api_format gemini` on a DRM-free Norwegian
  EPUB produces original and Turkish paragraph by paragraph. It runs on the Mac and is sent
  like any book (§8). Effort S, plus Gemini tokens per book.
  [bilingual_book_maker](https://github.com/yihong0618/bilingual_book_maker)

### 9.4 An AI reading companion on the device

`assistant.koplugin` speaks the Gemini protocol natively: spoiler-free X-Ray and
"previously on" recaps, explain a Norwegian sentence in Turkish, an AI dictionary. Last
commit 28.09.2026. Effort S.
[assistant.koplugin](https://github.com/omer-faruq/assistant.koplugin)
**Catch:** it needs an API key **stored on the device**. That must be a separate,
restricted Gemini key with a spending cap, never the `GEMINI_API_KEY` from Vault. Whether it
accepts a custom base URL (which would let it go through `ai-proxy` with the device secret)
is unconfirmed.

### 9.5 Library, wishlist and shelves

- **Dropped by the owner (30.09.2026).** **"Can I borrow it at Deichman?"** A book wish shows Deichman's Libby copies, holds and
  "available now". Borrowing then happens natively on the Clara BW through OverDrive. The
  source is OverDrive's unofficial "thunder" API
  (`…/v2/libraries/deichman/media?query=…`, open CORS, verified by the researcher). Effort
  S. **Catch:** it is unofficial and can change without notice. This is an availability
  lookup, not tracking: loans stay out of the tracker (§2.3).
  [libbrary](https://github.com/cloin/libbrary)
- **Norwegian metadata that is actually right.** Open Library returns poor data for
  Norwegian ISBNs (the researcher's test: *Snømannen* came back as "Snomannen [Imported]",
  no cover). The **Nasjonalbiblioteket** catalogue API returns the correct title,
  publisher, pages, series, language and cover thumbnails
  (`api.nb.no/catalog/v1/items?q=isbn:…`, no auth). Its licence is **unconfirmed**. So
  §4.5's source order becomes: NB for Norwegian ISBNs, then Open Library, then Hardcover.
  [example](https://api.nb.no/catalog/v1/items?q=isbn:9788203193538)
- **Hardcover as the social shelf** (optional). The Hardcover KOReader plugin syncs
  status, progress, rating and manual quotes over Hardcover's GraphQL API. Free plan: 5,000
  requests/day, 60/min.
  [hardcoverapp.koplugin](https://github.com/Billiam/hardcoverapp.koplugin)

### 9.5.1 A simpler KOReader interface (owner, 04.10.2026: "the UI is confusing")

Ready-made, installed like any plugin — **over SSH (`scp`), never by USB copy** (the fsck
rename from Phase 0):
- **Project: Title** ([joshuacant/ProjectTitle](https://github.com/joshuacant/ProjectTitle)) —
  the most used: a commercial-reader-style library with cover grid/list, a short header and
  footer. Releases are tied to an exact KOReader version (v3.8.3 for 2026.07.x). Disable
  *Cover browser* first (🛠 → More tools → Plugin management), copy `projecttitle.koplugin`
  into `.adds/koreader/plugins/`, enable it, restart. Undo: re-enable Cover browser.
- **zen_ui.koplugin** ([AnthonyGress](https://github.com/AnthonyGress/zen_ui.koplugin)) and
  **simpleui.koplugin** ([doctorhetfield-cmd](https://github.com/doctorhetfield-cmd/simpleui.koplugin)) —
  minimal home screens with their own navigation bar.
- **Koreader-Menu-customizer** ([JoeBumm](https://github.com/JoeBumm/Koreader-Menu-customizer)) —
  hides menu items you never use; combines with any of the above.
- Index of more: [awesome-koreader](https://github.com/jannick-holm/awesome-koreader).
Our plugin only adds one menu entry, so it works with any of these.

**Chosen (owner, 05.10.2026):** Project: Title, App Store, the finished-book trophy and one-font
patches, and the **Bookshelf sleep screen** patch
([ameyrk99/koreader-bookshelf-screensaver](https://github.com/ameyrk99/koreader-bookshelf-screensaver),
AGPL-3.0, commit `3e2b4f11`: recent books as spines that fill like progress bars, the open book
standing on top). ZenOS, SimpleUI, Menu Customizer and the other extras are not installed; the
owner will ask for changes if wanted. Install steps: `SETUP-PHASE-3-4.md`.

### 9.6 Small delights, zero code

- Chess against Stockfish, Wordle and Connections as KOReader plugins
  ([casualkochess](https://github.com/MJCopper/casualkochess.koplugin) ·
  [wordle](https://github.com/t2ym5u/wordle.koplugin)).
- AutoWarmth: the warm light follows Oslo's actual sunset
  ([PR #8129](https://github.com/koreader/koreader/pull/8129)).
- A page-turner remote: the official Kobo Remote supports the Clara BW natively. KOReader
  Bluetooth on MediaTek is experimental, and returning to Nickel after using it can crash
  and reboot the device ([kobo.koplugin Bluetooth notes](https://ogkevin.github.io/kobo.koplugin/features/bluetooth.html)).
- A plugin "app store" on the device: [appstore.koplugin](https://github.com/omer-faruq/appstore.koplugin).

---

## 10. Working from the MacBook — Claude in the terminal

### 10.1 Two Claude sessions, one repo

- **This cloud session** (claude.ai/code) builds everything server-side and in the app:
  migrations, the edge function, the Books page, and the plugin's *source code*. It cannot
  reach the Kobo.
- **A Claude Code session in the Mac's terminal** (run `claude` inside a clone of this repo)
  can touch the device:
  - over **USB**: the Kobo mounts as `/Volumes/KOBOeReader`, with `.kobo` and `.adds` hidden
    in Finder (Cmd+Shift+. shows them);
  - over **Wi-Fi**: KOReader's SSH server.

  It installs, copies, tests and reads logs.
- They meet in **git**. The Mac session pulls the branch, runs the scripts and reports back.
  The owner can paste its report here, or it can commit a note. Personal data never goes
  into git (§10.3).

### 10.2 One-time Mac setup (owner, about 15 minutes)

1. Install Claude Code, clone the repo, start it:
   `git clone https://github.com/Lasciviens/Project_Daily && cd Project_Daily && claude`.
2. Plug in the Kobo and tap *Connect*. The first time the terminal reads the volume, macOS
   asks for permission to access removable volumes: allow it.
3. Stop macOS littering the device. Each command is Apple's documented switch; sources in
   §13.
   - `defaults write com.apple.desktopservices DSDontWriteUSBStores -bool TRUE && killall Finder`
     (no `.DS_Store` on USB drives — unofficial, "not a universal guarantee")
   - `sudo mdutil -i off /Volumes/KOBOeReader` (no Spotlight index)
   - `mkdir -p /Volumes/KOBOeReader/.fseventsd && touch /Volumes/KOBOeReader/.fseventsd/no_log`
   - Copy with `cp -X` (no extended attributes or `._` resource forks), and clean up with
     `dot_clean -m /Volumes/KOBOeReader`. `._` files are mostly harmless anyway: KOReader
     hides dotfiles, loads only `*.koplugin` folders, and Nickel's `ExcludeSyncFolders` line
     skips dot-paths.
4. **Always eject** (`diskutil eject /Volumes/KOBOeReader`) before unplugging. Nickel
   imports new books, and installs run, only after ejecting.

### 10.3 Rules for the Mac session — it touches a real device with personal data

- **Back up first**, every time before installing anything: `rsync -a
  /Volumes/KOBOeReader/ ~/KoboBackups/$(date +%F)/`. This includes the hidden `.kobo` and
  `.adds` folders.
- **Never write to `.kobo/KoboReader.sqlite`** (Nickel's live database). Copy it out and
  open the copy read-only. Never delete `-wal`/`-journal` files (§3 Phase 3).
- Write only inside:
  - `.adds/` (KOReader, NickelMenu and, if used, KFMon);
  - `.kobo/KoboRoot.tgz` during an install;
  - one appended line in `.kobo/Kobo/Kobo eReader.conf` (`ExcludeSyncFolders`, §10.4);
  - our plugin folder;
  - macOS's own housekeeping from §10.2 (`.fseventsd/no_log`, the Spotlight switch-off,
    `dot_clean` of `._` files) — never book files or Kobo data.
- **Reading data stays on the Mac.** `statistics.sqlite3`, sidecars and vocabulary may be
  inspected there, but never committed. Only structure notes and anonymised samples go
  into the repo.
- **Secrets are never committed or pasted into chat.** `KOBO_SYNC_SECRET` and
  `KOBO_OPDS_TOKEN` are generated by the owner (`openssl rand -hex 32`), set in Supabase and
  typed into the plugin's settings on the device.
- **Never accept or install firmware. Never run a downgrade package** (§1.1).

### 10.4 Installing KOReader on 4.45/4.46 (Phase 0)

- **Recommended: NickelMenu only.** It survives firmware updates; KFMon does not.
  1. Put NickelMenu's `KoboRoot.tgz` (v0.6.0) into `.kobo/` and eject. The device
     "processes" and reboots.
  2. Unzip the `koreader` folder from `koreader-kobo-v2026.07.1.zip` into `.adds/` **from
     the Terminal** (`unzip`, not Safari's auto-unzip, which breaks the structure).
  3. Append to `.kobo/Kobo/Kobo eReader.conf`:
     ```
     [FeatureSettings]
     ExcludeSyncFolders=(\\.(?!kobo|adobe).+|([^.][^/]*/)+\\..+)
     ```
     Otherwise Nickel (firmware ≥ 4.17) indexes KOReader's hidden files as books.
  4. Create `.adds/nm/koreader` containing
     `menu_item:main:KOReader:cmd_spawn:quiet:exec /mnt/onboard/.adds/koreader/koreader.sh`.
  5. Eject.
- **Which files (checked 04.10.2026 against the GitHub release assets):**
  - KOReader: **`koreader-kobo-v2026.07.1.zip`**, SHA256
    `0f36a62ce73b12516f969e4ad7862cc06920afb03c7bd4db29a0d990bdd84b2f`. **Not** the
    `koreader-kobov5-…` zip: that one is for Kobo's 5.x firmware line (PR #12401, "basic
    support for the recent v5 line of Kobo firmwares", new userland and toolchain), and this
    device runs 4.45.
  - NickelMenu: `KoboRoot.tgz` from release v0.6.0, SHA256
    `322ff9aa863860e8f5f7e0b55cae561c54bf95983b9bce1d19819d1225d064af`.
  - If `[FeatureSettings]` already exists in `Kobo eReader.conf`, add the
    `ExcludeSyncFolders` line under it instead of a second section.
- **Evidence for 4.45 is mixed but workable:**
  - NickelMenu + KOReader were installed from macOS on a Libra Colour on 4.45.23697
    (04.09.2026).
  - One report has the NickelMenu entry missing on 4.45.23684 (NickelMenu #229, KFMon #24).
  - **Nothing is confirmed for a Clara BW on 4.45.23697** — Phase 0 finds out.
- **Fallback: NiLuJe's one-click package** (KFMon 1.4.6 + NickelMenu + KOReader 2026.03,
  last updated 07.06.2026; 4.x only).
  - On macOS, Gatekeeper may refuse its `.command` installer; unzip it from the Terminal
    instead, which is NiLuJe's own advice.
  - KFMon must be reinstalled after any firmware update.
- Either way, update in-app to **2026.07.1** afterwards (§2.3).
- **Uninstall:** delete `.adds/koreader`. For NickelMenu, create `.adds/nm/uninstall` and
  reboot; it removes the small library it added to the system partition. (NickelMenu is the
  one piece that touches Kobo's system software; KOReader itself lives entirely in
  `.adds/`.) The `ExcludeSyncFolders` line can stay; it is harmless.
- **Switching** is free: launching KOReader kills Nickel, and exiting KOReader restarts it.
  One exception: after using Bluetooth in KOReader, returning to Nickel can crash and reboot
  a MediaTek device.

### 10.5 The plugin's development loop (Phase 4 onwards)

- **Where the code lives:** `scripts/kobo/lascisboard.koplugin/` in this repo.
  - Claude owns it, like the RP6 scripts in `scripts/`; Codex's area stays
    `scripts/iphone-shortcuts/` only.
  - Licence **AGPL-3.0-or-later** (§3.0.1).
  - Shape: `_meta.lua` + `main.lua` returning a `WidgetContainer:extend{…}`. Menu entries go
    through `self.ui.menu:registerToMainMenu(self)`; settings in
    `LuaSettings:open(DataStorage:getSettingsDir() .. "/lascisboard.lua")`; events such as
    `onCloseDocument`, `onNetworkConnected` and `onReaderReady` (§3.0). The template is
    KOReader's own `plugins/hello.koplugin`.
- **Fast loop without the device: KOReader's emulator on the Mac.**
  - Either the official macOS app from the GitHub Actions run of a release. It is unsigned:
    "Open Anyway" in Privacy & Security. Its data dir is
    `~/Library/Application Support/koreader/`, and it loads plugins from `plugins/` there.
  - Or build from source: `./kodev fetch-thirdparty && ./kodev build && ./kodev run
    -s=kobo-clara`. That gives the Clara's 1072×1448 at 300 dpi.
  - Wi-Fi is faked, but real HTTP goes out over the Mac's network, so **the plugin can talk
    to the real `kobo-sync` from the emulator**. `./kodev check` runs luacheck.
  - The Homebrew cask is Linux-only.
- **On the device:** a `scripts/kobo/deploy-plugin.sh` copies the folder:
  - over USB: `cp -X`/rsync into `/Volumes/KOBOeReader/.adds/koreader/plugins/`;
  - over Wi-Fi: KOReader's SSH (dropbear, port 2222, user root; key in
    `.adds/koreader/settings/SSH/authorized_keys`; SFTP included, so OpenSSH ≥ 9 `scp`
    works; runs only while KOReader runs with Wi-Fi on).

  Then restart KOReader. Logs are in `.adds/koreader/crash.log`; turn on verbose debug
  logging under Developer options.

### 10.6 The first thing the Mac session does (Phase 0, read-only)

A `scripts/kobo/device-report.sh` that prints, and changes nothing:
- `.kobo/version`: firmware, and product id `391`/`395` → N365/P365;
- free space;
- counts of `.epub` / `.kepub.epub` / `.pdf` in the library;
- the installed KOReader version;
- whether `.adds/koreader/data/ca-bundle.crt` exists (open question 3).

The owner pastes the output here. It contains no titles and no reading data.

---

## 11. Roadmap — phases, gates, who does what

Each phase ends at a **gate**: a check on the real device that must pass before the next
phase starts. "Owner" steps are the manual Supabase steps this repo always has (migrations
and function deploys are manual; CLAUDE.md → Pending manual steps).

### Phase 0 — Device ready (owner + the Mac session; no app code)

1. Check the firmware (Settings → Device information) and the hardware revision
   (§10.6). **If it is 5.x/6.x, stop and report** — the plan then changes (§1.1).
2. Back up (§10.3) and set up the Mac (§10.2).
3. Install KOReader (§10.4) and update it to 2026.07.1.
4. In KOReader: join the Wi-Fi network, then test the two open reboot bugs:
   - toggle Wi-Fi ten times (#13197);
   - restart KOReader once with Wi-Fi on (#16046);
   - sleep and wake with *auto restore Wi-Fi* on.
5. Enable SSH (key only) and connect from the Mac.
6. Read 10 minutes of any book.

**Gate:**
- KOReader starts from Nickel's menu;
- no reboot in the Wi-Fi tests;
- SSH works;
- KOReader → Statistics shows the 10 minutes.

### Phase 1 — Books today, zero code (owner, same day)

**Prepared 04.10.2026 (files checked by downloading them):**
- Dictionaries, all StarDict, copied **over SSH** (`scp`, so the Kobo's Linux writes the
  names and the fsck rename from Phase 0 can't happen) into
  `.adds/koreader/data/dict/<name>/`:
  - `dict-nb.zip` from `sinic/ordboekene-for-lesebrett` v0.1 — Bokmålsordboka, 93,492
    words + 337,328 inflections, SHA256 `e09606e0…25ed45` (6,655,747 B). (`dicthtml-*` is
    Kobo's own Nickel format, not for KOReader; `dict-nn.zip` is Nynorsk.)
  - `nb-en.tar.zst` and `tr-en.tar.zst` from `xxyzz/wiktionary_stardict` release
    20260928 (Wiktionary snapshot 01.09.2026, CC BY-SA 4.0): 28,432 and 27,511 words,
    SHA256 `0e4ec7c7…f59893`/`cc759a49…fa528d` — see the Mac command for the full values.
    Archives have a `./` root, so each is extracted into its own folder.
  - **Not available ready-made:** English→Turkish (no `en-tr` build; the fono converter
    needs Fono's CD-ROM data, so it is dropped) and TDK Güncel Türkçe Sözlük (a converter
    only — `pip install Jinja2 pyglossary spylls`, `python gts.py -b 1` with
    `gts.json.tar.gz` + `tr_TR.json.gz`; a later, optional build).
- News: `.adds/koreader/news/feed_config.lua` (the News downloader's default download
  dir) with Klar Tale `https://www.klartale.no/rss`, NRK `https://www.nrk.no/toppsaker.rss`
  and BBC Türkçe `https://feeds.bbci.co.uk/turkce/rss.xml` — all three answered 200 with
  RSS items on 04.10.2026.

- The laptop push: calibre → *Start wireless device connection*; KOReader → *Calibre →
  Connect*. Set KOReader's calibre inbox folder.
- Articles: link Instapaper in Nickel (More → My Articles).
- Dictionaries into `.adds/koreader/data/dict/`: Ordbøkene for lesebrett, TDK Güncel Türkçe
  Sözlük, English ↔ Turkish (fono-sozluk), and Wiktionary Bokmål→English (§9.3, §12.4).
- Norwegian (Klar Tale, NRK) and Turkish news feeds in KOReader's News downloader.

**Gate:**
- a book sent from the Mac opens in KOReader;
- an article saved on the iPhone shows in Nickel.

(The dictionary lookup test was dropped on the owner's call, 05.10.2026; the dictionaries stay installed.)

### Phase 2 — Send to Kobo v1 (Claude, cloud; small)

**Built 04.10.2026** (`claude/charming-newton-yhk8i`): migration `125_kobo_inbox.sql`,
`kobo-sync`, `/books` (Send to Kobo, inbox list with cancel, one-time setup card), the
Settings card and registry entry, the 850 MB game-media ceiling.

**Gate passed 04.10.2026 on the device:** a book uploaded from the iPhone appeared under
"Lasci's Board" in KOReader and downloaded. Three gotchas from the first run:
- The catalogue is added over SSH, not typed: `scripts/kobo/add-opds-catalog.lua` runs on the
  Kobo with KOReader's luajit, takes the token on stdin, edits `settings/opds.lua` (backup
  first) and sets the sync folder `/mnt/onboard/Send to Kobo`. Run it in a fresh KOReader
  session before opening OPDS — the plugin reads that file on first open and writes its own
  copy back after any OPDS change. Nickel also shows that folder's books (harmless).
- Supabase Storage refuses keys with brackets or non-ASCII letters, so the object is always
  `book.<ext>`; the real name stays in `book_deliveries.filename`. HTTP headers are Latin-1
  only, so the download's `Content-Disposition` carries an ASCII fallback plus `filename*`.
- "Forbidden" = the path token differs from `KOBO_OPDS_TOKEN`; "Something went wrong" right
  after deploy = migration 125 not applied yet.

**Claude builds:**
- A migration:
  - `book_deliveries`;
  - a private `kobo-inbox` bucket with its RLS;
  - `storage_usage_total()`, with the three existing uploaders switched to it — or the
    game-media ceiling lowered to 850 MB in the same release (§4.6).
- `kobo-sync` with the OPDS read routes only (§8.2). JWT off, `KOBO_OPDS_TOKEN`.
- A Books page with just the Send to Kobo tab: upload (picker, drag and drop), a list with
  status, cancel.
- An entry in Settings → Integrations and APIs, and a Kobo card in Settings → Subscriptions
  (status = last feed access; the Connections rule).

**Owner:**
- apply the migration;
- deploy with JWT off;
- set the token;
- add the catalogue in KOReader with *Sync catalog* ticked.

**After the gate passes (the owner said yes, 30.09.2026):** the iPhone share-sheet
Shortcut, as a new C task on `docs/codex-shortcuts.md`.

**Gate:**
- iPhone upload → *Sync all catalogs* → the book opens;
- the file is gone from Storage a day after download;
- the storage check counts the new bucket.

### Phase 3 — Books page and library (Claude; medium)

**Built 05.10.2026** together with Phase 4 (setup: `SETUP-PHASE-3-4.md`). Two deliberate
changes from the text below, both because the plugin exists now:
- **No browser `sql.js` import.** The plugin reads Nickel's `KoboReader.sqlite` read-only on
  the device (Nickel is not running while KOReader is) and computes `util.partialMD5` itself,
  so the inventory needs no USB session and no file picker, and stays current daily.
- **No shared metadata table.** `book-meta` writes cover/pages/publisher/year straight onto
  the owner's `books` row (fill-only); Hardcover is not wired (no token needed yet).
Not built: Home "Now reading" (the Daily glance cell covers it).

**Claude builds:**
- Migration: `books` and `reading_settings`.
- The browser inventory import (§3 Phase 3): `sql.js` over a copy of `KoboReader.sqlite`,
  plus `partialMD5` over the EPUBs (§4.2.1).
- The metadata function and shared catalogue table (NB → Open Library → Hardcover, §4.5).
- The Library and Queue tabs, with status, rating and review.
- The Daily glance Books cell and the Nutrition `row-span` change (§4.4).
- `books` `rw` in `DB_CATALOG`, then an `ai-proxy` redeploy.

**Owner:**
- apply the migration;
- redeploy `ai-proxy`;
- plug the Kobo into the Mac and pick its folder in the import dialog.

**Gate:**
- every book on the device appears exactly once, unopened ones included;
- Norwegian books have the right title and cover.

### Phase 4 — Reading tracker (Claude writes; the Mac session installs and tests; large)

**Built 05.10.2026; not yet run on the device.** Changes from the text below:
- **The outbox is `statistics.sqlite3` itself** plus the cursor (§3 "incremental sync"): a
  separate on-disk queue would only copy rows KOReader already keeps durably. Close/suspend
  capture is therefore unnecessary; on close the plugin sends only if already online.
- **Inbox ack keeps the 24 h grace** instead of deleting at once, so the OPDS fallback and a
  failed copy can still fetch the file.
- Sync is throttled to one automatic run per 10 minutes; a manual *Sync now* always runs.

- **Morning news, automatic (owner's ask, 04.10.2026):** KOReader's News downloader has no
  scheduler, no Dispatcher action and no Profiles auto-exec hook (checked in the 2026.07.1
  source), so syncing is a manual tap today. Our plugin already runs on wake-up and on
  `NetworkConnected`; it also calls the News downloader's sync once per day (first wake with
  Wi-Fi after 05:00), so the morning EPUBs are there without a tap.

**Plugin:** A, our own (the owner's choice, 30.09.2026; §12.4).

**Claude builds:**
- Migration: `reading_page_events`.
- `kobo-sync` write routes (`x-kobo-secret`).
- The plugin:
  - outbox, `NetworkConnected` drain and cursor (§3);
  - sidecar status, rating and percent (§4.2.2);
  - automatic inbox download plus ack (§8.2 step 2);
  - *Sync now* and *Full re-sync*.
- In the app: the goal ring and streak (§5, retroactive); a Stats tab; "Now reading" on
  Home; and the "not heard from the device since …" state.

**Owner:**
- set `KOBO_SYNC_SECRET`;
- deploy;
- turn on `auto_restore_wifi` and `auto_disable_wifi`;
- paste the secret into the plugin.

**Gate:**
- an evening's reading appears the next morning with zero taps;
- a night with Wi-Fi off shows "not heard from the device", never a broken streak;
- a phone upload is on the Kobo after its next wake, with no tap.

### Phase 5 — Highlights, notes and words (Claude; medium)

**Claude builds:**
- Migration: `book_highlights` and `book_words`.
- In the plugin: capture annotations at close and vocabulary rows (§4.2.2, §9.3).
- In the app: a Notes tab; a highlight of the day on Home/Daily; words of the day (Ordbok
  API + Gemini); `book_highlights` in `EMBED_SOURCES`.

**Gate:**
- a highlight made on the Kobo appears after the next sync;
- deleting it on the Kobo marks it deleted in the app.

### Phase 6 — Fun (pick two or three from §9)

The owner's picks (30.09.2026):
- the reading heatmap and year in books;
- the on-device AI reading companion (§9.4, §12.4).

Still on the menu: the sleep-screen "Today" message and Norwegian words of the day.

**On-device AI (05.10.2026):** postponed, still open — nothing installed, no key on the Kobo.

### Fallback — the Nickel-side trigger

Only if Phase 4's Wi-Fi window proves too rare in daily use (§3).

---

## 12. The owner's checklist, what Claude needs, and the decisions

### 12.1 Your to-do list for Phase 0 (about 45 minutes, Kobo + Mac)

1. On the Kobo: **Settings → Device information** → note the software version. If it
   starts with 5 or 6, stop and tell Claude.
2. From now on: **decline any "accessibility" or "optional update" prompt**, and leave
   Nickel's Wi-Fi off when you don't need it.
3. On the Mac: install Claude Code, clone the repo, start `claude` in it, and plug in the
   Kobo (§10.2).
4. Let the Mac session back up the Kobo, run the device report (§10.6) and apply the macOS
   settings (§10.2).
5. Install KOReader together with the Mac session (§10.4).
6. In KOReader:
   - connect to Wi-Fi;
   - turn on *Network → auto restore Wi-Fi after resume* and *disable Wi-Fi when
     inactive*;
   - turn on SSH, key only.
7. Run the Wi-Fi tests (§11, Phase 0 step 4).
8. Read 10 minutes of any book in KOReader.
9. **Send Claude:**
   - the firmware version;
   - `391` or `395`;
   - the KOReader version;
   - whether anything rebooted;
   - which dictionaries you want (Norwegian, Turkish, English).

### 12.2 What Claude needs, and what it never needs

- **Needs:**
  - the answers from 12.1-9 and the decisions in 12.3;
  - from Phase 2 on, the manual Supabase steps listed per phase in §11;
  - device test results and `crash.log` excerpts from the Mac session.
- **Never needs:**
  - your secrets (you set them in Supabase and on the device);
  - your reading data in git;
  - access to the Kobo from the cloud. Everything device-side goes through the Mac session.

### 12.3 Decisions only you can make

Answered on 30.09.2026. The answers are in §12.4.

1. **The plugin path** (§3.0.1): A, our own plugin (**recommended**); B, BookOrbit's plugin
   with our server; or D, KoInsight's plugin as a stopgap.
2. **Storage** (§4.6): stay on the free plan with a small, capped inbox (**recommended**),
   or upgrade the Supabase plan.
3. **Which reader for what:**
   - your own EPUBs in KOReader (tracked);
   - library loans and Instapaper articles in Nickel (not tracked, §2.3).

   Fine?
4. **The iPhone share-sheet Shortcut** for Send to Kobo (a Codex task): yes or no?
5. **The first fun items** (§9). Suggestion: the sleep-screen "Today" message, Norwegian
   words of the day, the reading heatmap.
6. **An on-device AI** (`assistant.koplugin`, §9.4) needs its own capped Gemini key stored on
   the Kobo. OK or skip?

### 12.4 The owner's answers (30.09.2026)

**Device and setup**
- **Firmware: 4.45.23792** (0af4c82936, 30.07.2026). That is the 4.x line, so KOReader and
  NickelMenu work, and nothing in §1.1 changes. It is a newer 4.45 build than the
  4.45.23697 that Kobo's update server was queried with; it is still offered 4.46.
- Claude Code is installed on the Mac (§12.1 step 3 is partly done: cloning the repo and
  plugging in the Kobo are still to do).
- **Model: P365 (product 395)** — device report, 04.10.2026. Per §1.1 a downgrade package
  is never used on this model (the plan never downgrades anyway).
- **Phase 0 progress (04.10.2026):** repo cloned on the Mac to `~/Project_Daily-fresh` (the
  older `~/Project_Daily` holds unpushed September work and is left untouched); backup in
  `~/KoboBackups/2026-10-04/` (195 files, 87 MB, `diff -rq` identical — rsync's exit 23 was
  only the unreadable `.Spotlight-V100`); 9 epub + 2 kepub on the device, nothing installed.
- **Installed (04.10.2026):** NickelMenu v0.6.0 (its entry showed after the reboot — the 4.45
  risk in §10.4 did not happen here) and KOReader v2026.07.1 (`koreader-kobo`), the
  `ExcludeSyncFolders` line (no `[FeatureSettings]` existed, so it was appended) and
  `.adds/nm/koreader`. `ca-bundle.crt` is present (open question 3). Backups:
  `2026-10-04`, `2026-10-04_18-52-43`, `2026-10-04_19-06-38`.
- **Gotcha hit on the first launch (04.10.2026):** KOReader crashed ("module
  'apps/filemanager/filemanagerbookinfo' not found"). The Kobo's own file-system check
  (fsck, run on the reboot after the eject) had renamed 8 of the files macOS wrote to
  `FSCK0000.000` — contents intact, names lost; all 8 sat in folders with many similarly
  prefixed names, so the likely cause is the 8.3 short names macOS generates. Fix: copy the
  8 back, delete the `FSCK0000.000` duplicates, let the Kobo run its check once more, then
  verify (`find … -name 'FSCK*'` empty, `diff -rq` against the zip clean) before starting
  KOReader. **If it ever recurs, install through a `KoboRoot.tgz` with
  `mnt/onboard/.adds/koreader/…` paths** (built with `COPYFILE_DISABLE=1 tar --no-xattrs`),
  so the Kobo writes the files itself. After any big copy from the Mac (plugin updates,
  dictionaries), run the same `FSCK*` check.
- **Wi-Fi tests passed** (10 toggles, restart with Wi-Fi on, sleep/wake: no reboot).
- **SSH works (04.10.2026):** key `~/.ssh/kobo_ed25519` on the Mac, `Host kobo` in
  `~/.ssh/config` (root, port 2222, 10.0.0.90), key in
  `.adds/koreader/settings/SSH/authorized_keys`. KOReader's dropbear still accepts a root
  password unless **SSH server → "Login with key only"** is ticked (it passes `-s`; can only
  be changed while the server is stopped) — tick it.
- `statistics.sqlite3` is in WAL mode: a copied file opens with
  `sqlite3 'file:…?mode=ro&immutable=1'`, not `-readonly`. Copy it together with any
  `-wal`/`-shm` files when they exist.
- **Phase 0 gate passed (04.10.2026):** KOReader starts from NickelMenu; no reboot in the
  Wi-Fi tests; SSH key-only (`dropbear … -s`, password refused); Statistics shows 1,316 s
  over 2 books. Gotcha: plugging the cable in while KOReader runs with the SSH server on
  shows "Filesystem is busy (dropbear)" — exit KOReader before a USB copy.

**"Do I need to block firmware updates?" — no.**
- Kobo can't be told to stop checking for updates while Nickel is on Wi-Fi, and that's
  fine. The only update to refuse is the 5.x/6.x one, and it installs only if you accept
  the "accessibility" or "optional update" prompt. A 4.46 update is harmless (reinstall
  KFMon if it was used, §1.1).
- Keeping Nickel off Wi-Fi is enough. KOReader's own Wi-Fi can't trigger a Kobo update,
  because Nickel isn't running while KOReader is.
- The harder blocks in §1.1 step 4 stay unused unless a 5.x update ever becomes automatic.

**Decisions**
1. **Plugin: A, our own.** Claude writes it; the Mac session installs and tests it (§10.5).
   Settles §3.0.1.
2. **Storage: stay on the Free plan.** A file stays in Supabase only until the Kobo has
   downloaded it, then it is deleted, as §4.6 says. Most novels are 0.3–5 MB as EPUB (not
   KB; the cover and fonts are most of it). Illustrated books and PDFs can reach tens of MB,
   so the 50 MB per-file and 150 MB inbox caps stay. Freeing space in `game-media` is a
   separate job.
3. **Tracking: KOReader only.** Library loans and articles read in Nickel stay untracked
   (§2.3 unchanged).
4. **iPhone Shortcut for Send to Kobo: yes, after Phase 2 works.** It becomes a Codex task
   on `docs/codex-shortcuts.md` then, not before.
5. **On-device AI: keep it in the list** (§9.4), with its own capped key.

**Fun list, picked**
- **Dictionaries** (Phase 1):
  - Turkish: TDK Güncel Türkçe Sözlük (§9.3).
  - English ↔ Turkish: `anezih/fono-sozluk-stardict` (both directions, StarDict)
    ([repo](https://github.com/anezih/fono-sozluk-stardict)). Licence and size are
    unconfirmed; check before installing.
  - Norwegian: Ordbøkene for lesebrett (§9.3).
  - **Norwegian ↔ Turkish: no offline dictionary exists.** LEXIN has one online only, and
    UiO's 2013 Turkish–Norwegian dictionary is print only. The workable route is the
    on-device AI (select a word → Turkish meaning in context), or Wiktionary
    Bokmål→English next to English→Turkish.
- **News as a morning EPUB** (Phase 1, zero code): Klar Tale and NRK for Norwegian, and a
  Turkish feed (for example BBC Türkçe) through KOReader's News downloader. Which Turkish
  feeds have usable RSS is checked when setting it up.
- **Reading heatmap and year in books** (Phase 6, §9.1).
- **Dropped: "Can I borrow this at Deichman?"** (§9.5).

**"An AI reading companion — to do what?"** Things a reader actually uses mid-book:
- select a Norwegian sentence → the Turkish meaning and why it's phrased that way;
- select a word → its meaning *in this sentence*, which a dictionary can't give;
- "who is this character again?" without spoilers past the current page;
- "previously on" after a week away: a recap of what you've read so far;
- a short summary of the chapter you just finished.

It runs through `assistant.koplugin` (§9.4) with a separate, capped Gemini key.

---

## 13. Sources

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
Incremental sync (§3, Phase 4): `plugins/statistics.koplugin/main.lua`
`STATISTICS_DB_PAGE_STAT_DATA_SCHEMA` / `…_INDEX` (the `page_stat_data(start_time)` index,
the `UNIQUE (id_book, page, start_time)` constraint, the `INSERT OR IGNORE`, and the
`DELETE`/DB-merge paths), and `Ko-Insight/KoInsight` `master`
`plugins/koinsight.koplugin/db_reader.lua` + `upload.lua` (the unbounded
`SELECT * FROM page_stat_data`, the per-row md5/device-id repetition, the `#body`
`Content-Length`, and the `ui.statistics:insertDB()` pre-sync flush); its `onSuspend`
handler's `os.execute("sleep 0.5")` busy-wait — the "aggressive sync on suspend" pattern
§3.0 explicitly refuses to copy — is in the same plugin.
Unattended sync (§3.0), all read from `koreader/koreader` @
`dcf6e3b426ffca0de52e543c725a8000ea64f105`:
`frontend/device/generic/device.lua` (`:84` suspend timeout, `:462-496` `onPowerEvent`
disabling Wi-Fi, `:481-484` the deadlock warning, `:1099-1101` the `Suspend` broadcast),
`frontend/device/kobo/device.lua:1382-1387` (the "Murder Wi-Fi (again…)" comment naming a
`rerunWhenOnline` in a Suspend handler), `frontend/apps/reader/readerui.lua:883`
(synchronous `CloseDocument`), `frontend/ui/network/manager.lua` (`:82-84` the 45 s
connectivity check, `:182`/`:187`/`:641` the three state queries, `:358` `enableWifi`,
`:605` `beforeWifiAction`, `:621` `afterWifiAction`, `:698` `runWhenOnline`, `:727`
`willRerunWhenOnline`, `:753` `goOnlineToRun`, `:990` the "silently" menu text, `:1007` the
`"prompt"` default, `:1116-1119` the Kobo "Scanning for networks…" InfoMessage),
`frontend/ui/network/networklistener.lua` (`:133-176` `auto_disable_wifi`, `:220-228`
`auto_restore_wifi` → `restore-wifi-async.sh` → `scheduleConnectivityCheck`),
`frontend/ui/time.lua:245`/`:300` (`CLOCK_MONOTONIC` does not advance during suspend),
`plugins/kosync.koplugin/KOSyncQueue.lua` and `kosync.koplugin/main.lua` (`:102-105` and
`:1066-1073` the `wifi_enable_action` consent check, `:942-965` queue-instead-of-connect),
`plugins/statistics.koplugin/main.lua` (`:2672` `onCloseDocument`, `:2689` `onSaveSettings`
15-minute default, `:2694` `onSuspend`), `plugins/wallabag.koplugin/main.lua:885-920` (the
working HTTPS request shape), `frontend/httpasync.lua:138-139` (`verify = "none"`),
`frontend/device/wakeupmgr.lua` + `koreader-base/ffi/rtc.lua:102-140` (real RTC alarms),
`koreader-base/thirdparty/luasec/CMakeLists.txt` (LuaSec 1.3.2) and
`koreader-base/thirdparty/certifi/` (→ `data/ca-bundle.crt`, wired up nowhere).
Upstream incident: koreader issues #12614 and PR #12616 (auto-sync on suspend produced an
unwakeable device; fixed by killing Wi-Fi harder, not by making the sync work).
KoboCloud's actual trigger: `divx118/KoboCloud`
`src/etc/udev/rules.d/97-kobocloud.rules` (`KERNEL=="wlan*", ACTION=="add"`), which also
ships its own ARM `curl` and CA bundle.
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

**Fourth pass (2026-09-29).** KOReader source read at `koreader/koreader@7fedb854` unless a
link says otherwise.

- Firmware and device:
  - Kobo's update endpoint, queried with placeholder ids:
    `api.kobobooks.com/1.0/UpgradeCheck/Device/00000000-0000-0000-0000-000000000391/kobo/4.45.23697/N0`
    (and `…395…`).
  - The Kobo help articles "Kobo eReader Accessibility Features Support" (the 5.x opt-in,
    factory reset, EU-only) and "Missing books, reading stats or notes after Kobo software
    update" (the 6.0 data-loss bug).
  - MobileRead threads t=374547 (5.x on Yocto), t=375417 (6.0.274403 opt-in), t=374991
    (4.46.23836) and t=373709 (4.45.23697).
  - notmarek/KoboTolinoFindings (update.tar, the downgrade package, the P365 limits);
    pgaskin.net/KoboStuff/kobofirmware.html (N365-only links).
  - The Clara BW P365 revision: blog.the-ebook-reader.com 2025-06-10.
  - koinsaari/kobo-netbird (stock SSH on 4.45, no scp/sftp).
  - kobopatch-patches `geoffr.yaml` (the Block WiFi firmware upgrade patch and its
    boot-loop warning).
- KOReader on 5.x and installing:
  - releases v2026.07 / v2026.07.1 / v2026.07.2; PR #12401 (Kobo v5); PR #13648
    (`spaBWTPV`); issues #13197 and #16046 (Wi-Fi reboots); PR #15618 (DHCP after network
    switch); issue #15386 (sleep drain).
  - pgaskin/NickelMenu (5.x unsupported; issue #229); nicoverbruggen/NickelMenu `qt6-1.0`;
    NiLuJe/kfmon (v5 build; issues #24 and #25; `tools/install.sh`).
  - NiLuJe's one-click package post (MobileRead showpost p=3797095).
  - KOReader wiki: Installation on Kobo devices, Installation on MacOS, SSH, OPDS support,
    calibre, News downloader; `doc/Building.md`, `kodev`, `datastorage.lua`,
    `frontend/pluginloader.lua`, `frontend/device/kobo/device.lua`,
    `platform/kobo/koreader.sh`.
- Highlights, exporter and vocabulary:
  - `frontend/docsettings.lua`, `frontend/apps/reader/modules/readerannotation.lua`,
    `readerhighlight.lua`, `readerbookmark.lua`, `readerdictionary.lua`.
  - `plugins/exporter.koplugin/{main,base,clip}.lua` + `target/{json,nextcloud,readwise,
    joplin,xmnote}.lua`, `plugins/vocabbuilder.koplugin/{db,main}.lua`,
    `plugins/cloudstorage.koplugin/*`, `plugins/statistics.koplugin/main.lua` (the
    cloud-sync merge), `plugins/kosync.koplugin/KOSyncQueue.lua`.
  - GeorgeSG/KoInsight @ `d59690f` (`annotation_reader.lua`, `upload.lua`, `call_api.lua`,
    `upload-service.ts`).
  - Billiam/hardcoverapp.koplugin v0.4.0; dani84bs/AnnotationSync.koplugin;
    pickles4evaaaa/mybibliotheca.koplugin; koreader/contrib `provider-old-exporters`;
    Ajatt-Tools/anki.koplugin; FreeLanguageTools/vocabsieve; Dankoy/korvo-to-anki.
- Delivery:
  - `plugins/opds.koplugin/{opdsparser,opdsbrowser,opdsclient}.lua`,
    `frontend/socketutil.lua`, lunarmodules/luasocket `http.lua`.
  - The OPDS 1.2 spec (specs.opds.io); PRs #13946 and #15615 (catalogue sync), #15696
    (OPDS 2), #15065 (News downloader EPUB links).
  - Kobo help: Dropbox, Google Drive, Instapaper, sideloading, file formats; Instapaper's
    Kobo docs; daniel-j/send2ereader.
  - calibre-web Kobo-integration wiki and issue #3714; Calibre-Web-Automated issue #1418;
    Komga's Kobo guide; calibre 8.0 release notes.
  - Supabase docs: storage file limits, functions limits (2 s CPU, 150 s wall, `text/html`
    rewrite), routing, auth headers, signed downloads, `createSignedUploadUrl`
    (supabase/storage-js), and "Delete Objects" (deleting `storage.objects` rows in SQL
    orphans the file — supabase.com/docs/guides/storage/management/delete-objects).
  - Apple Shortcuts "Get Contents of URL"; WebKit bug 194593 (no Web Share Target on iOS).
- Fun and metadata:
  - loeffner/WeatherLockscreen; file99/koreader-live-sleepscreen;
    pxlflux/customisablesleepscreen.koplugin; AndyHazz/bookshelf.koplugin;
    usetrmnl/trmnl-kobo; omer-faruq/assistant.koplugin; fiksr/habitreads.koplugin;
    advokatb/readingstreak.koplugin.
  - sinic/ordboekene-for-lesebrett; xxyzz/wiktionary_stardict;
    anezih/guncel-turkce-sozluk-kindle-kobo-stardict; ordbokapi.org; klartale.no/rss;
    yihong0618/bilingual_book_maker.
  - cloin/libbrary (the OverDrive "thunder" API); `api.nb.no/catalog/v1/items`; the Open
    Library covers API; Hardcover's API getting-started doc.
  - The Supabase OG-image example (satori + resvg).

---

## 14. Round 2 — the app controls the Kobo (05.10.2026)

Built from the owner's feedback after the first install (migration `127`, plugin 1.1;
CLAUDE.md → Books row and **Kobo plugin** hold the settled record):

- **Kobo tab** on the Books page: device status (battery at the last sync, versions,
  whether the latest changes arrived), sleep screen (mode, own images, Bookshelf options),
  466 KOReader settings (catalogue in `docs/kobo/koreader-settings.json`, every key cited
  from the v2026.07.1 source; risky keys left out), menu order, questions asked.
- **Statuses and ratings** set in the app are written into KOReader's sidecars. Nickel is
  never written, so a book read in Kobo's own reader keeps Nickel's status there.
- **News** issues are kept out of the library; **covers** come from the EPUB itself, else
  an online lookup; the book popup edits every detail and takes an uploaded cover.
- **Extras:** goal + streak in KOReader's status bar, capture a task/wish/book from the
  Kobo, ask the app's AI about a selected passage (the key stays on the server).

**Why "Show book cover" could not be picked:** KOReader enables that option only after a
book has been opened in KOReader (`screensaver_menu.lua:51`, `hasLastFile`). The Bookshelf
sleep screen also draws from KOReader's statistics. Books read in Kobo's own reader count
for neither.

**Ideas proposed and not built yet** (agent pass, ranked by value per effort; each was
checked against the KOReader source): "where was I?" when a book is reopened after 7+ days
(last highlights, chapter), a finish-by date that feeds the Daily brief, an evening
streak-saver Web Push, "≈ N pages" on the commute card, two-way vocabulary review,
lookups-per-100-pages ("how hard is this book"), Up next offered at the end of a book,
a battery line in the Home brief.
