# Kobo — reference (KOReader facts, the firmware rule, what is left)

> The lasting part of the Kobo plan. The whole plan as it was written — the research passes,
> the phases as planned, the owner's checklists and decisions — is kept unchanged in
> [`docs/archive/kobo-PLAN.md`](../archive/kobo-PLAN.md).
>
> - **What is built and how it works:** [`docs/features/books.md`](../features/books.md) — the
>   Books page, `kobo-sync` and the plugin. Rounds 3 and 4 (plugins 1.2 and 1.3) are documented
>   there only.
> - **Installing, updating and removing the plugin:** [`SETUP.md`](SETUP.md). Plugin 1.4 (the
>   server-certificate check) is described there and in §3.0 below.
> - **Section numbers are the original plan's**, so a code comment that cites
>   `docs/kobo/PLAN.md §3.0` or `§8.2` finds the same text here. Sections 0, 7 and 12 (the
>   one-page overview, the plan's own mistakes, the owner's checklists) are in the archive only;
>   §4.2, §4.4, §4.6 and §11 are short summaries of what was built. §2.4 is new (it holds what the plan
>   kept under "Phase 3").
>
> Status (13.10.2026): Phases 0–4 and the rounds that followed are built (plugin 1.4.0 in
> `scripts/kobo/lascisboard.koplugin`). Phases 5 and 6 (§11) and the ideas in §14 are not.
>
> **Every KOReader claim was verified by reading `koreader/koreader` @
> `dcf6e3b426ffca0de52e543c725a8000ea64f105`**; the fourth pass (29.09.2026) read `7fedb854`
> and says so where it matters, and the plugin itself was checked against v2026.07.1. The
> `file:line` citations are the point of this document — keep them when editing it.

---

## 1. The device, as it actually is

| Fact | Value |
|---|---|
| Model | Kobo Clara BW (2024), **P365** (product id 395, codename `spaBWTPV`) — device report, 04.10.2026. The last three characters of `.kobo/version` tell the revision: **`391` = N365** (`spaBW`), **`395` = P365** (made by TPV, larger battery). KOReader reads it the same way (`frontend/device/kobo/device.lua`). |
| Firmware | **4.45.23792** (build `0af4c82936`, 30.07.2026) at the 30.09.2026 check — the 4.x line. Kobo's update server offers 4.45 devices **4.46.23836** (24.08.2026), still 4.x (§1.1). |
| KOReader | **v2026.07.1** (`koreader-kobo`, not `kobov5`), started from NickelMenu v0.6.0 — installed 04.10.2026 (§10.4). |
| Library | Almost entirely sideloaded EPUB, no store purchases. Rare Deichman library loans are read in Nickel and **deliberately not tracked** (§2.3). |
| Mac access | SSH key `~/.ssh/kobo_ed25519`, `Host kobo` in `~/.ssh/config` (user root, port 2222); repo clone `~/Project_Daily-fresh`; backups under `~/KoboBackups/`. |

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

### 1.1 The firmware rule

**The rule:** never accept a Kobo 5.x/6.x update — it arrives as an opt-in "accessibility"
or "optional update" prompt — and never update KOReader without a matching Project: Title
release ([`SETUP.md`](SETUP.md) §5). A 4.x minor update (4.46) is fine. Nothing needs to be
blocked: Kobo has no update switch, and KOReader's own Wi-Fi cannot trigger a Kobo update
because Nickel is not running while KOReader is.

The evidence behind the rule (fourth pass, 29.09.2026; sources in §13):

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

### 2.4 Reading Nickel's library database — query details

The plugin opens `KoboReader.sqlite` **read-only** on the device (Nickel is not running while
KOReader is), because Nickel's `content` table is the **only** complete inventory of what is
on the Kobo: KOReader writes a book into `statistics.sqlite3` only once it has been opened.
No reading time is taken from it — `content.TimeSpentReading` is a lifetime aggregate per
book with no day resolution (§2.1, §2.3). The plan had this as a browser import (roadmap
Phase 3); the plugin does it instead, daily (§11).

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
  `content.BookTitle` the book. **Not used by the plugin** (highlights come from KOReader);
  retained only as reference in case a one-off rescue of pre-KOReader highlights is ever
  wanted.
