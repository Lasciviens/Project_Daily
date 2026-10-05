# Kobo — Phases 3 and 4 setup (library, reading tracker, simpler UI)

The runbook for turning on what PLAN.md Phases 3 and 4 built: the Books library, reading
time from KOReader, automatic downloads of sent books, the morning news, and a simpler
KOReader interface. Follow it in order. The Mac session only runs the block in step 4 —
it does no research.

## 1. Supabase (owner, about 5 minutes)

1. Merge the PR.
2. **SQL Editor** → run `supabase/migrations/126_books_reading.sql`. It only adds tables and
   columns; no existing row changes.
3. **The device secret.** On the Mac: `openssl rand -hex 32 | tr -d '\n' | pbcopy`. In
   Supabase → Edge Functions → Secrets add **`KOBO_SYNC_SECRET`** and paste. Keep it on the
   clipboard for step 4 (or copy it again from where you keep it). Do not paste it into a
   chat.
4. **Deploy:**
   - `kobo-sync` — redeploy, **Enforce JWT Verification OFF** (as before).
   - `book-meta` — new, JWT verification **ON** (the default).
   - `ai-proxy` — redeploy, JWT verification **OFF** (as before).

## 2. On the Kobo, before the Mac block (owner, 1 minute)

1. Wi-Fi on, KOReader open, SSH server on (🛠 → Network → SSH server).
2. 🛠 → More tools → **Plugin management** → untick **Cover browser**. When it asks to
   restart, choose **later**. (Project: Title refuses to load while Cover browser is on.)

## 3. What gets installed

| What | Why | Version / pin | Checked by |
|---|---|---|---|
| `lascisboard.koplugin` | Our plugin: reading time, library, automatic downloads, morning news | this repo | `test-lbcore.lua` |
| Project: Title | A clean cover/list library instead of the stock file browser | `2026.07-v3.8.3` (built for KOReader 2026.07.0–.2) | SHA256 `c407d343…0701d3` |
| App Store | Update plugins from the Kobo itself | `v1.14.0` | SHA256 `52e802f2…40a548` |
| `2-disable-fullyread-progressbars.lua` | Finished books show a trophy, not a full bar | commit `a5a77c83` | SHA256 `6067a66d…765ec537` |
| `2-font-override.lua` | One modern font (Source Sans) across the whole KOReader UI | commit `a5a77c83` | SHA256 `123e23e7…dc591` |
| `2-bookshelf-screensaver.lua` | Sleep screen: recent books as spines that fill like progress bars, the open book standing on top | commit `3e2b4f11` (ameyrk99) | SHA256 `b1a378c7…c847e7` |

Not installed, on purpose: ZenOS and SimpleUI (both refuse to run next to Project: Title),
Menu Customizer (no stated support for 2026.07), the "print edition" header patch (needs
manual tuning). Keep App Store away from Project: Title updates: every Project: Title
release is tied to one KOReader version.

**Updating KOReader later (🛠 → Update):** don't, until Project: Title has a release for the
new KOReader version. Update both in the same sitting, Project: Title over SSH. If KOReader
was updated by mistake and the library looks broken, re-tick Cover browser in Plugin
management until the matching Project: Title is installed.

## 4. The Mac session block

Paste this into the Mac Claude session as-is, with the secret on the clipboard.

````
Execute only. Do not research and do not change anything else. Never print the clipboard
or any secret. Run the steps in order; if any command fails or a checksum does not match,
STOP and paste me the output.

```bash
set -euo pipefail
cd ~/Project_Daily-fresh && git fetch -q origin main && git switch -q --detach origin/main && git log --oneline -1
SECRET=$(pbpaste | tr -d '[:space:]'); echo "secret length: ${#SECRET}"
curl -s -o /dev/null -w "plugin route: %{http_code}\n" "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/kobo-sync/inbox" -H "x-kobo-secret: $SECRET"
```
The plugin route must answer 200 (403 = the secret differs from Supabase, 503 = the secret is not set there, 500 = migration 126 is missing). Otherwise STOP.