- Text and date fields are **sometimes hex-encoded** and paths are URI-encoded; both need
  decoding. Titles are stored in sort form ("Vegetarian, The").
- **Work on a copy, opened read-only.** Nickel is a live writer. Never delete
  `-journal`/`-wal` files to "unlock" anything.

---

## 3. Sync design — the KOReader facts behind the plugin

What the plugin does is in [`docs/features/books.md`](../features/books.md) → *Kobo plugin*.
This section keeps why it is built that way: the KOReader behaviour each choice rests on.

### 3.0 Unattended sync

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

#### TLS — HTTPS works; checking the certificate is the plugin's job

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
pointing at that bundle. **As built:** the bundle is present on this Kobo (checked
04.10.2026), and plugin 1.4 (11.10.2026) passes it to LuaSec **and** checks that the
certificate is issued for the server's name, which LuaSec does not do by itself
(`verifiedCreate()` in `main.lua`, tested against LuaSec 1.3.2 by
`scripts/kobo/test-tls.sh`). The plugin's Settings can switch the check off if a sync ever
fails with a certificate error ([`SETUP.md`](SETUP.md) §6).

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

### 3.0.1 Our own plugin — decided 30.09.2026

The owner chose option A: our own plugin, `lascisboard.koplugin`, licensed
AGPL-3.0-or-later (licensing below). The alternatives were BookOrbit's plugin with our server
implementing its contract (B), running BookOrbit itself (C), or KoInsight's plugin as a
stopgap (D — it re-sends the whole history on every sync, sends no auth header, and syncs by
busy-waiting on suspend). The deciding fact: zero-tap Send to Kobo, a sleep screen driven by
the app and vocabulary sync all need device-side code neither plugin has, so B or D would
still have meant a second plugin of our own. The full comparison is in the archive.

**BookOrbit** (`github.com/bookorbit/bookorbit`, `koreader-plugin/bookorbit.koplugin/`)
ships, in tested code, the architecture §3.0 arrives at independently: capture on
close/suspend into an on-disk outbox (`bookorbit_lifecycle_outbox.lua`), drain on
`NetworkConnected`, no `NetworkMgr:enableWifi` call anywhere, HTTPS with no TLS options set.
Its outbox refuses a new entry at its hard limit (1000 entries / 200 MiB) instead of evicting
an old one, and parks an entry after `MAX_ATTEMPTS = 5`. Its every-N-pages push carries
progress only, never statistics. Its licence is `AGPL-3.0-only` **plus**
`ADDITIONAL_TERMS.md` (a prominent, non-removable "Powered by BookOrbit" notice), which
travels with any reused code — we reuse none.

#### BookOrbit's server contract, read from its source

Worth keeping, because these are the decisions a stats sync has to get right
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

Licensing our plugin **AGPL-3.0-or-later** — matching KOReader itself and `koreader/contrib`,
and what option A did — sidesteps the derivative-work question rather than betting on an
answer, at no cost to us.

### The plugin's triggers

**As built (05.10.2026):** the outbox is `statistics.sqlite3` itself plus the cursor below —
a separate queue would only copy rows KOReader already keeps durably — so close and suspend
capture nothing. On `NetworkConnected` (at most every 10 minutes) and when a book closes while
the device is already online, the plugin sends what the cursor has not sent yet; *Sync now*
always runs. It never turns Wi-Fi on. The plan's trigger design, kept for the KOReader facts
it rests on:

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
   They are what turn (2) from a hook into an actual unattended sync ([`SETUP.md`](SETUP.md)
   §2.3 turns them on).
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

### Incremental sync — why the cursor exists

**As built:** a `start_time` cursor with one day of lookback on the first batch, 2,000 rows per
request, advanced only after a 2xx; *Send everything again* in the plugin's Settings resets it
(always safe — the server's unique key drops repeats). The reasoning:

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
  contained in that acked batch** — never to "now". This is the same lesson
  `google-tasks-sync`'s `last_success_at` taught: advancing a cursor past data that was not
  actually processed permanently skips it. (As built, a batch is 2,000 rows.)
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

## 4. Server side — the rules `kobo-sync` keeps

### 4.1 Ingest — `kobo-sync`

Its own function and its own device secret, like `esde-sync`: **a different physical device
with a different lifecycle gets its own door.** Revoking the Kobo never revokes the RP6
handheld or the iPhone.

- **Plugin routes**, header `x-kobo-secret` == `KOBO_SYNC_SECRET`: `POST …/sync`,
  `GET …/inbox`, `POST …/deliveries/<id>/ack`, `POST …/applied`, `POST …/cover/<md5>`,
  `POST …/capture`, `POST …/ask`.
- **OPDS routes**, authorised by their **own** path token `KOBO_OPDS_TOKEN`:
  `GET …/opds/<token>/` and `…/opds/<token>/books/<id>/<name>`; the daily sweep cron calls
  `POST …/sweep` with `x-kobo-token`. A feed URL is easy to leak (it sits in KOReader's
  catalogue list and in logs) and can only list and download inbox files, so it gets its own
  secret: rotating either one leaves the other working.
- Acts as the single user (`HEVY_USER_ID`) server-side with the service-role key, which never
  reaches the device. Platform JWT verification is off (listed in `supabase/config.toml`); like
  every function it deploys on merge.
- The sync contract is pure code shared with the app: `readingSync.ts` and `opdsFeed.ts` in
  `src/features/books/` are GENERATED into the function by `scripts/sync-kobo-shared.mjs`.
- Every batch is independent and idempotent, so a retry or a full re-push is always safe.

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
  the server already holds: the cursor's deliberate lookback window, the plugin's *Send
  everything again* action, and any batch retried after an unconfirmed response. Insert through
  `UNIQUE (user_id, book_id, page, started_at)` with **ignore-on-conflict, never an
  update** — a re-send must not be able to change a stored duration, and a
  partially-applied batch must be safe to replay whole. The response should report how many
  rows were genuinely new, so a drain that did nothing is visible rather than looking like
  a successful sync.
- **Every request carries a `last_seen`** (the device's own clock at send time); as built
  it is stamped on `kobo_feed_state.last_seen_at` when a drain completes (migration 126).
  This is what lets the UI say *"not heard from the device since ‹timestamp›"* instead of
  rendering a silent zero — see §5. It is the one piece of state the sync exists to carry that is not a page event.

### 4.2 Schema — built

Built in migrations `125` (`book_deliveries`, the private `kobo-inbox` bucket), `126`
(`books`, `reading_page_events`, `reading_settings`), `127` (device config and state, sleep
images, captures, AI notes, covers) and `128` (browsing columns, the news rules); described in
[`docs/features/books.md`](../features/books.md). Rules the schema keeps:

- `reading_page_events` is point-in-time grain, aggregated on read (the `health_metrics`
  lesson of migration 041), with `UNIQUE (user_id, book_id, page, started_at)` mirroring
  KOReader's own `UNIQUE (id_book, page, start_time)` — that key is what makes any re-send
  safe. It is bulk-synced device data, so it has no `trg_audit`; `books` is user-authored and
  audited.
- `koreader_md5` is the book identity (§4.2.1). Volume is small: ~30 minutes a day at ~30 s a
  page is ~60 rows a day, ~22,000 a year.
- Sidecar status, device → app: `reading` → Reading, `complete` → Finished, `abandoned`
  ("on hold") → Dropped (a book already Paused in the app stays Paused); 1–5 stars → 1–10
  (×2); `percent_finished` → progress. The app → device direction (round 2) is in
  `docs/features/books.md`.
- Not built: `book_highlights` and `book_words` (Phase 5, §11). Their planned shape is in the
  archive's §4.2.

### 4.2.1 Book identity — KOReader's partial MD5

**As built:** `books.koreader_md5` is the identity. The plugin reports KOReader's own
`util.partialMD5` for every book it sends (library walk, sidecars, Nickel's database and the
statistics `book` table alike), and Send to Kobo computes the same value in the browser before
upload (`src/features/books/epub/`, checked by `verify-epub-tools` against node's crypto), so
both paths produce one key and the unique index de-duplicates. The algorithm, read from
source:

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

Duplicates stay possible however good the hashing is, so the Library has a manual **Merge**
(`mergeBooks`) and only ever *suggests* pairs:

- Replacing a book's file (a re-download, an EPUB → KEPUB conversion, a metadata rewrite by
  Calibre) changes the bytes and so the md5.
- **KOReader's own `book` table is keyed `UNIQUE (title, authors, md5)`, not by md5 alone**
  (`main.lua`'s `book_title_authors_md5` index), so KOReader itself holds two rows for one
  book across a file replacement and syncs us both.
- A normalised title + author match (case-folded, diacritics and punctuation stripped, a
  leading article stripped, Kobo's sort-form titles undone: "Vegetarian, The" → "the
  vegetarian") is only a suggestion. Auto-merging on a fuzzy title would silently fuse two
  volumes of a series, which is worse than a visible duplicate.

### 4.2.2 Where highlights, notes and book status live (read from source)

Needed for Phase 5 (highlights). Read at `koreader/koreader@7fedb854`:

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

One pure, import-free module — `readingAggregate.ts` — verified by
`scripts/verify-reading-aggregate.cjs` through sucrase, per the no-unit-test-framework
convention. It owns:

- daily minutes from page events, over a bounded date range (never the whole history)
- session reconstruction by clustering page events on a gap threshold
- streak computation against `reading_settings`
- reading speed (pages/hour), and per-book progress

**Do not compute a composite "reading score".** House rule, and the Health feature's
"no derived sleep metrics" precedent.

### 4.4 UI — built

`/books` (Library · Stats · Send to Kobo · Kobo) and Daily's **Reading** glance cell (the
seventh module; Nutrition became `row-span-3` from three columns so every grid stays full)
are described in [`docs/features/books.md`](../features/books.md). The plan's grid arithmetic
for that cell is in the archive's §4.4. `NEVER_HIDES` applies: reading surfaces only ever add
rows; no book or reading predicate goes into a task, media or brief query.

### 4.5 Book metadata and covers

**As built:** `book-meta` (browser JWT) fills only the empty fields of the caller's own
`books` row — Nasjonalbiblioteket first for Norwegian books and ISBNs, then Open Library.
Covers from those sources are linked, never copied; there is no shared catalogue table and
Hardcover is not wired. The plugin uploads a book's own cover from inside the EPUB (public
`book-covers` bucket). The source facts:

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

### 4.6 Storage budget — the Kobo is the library, Supabase only the post office

The Free plan allows **1 GB of file storage in total and 50 MB per file**; over 1 GB the
whole project goes read-only and then answers 402. So books never live in Supabase: a file
stays in the private `kobo-inbox` bucket only until the Kobo has it — deleted 24 h after
download or 7 days unfetched (feed and inbox reads plus a daily cron), always **through the
Storage API**, never by deleting `storage.objects` rows in SQL (that leaves the file behind).
The budget as built (migration 127): game media ≤ 850 MB + Kobo inbox ≤ 100 MB waiting + book
covers ≤ 20 MB + sleep images ≤ 10 MB = 980 MiB. Anything bigger than the inbox allows
(comics, large PDFs) goes over USB or Calibre wireless (§8.1).

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

## 6. Open questions still open

The plan's other questions were answered while building it (all of them, with answers, in the
archive's §6).

1. **How often does `NetworkConnected` actually fire in daily use?** It decides only whether
   the Nickel-side fallback (§3) is ever needed. Answered by living with it: the Kobo card on
   Settings → Subscriptions shows the last sync.
2. **Does an RTC wakeup work on the MediaTek MT8113?** (§3.0.) Only worth prototyping if (1)
   turns out badly, or if a sleep-screen card (§9.2) should refresh itself.
3. **May Nasjonalbiblioteket's catalogue covers be cached?** Its API licence is unconfirmed
   (§4.5), so its covers are linked, not copied.
4. **Is Norway inside Kobo's "EU only" gate for the 5.x accessibility update?** Only matters
   if the owner ever wants those features; the answer to "should we opt in" is no either way
   (§1.1).

---

## 8. Getting books onto the Kobo

Read from source or vendor docs on 29.09.2026; links in §13.

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

### 8.2 Send to Kobo — as built, and KOReader's OPDS rules

Built 04.10.2026 (Phase 2) and made zero-tap 05.10.2026 (Phase 4). The app uploads to the
private `kobo-inbox` bucket; `book_deliveries` tracks each file. The object key is always
`book.<ext>`, because Storage refuses brackets and non-ASCII letters in keys — the real name
stays in `book_deliveries.filename`. The plugin downloads new files on its next Wi-Fi wake into
`/mnt/onboard/Send to Kobo` and acks each one; the server keeps the file 24 h after the ack so a
failed copy can be fetched again. Nickel also shows that folder's books (harmless).

**The fallback is an OPDS catalogue** served by `kobo-sync` (the pure feed builder is
`src/features/books/opdsFeed.ts`, checked by `verify-kobo-feed`), added on the Kobo over SSH
with `scripts/kobo/add-opds-catalog.lua` ([`SETUP.md`](SETUP.md) §2.5). On the Kobo, *Sync all
catalogs* then pulls every new book (up to 50 since the last-seen link). The feed's rules, read
from KOReader's `opdsparser.lua` / `opdsbrowser.lua` / `opdsclient.lua`:

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
- HTTP headers are Latin-1 only, so the download's `Content-Disposition` carries an ASCII
  `filename="…"` fallback plus `filename*`.
- KOReader reads `settings/opds.lua` the first time OPDS is opened and writes its own copy
  back after any OPDS change, so the catalogue file is edited in a fresh KOReader session,
  before OPDS is opened.

**Not built:** the iPhone share-sheet Shortcut (it needs a `phone-gateway` action that hands
out a signed upload URL — `createSignedUploadUrl`, valid 2 h — so the file goes straight to
Storage and never through a function, which has 2 s of CPU), and a static page for Nickel's
beta browser offering `.kepub.epub` downloads (Supabase rewrites `text/html` to `text/plain` on
its default domain, so such a page would live on GitHub Pages).

### 8.3 Web articles

- **Now:** Instapaper's built-in Nickel integration (above). Nothing to build.
- **Later (optional):** a "send this link to the Kobo" action in the app that calls
  Instapaper's Simple API (`POST /api/add`, Basic auth; credentials in Vault, never in the
  client). Or, KOReader-side: Readeck (self-hosted, EPUB export) with `readeck.koplugin`, or
  Wallabag. Converting articles to EPUB ourselves (Readability + `epub-gen-memory` in an
  edge function) is possible, but the 2 s CPU limit makes big pages a risk. Only if the
  Instapaper route disappoints.

---

## 9. Fun features — the menu

**Status (13.10.2026):**
- **Built:** the morning news as an EPUB (the plugin runs the News downloader once a day,
  §9.3); the Bokmål and Wiktionary dictionaries (Phase 1, §9.3); Nasjonalbiblioteket metadata
  (`book-meta`, §9.5); a simpler interface — Project: Title, App Store, two patches and the
  Bookshelf sleep screen (§9.5.1, [`SETUP.md`](SETUP.md) §5); the book in hand with its
  progress on Home's Books tile and Daily's Reading cell (§9.1 "Now reading"); `books` in the
  AI's catalogue and semantic search (§9.1; highlights are not built yet).
- **Built differently:** the on-device AI is **Ask Lasci's AI** in our own plugin (round 2),
  which goes through `kobo-sync` `/ask`, so no key lives on the Kobo and `assistant.koplugin`
  (§9.4) is not needed. The sleep screen is driven from the app (own images, Bookshelf
  options) instead of a rendered "Today" card (§9.2).
- **Picked by the owner, not built:** the reading heatmap and year in books (§9.1, Phase 6).
- **Dropped:** "Can I borrow it at Deichman?" (§9.5).
- Everything else below is still only on the menu.

Researched 29.09.2026. Each item says what it is, what it depends on, a rough effort
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
    ([example](https://supabase.com/docs/guides/functions/examples/og-image)). Check that a WASM
    bundle survives the merge deploy (`supabase functions deploy --use-api`) and the 2 s CPU
    budget before relying on it. A cheaper first version skips the PNG and sets KOReader's sleep-screen *message* text instead.
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
owner will ask for changes if wanted. Install steps: [`SETUP.md`](SETUP.md) §5.

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
  open the copy read-only. Never delete `-wal`/`-journal` files (§2.4).
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
  put on the device over SSH from the clipboard (`set-plugin-secret.lua`,
  `add-opds-catalog.lua` — [`SETUP.md`](SETUP.md) §4), never typed into a chat.
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

**Notes from the install on 04.10.2026:**
- NickelMenu's entry appeared after the reboot (the 4.45 risk above did not happen here). The
  `ExcludeSyncFolders` line was appended (no `[FeatureSettings]` section existed).
- **The Kobo's file-system check renamed files macOS had written.** KOReader crashed on its
  first launch ("module 'apps/filemanager/filemanagerbookinfo' not found"): the check that
  runs on the reboot after an eject had renamed 8 of the copied files to `FSCK0000.000`
  (contents intact, names lost; all in folders with many similarly prefixed names, so the 8.3
  short names macOS generates are the likely cause). The fix was to copy the 8 back, delete
  the `FSCK*` duplicates, let the Kobo run its check once more, then verify (`find … -name
  'FSCK*'` empty, `diff -rq` against the zip clean). **After any big copy from the Mac, run the
  same `FSCK*` check.** If it recurs, install through a `KoboRoot.tgz` with
  `mnt/onboard/.adds/koreader/…` paths (built with `COPYFILE_DISABLE=1 tar --no-xattrs`), so
  the Kobo writes the files itself. Copying over SSH (`scp`) avoids it: the Kobo's own Linux
  writes the names.
- The Wi-Fi reboot bugs (#13197, #16046) did not hit this device: 10 toggles, a restart with
  Wi-Fi on and a sleep/wake all passed.
- KOReader's dropbear accepts a root password unless **SSH server → "Login with key only"** is
  ticked (it passes `-s`; it can be changed only while the server is stopped). It is ticked.
- Plugging the cable in while KOReader runs with the SSH server on shows "Filesystem is busy
  (dropbear)" — exit KOReader before a USB copy.
- `statistics.sqlite3` is in WAL mode: a copied file opens with
  `sqlite3 'file:…?mode=ro&immutable=1'`, not `-readonly`. Copy it together with any
  `-wal`/`-shm` files that exist.

### 10.5 The plugin's development loop (Phase 4 onwards)

- **Where the code lives:** `scripts/kobo/lascisboard.koplugin/` in this repo.
  - Either AI may change it; claim the files on the task board
    (`docs/codex-shortcuts.md`) first, like any file in the repo.
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
- **On the device:** `scripts/kobo/deploy-plugin.sh` copies the plugin's `.lua` files over
  KOReader's SSH (dropbear, port 2222, user root; key in
  `.adds/koreader/settings/SSH/authorized_keys`; SFTP included, so OpenSSH ≥ 9 `scp` works;
  runs only while KOReader runs with Wi-Fi on). SSH, not USB, so the Kobo's own Linux writes
  the file names (§10.4's notes). The runbook is [`SETUP.md`](SETUP.md) §3.

  Then restart KOReader. Logs are in `.adds/koreader/crash.log`; turn on verbose debug
  logging under Developer options.

### 10.6 The first thing the Mac session does (Phase 0, read-only)

A `scripts/kobo/device-report.sh` that prints, and changes nothing:
- `.kobo/version`: firmware, and product id `391`/`395` → N365/P365;
- free space;
- counts of `.epub` / `.kepub.epub` / `.pdf` in the library;
- the installed KOReader version;
- whether `.adds/koreader/data/ca-bundle.crt` exists (it does on this Kobo; plugin 1.4
  checks the server certificate against it, §3.0).

The output contains no titles and no reading data, so it can be pasted into a chat.

---

## 11. Phases — built and left

The plan's phases with their gates and the owner's steps are in the archive's §11.

| Phase | What | State |
|---|---|---|
| 0 | Device ready: backup, KOReader 2026.07.1 + NickelMenu, Wi-Fi reboot tests, SSH key-only | Gate passed 04.10.2026 |
| 1 | Books with zero code: Calibre wireless, Instapaper, dictionaries, news feeds | Prepared 04.10.2026 (the dictionary lookup test was dropped, 05.10.2026) |
| 2 | Send to Kobo v1 (OPDS) — migration 125 | Built; gate passed on the device 04.10.2026 |
| 3 | Books page and library — migration 126 | Built 05.10.2026; the inventory comes from the plugin, not a browser import (§2.4) |
| 4 | Reading tracker, zero-tap Send to Kobo, morning news — the plugin and `kobo-sync`'s write routes | Built 05.10.2026 |
| Round 2 | The app controls the Kobo — migration 127, plugin 1.1 (§14) | Built 05.10.2026 |
| Round 3 | Library browsing, Send to Kobo preview, storage card — migration 128, plugin 1.2 | Built 05.10.2026 ([`docs/features/books.md`](../features/books.md)) |
| Round 4 | Time and list settings, the Kobo's own fonts — plugin 1.3 | Built 06.10.2026 ([`docs/features/books.md`](../features/books.md)) |
| Security | The server certificate is checked — plugin 1.4 | Built 11.10.2026 ([`SETUP.md`](SETUP.md)) |
| 5 | Highlights, notes and words | **Not built** |
| 6 | Fun: the reading heatmap and year in books | **Not built** |

### Phase 5 — Highlights, notes and words (medium)

**To build:**
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
- the on-device AI reading companion (§9.4).

Still on the menu: the sleep-screen "Today" message and Norwegian words of the day.

The owner's other Phase 6 pick, the on-device AI reading companion, was built differently in
round 2: **Ask Lasci's AI** (§9 status).

For Phase 5, the ingest facts are in §4.2.2 (sidecar annotations) and §9.3 (the Vocabulary
Builder database); the planned tables are in the archive's §4.2.

### Fallback — the Nickel-side trigger

Only if Phase 4's Wi-Fi window proves too rare in daily use (§3).

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

**Fourth pass (29.09.2026).** KOReader source read at `koreader/koreader@7fedb854` unless a
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
  - The Clara BW P365 revision: blog.the-ebook-reader.com, 10.06.2025.
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

## 14. Round 2 — the app controls the Kobo (05.10.2026), and ideas not built yet

Built from the owner's feedback after the first install (migration `127`, plugin 1.1;
[`docs/features/books.md`](../features/books.md) holds the settled record, together with
rounds 3 and 4 — plugins 1.2 and 1.3 — which followed on 05.10.2026 and 06.10.2026):

- **Kobo tab** on the Books page: device status (battery at the last sync, versions,
  whether the latest changes arrived), sleep screen (mode, own images, Bookshelf options),
  457 KOReader settings (catalogue in `docs/kobo/koreader-settings.json`, every key cited
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