```bash
set -euo pipefail
# Read-only check of the Kobo's own library database (counts only — no titles leave the device).
T=$(mktemp -d); scp -q kobo:/mnt/onboard/.kobo/KoboReader.sqlite "$T/kr.sqlite"
scp -q kobo:/mnt/onboard/.kobo/KoboReader.sqlite-wal "$T/kr.sqlite-wal" 2>/dev/null || true
sqlite3 "file:$T/kr.sqlite?mode=ro" "SELECT 'books', COUNT(*) FROM content WHERE ContentType = '6' AND ContentID LIKE 'file:///%' AND (VolumeIndex = -1 OR VolumeIndex IS NULL); SELECT 'with author', COUNT(Attribution) FROM content WHERE ContentType = '6' AND ContentID LIKE 'file:///%'; SELECT 'percent range', MIN(___PercentRead), MAX(___PercentRead) FROM content WHERE ContentType = '6' AND ContentID LIKE 'file:///%'; SELECT 'read status', ReadStatus, COUNT(*) FROM content WHERE ContentType = '6' AND ContentID LIKE 'file:///%' GROUP BY ReadStatus;"
rm -rf "$T"
```
Paste me these numbers (they let me confirm the plugin reads the Kobo's library correctly).

```bash
set -euo pipefail
B=~/KoboBackups/$(date +%F_%H-%M-%S); mkdir -p "$B"
scp -q -r kobo:/mnt/onboard/.adds/koreader/settings "$B/" && echo "settings backed up to $B"
cd ~/Project_Daily-fresh && bash scripts/kobo/deploy-plugin.sh
scp -q scripts/kobo/set-plugin-secret.lua kobo:/tmp/set-plugin-secret.lua
SECRET=$(pbpaste | tr -d '[:space:]'); printf '%s' "$SECRET" | ssh kobo 'cd /mnt/onboard/.adds/koreader && ./luajit /tmp/set-plugin-secret.lua; rm -f /tmp/set-plugin-secret.lua'
```

```bash
set -euo pipefail
W=~/KoboInstall/ui-$(date +%F); mkdir -p "$W" && cd "$W"
curl -fsSL -o ProjectTitle.zip https://github.com/joshuacant/ProjectTitle/releases/download/2026.07-v3.8.3/ProjectTitle-2026-07-01-v3-8-3.zip
curl -fsSL -o appstore.zip https://github.com/omer-faruq/appstore.koplugin/releases/download/v1.14.0/appstore.koplugin.zip
P=https://raw.githubusercontent.com/joshuacant/KOReader.patches/a5a77c83ee8e214a5d867cdfa82198cfd6c4d030
curl -fsSL -o 2-disable-fullyread-progressbars.lua "$P/2-disable-fullyread-progressbars.lua"
curl -fsSL -o 2-font-override.lua "$P/2-font-override.lua"
curl -fsSL -o 2-bookshelf-screensaver.lua https://raw.githubusercontent.com/ameyrk99/koreader-bookshelf-screensaver/3e2b4f11a2cfa1ffda79f338234485c9cf649a11/patches/2-bookshelf-screensaver.lua
shasum -a 256 -c <<'SUMS'
c407d3432190c982dda52c99d6e51f89f004203ed7d8935cd27bf8f51c0701d3  ProjectTitle.zip
52e802f2d18d1efc576aa489ded1781e2592ea82fa614cd4244632ce3140a548  appstore.zip
6067a66d626e16bb619cc8b003cee22ff28b497eb5f2025b4dfaeff3765ec537  2-disable-fullyread-progressbars.lua
123e23e7fd321d1c203dfb752315da9f6ebdfd6c1cb8218700d00d73b20dc591  2-font-override.lua
b1a378c7c521758e32b89004133cd873e39611a71fe067766c796fc249c847e7  2-bookshelf-screensaver.lua
SUMS
rm -rf pt as && mkdir pt as && unzip -q ProjectTitle.zip -d pt && unzip -q appstore.zip -d as
PT=$(find pt -maxdepth 3 -type d -name 'projecttitle.koplugin' | head -1); AS=$(find as -maxdepth 3 -type d -name 'appstore.koplugin' | head -1)
echo "found: $PT | $AS"; test -n "$PT" && test -f "$PT/main.lua" && test -n "$AS" && test -f "$AS/main.lua"
ssh kobo 'mkdir -p /mnt/onboard/.adds/koreader/patches'
COPYFILE_DISABLE=1 scp -q -r "$PT" "$AS" kobo:/mnt/onboard/.adds/koreader/plugins/
COPYFILE_DISABLE=1 scp -q 2-disable-fullyread-progressbars.lua 2-font-override.lua 2-bookshelf-screensaver.lua kobo:/mnt/onboard/.adds/koreader/patches/
ssh kobo 'cd /mnt/onboard/.adds/koreader && ls -d plugins/lascisboard.koplugin plugins/projecttitle.koplugin plugins/appstore.koplugin && ls patches'
```
Paste me all the output.
````

## 5. On the Kobo, after the block (owner, 2 minutes)

1. Exit KOReader and open it again from NickelMenu. Project: Title opens with its own look.
   The first time, let it **Extract and cache book information** (it offers this).
2. 🛠 → Network: turn on **Restore Wi-Fi connection on resume** and **Disable Wi-Fi
   connection when inactive**. These two are what make syncing automatic.
3. ⚙ → Screen → Sleep screen → Wallpaper → **Bookshelf**. (Its options are under
   Wallpaper → Bookshelf Settings; the defaults are fine.)
4. 🛠 → **Lasci's Board** → **Sync now**. It sends the whole library and every reading
   minute KOReader has recorded so far.

## 6. Check (the gates)

- Books → **Library** lists every book on the Kobo exactly once, unopened ones too.
  Duplicates show as "look like the same book" with a Merge button.
- Books → **Reading** shows today's minutes and the last days.
- Put the Kobo to sleep with a book open: the sleep screen shows the bookshelf with that book standing on top.
- Send a book from the phone, turn the Kobo's screen on: the book lands in
  *Send to Kobo* by itself and the inbox row says downloaded.
- The next morning (after 05:00, first Wi-Fi wake in the file browser) the news syncs by
  itself.
- A night with Wi-Fi off shows as "not heard from the Kobo since …", never as a broken
  streak.

## 7. Plugin 1.1 — control from the app (round 2)

**Supabase (owner):** merge the PR, run `supabase/migrations/127_kobo_control.sql`, then
redeploy **`kobo-sync`** (Enforce JWT Verification **OFF**) and **`book-meta`** (JWT ON).
The secret does not change.

**On the Kobo first:** Wi-Fi on, KOReader open in the file browser, SSH server on.

**Mac block** (paste as-is):

````
Execute only. Do not research and do not change anything else. Run the steps in order;
if any command fails, STOP and paste me the output.

```bash
set -euo pipefail
cd ~/Project_Daily-fresh && git fetch -q origin main && git switch -q --detach origin/main && git log --oneline -1
B=~/KoboBackups/$(date +%F_%H-%M-%S); mkdir -p "$B"
scp -q -r kobo:/mnt/onboard/.adds/koreader/settings "$B/" && echo "settings backed up to $B"
bash scripts/kobo/deploy-plugin.sh
ssh kobo 'cd /mnt/onboard/.adds/koreader/plugins/lascisboard.koplugin && grep -m1 "VERSION =" main.lua && ls'
```
Paste me all the output.
````

**Then on the Kobo:** exit KOReader and open it again. Open any book once (this is what
makes "Cover of the book you are reading" possible on the sleep screen), go back to the
library, then 🛠 → **Lasci's Board** (now first in the list) → **Sync now**. The Kobo tab
on the website fills in after this sync: its values, its menus, the battery.

**Check:**
- Books → Kobo shows the device, "Your changes: None yet", the settings with "On the Kobo: …".
- Change the sleep screen on the website, Sync now on the Kobo, put it to sleep: the new one shows.
- Mark a book Finished on the website, Sync now: the book shows finished in KOReader.
- While reading, the bottom bar shows "x/20 min · n days".
- Select a sentence → **Ask Lasci's AI** → Explain: an answer appears (Wi-Fi on).
- 🛠 → Lasci's Board → **Capture a note…** → Task: it appears in Tasks · Inbox.

## 8. Plugin 1.2 — storage, the full reading menu, sizes and subjects (round 3)

**Supabase (owner):** merge the PR, run `supabase/migrations/128_books_browse.sql`, **then**
redeploy **`kobo-sync`** (Enforce JWT Verification **OFF**). Order matters: the new
`kobo-sync` reads the columns 128 adds, so deploying it first makes every sync fail.

**What 1.2 adds:** the Kobo's storage (total and free) with every sync; each book's file
size and its subjects (read from the cover browser's book-info cache, read-only); the
whole "While reading" menu (1.1 sent it before KOReader had built it, so most items had
no name), sent again once after the update.

**On the Kobo first:** Wi-Fi on, KOReader open in the file browser, SSH server on.

**Mac block** (paste as-is):

````
Execute only. Do not research and do not change anything else. Run the steps in order;
if any command fails, STOP and paste me the output.

```bash
set -euo pipefail
cd ~/Project_Daily-fresh && git fetch -q origin main && git switch -q --detach origin/main && git log --oneline -1
B=~/KoboBackups/$(date +%F_%H-%M-%S); mkdir -p "$B"
scp -q -r kobo:/mnt/onboard/.adds/koreader/settings "$B/" && echo "settings backed up to $B"
bash scripts/kobo/deploy-plugin.sh
ssh kobo 'cd /mnt/onboard/.adds/koreader/plugins/lascisboard.koplugin && grep -m1 "VERSION =" main.lua && ls'
```
Paste me all the output.
````

**Then on the Kobo:** exit KOReader and open it again. Open any book, wait a moment,
go back to the library, then 🛠 → **Lasci's Board** → **Sync now**.

**Check:**
- Books → Kobo → Overview: the Storage card shows free space and what fills it.
- Books → Kobo → Menu order → While reading: every item has a name, no warning.
- Books → Library → Subjects: subjects from your EPUB files appear.

## Undo

- Our plugin: delete `.adds/koreader/plugins/lascisboard.koplugin` (and
  `settings/lascisboard.lua`).
- Project: Title: delete `plugins/projecttitle.koplugin`, then re-tick Cover browser in
  Plugin management.
- Patches: delete the three files in `.adds/koreader/patches/` (pick another sleep screen first
  if Bookshelf is selected).
- Settings: the block's backup is in `~/KoboBackups/<date>/settings`.
- Menu order from the app: delete `settings/filemanager_menu_order.lua` and
  `settings/reader_menu_order.lua` (or Reset on the website's Kobo tab), restart KOReader.
- Sleep images from the app: the folder `.adds/koreader/lascisboard-sleep`.
