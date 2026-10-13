# Kobo — setup runbook (the plugin, its secret, Project: Title)

The steps that run on the Kobo and on the Mac: installing our KOReader plugin
`lascisboard.koplugin` from scratch, updating it, setting or changing its secret, the
Project: Title library look, and removing it all again.

**Nothing to do in Supabase.** The Kobo's server side was set up long ago (migrations
`125`–`128`, the secrets `KOBO_SYNC_SECRET` and `KOBO_OPDS_TOKEN`). Later server changes ship
with a merged PR: migrations numbered above 140 run by themselves on merge and every edge
function, `kobo-sync` included, deploys on merge (`docs/deploy-setup.md`). The only Supabase
step left for a person is changing a secret (§4.3, the owner's job).

What the feature does: [`docs/features/books.md`](../features/books.md). Why it is built
this way, the firmware rule and the device's facts: [`REFERENCE.md`](REFERENCE.md). The
plan as it was written: [`docs/archive/kobo-PLAN.md`](../archive/kobo-PLAN.md).

## 1. What is already in place

- **The Kobo:** Clara BW (P365) on 4.x firmware with KOReader v2026.07.1 and NickelMenu
  (REFERENCE.md §1, §10.4). **Never accept a Kobo 5.x/6.x update and never update KOReader
  without a matching Project: Title release** (REFERENCE.md §1.1, §5 below).
- **The Mac:** this repo cloned at `~/Project_Daily-fresh`, an SSH key `~/.ssh/kobo_ed25519`
  and `Host kobo` in `~/.ssh/config` (user root, port 2222), and the macOS settings that stop
  Finder littering the Kobo (REFERENCE.md §10.2).
- **The secrets** are set in Supabase → Edge Functions → Secrets: `KOBO_SYNC_SECRET` (the
  plugin's routes) and `KOBO_OPDS_TOKEN` (the OPDS catalogue; also in Vault for the sweep
  cron). Their values are kept by the owner, never pasted into a chat: the Mac blocks below
  read them from the clipboard and never print them.

**Before every Mac block, on the Kobo:** Wi-Fi on, KOReader open in the file browser (not in
a book), SSH server on (🛠 → Network → SSH server). Don't plug the USB cable in while the SSH
server runs ("Filesystem is busy (dropbear)").

**Writing these blocks:** one step per line. Under `set -e` a failure in the middle of an
`a && b && c` chain does NOT stop the script (only the last command of a chain counts), so a
failed `git fetch` or backup `scp` would let the deploy run anyway. Chains are fine only
inside one `ssh kobo '…'` command, whose exit status is checked as a whole.

## 2. Fresh install of the plugin

For a Kobo that has KOReader but not our plugin (a new device, or after §7).

### 2.1 On the Kobo first (1 minute)

1. Wi-Fi on, KOReader open, SSH server on.
2. 🛠 → More tools → **Plugin management** → untick **Cover browser**. When it asks to
   restart, choose **later**. (Project: Title refuses to load while Cover browser is on.)

### 2.2 The Mac block

Copy `KOBO_SYNC_SECRET`'s value to the clipboard, then paste this into the Mac Claude session
as-is:

````
Execute only. Do not research and do not change anything else. Never print the clipboard
or any secret. Run the steps in order; if any command fails or a checksum does not match,
STOP and paste me the output.

```bash
set -euo pipefail
cd ~/Project_Daily-fresh
git fetch -q origin main
git switch -q --detach origin/main
git log --oneline -1
SECRET=$(pbpaste | tr -d '[:space:]'); echo "secret length: ${#SECRET}"
curl -s -o /dev/null -w "plugin route: %{http_code}\n" "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/kobo-sync/inbox" -H "x-kobo-secret: $SECRET"
```
The plugin route must answer 200 (403 = the secret on the clipboard differs from Supabase's,
503 = the secret is not set in Supabase). Anything else: STOP.

```bash
set -euo pipefail
B=~/KoboBackups/$(date +%F_%H-%M-%S); mkdir -p "$B"
scp -q -r kobo:/mnt/onboard/.adds/koreader/settings "$B/"
echo "settings backed up to $B"
cd ~/Project_Daily-fresh
bash scripts/kobo/deploy-plugin.sh
scp -q scripts/kobo/set-plugin-secret.lua kobo:/tmp/set-plugin-secret.lua
SECRET=$(pbpaste | tr -d '[:space:]'); printf '%s' "$SECRET" | ssh kobo 'cd /mnt/onboard/.adds/koreader && ./luajit /tmp/set-plugin-secret.lua; s=$?; rm -f /tmp/set-plugin-secret.lua; exit $s'
ssh kobo 'cd /mnt/onboard/.adds/koreader/plugins/lascisboard.koplugin && grep -m1 "VERSION =" main.lua'
```

```bash
set -euo pipefail
W=~/KoboInstall/ui-$(date +%F); mkdir -p "$W"
cd "$W"
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
rm -rf pt as
mkdir pt as
unzip -q ProjectTitle.zip -d pt
unzip -q appstore.zip -d as
PT=$(find pt -maxdepth 3 -type d -name 'projecttitle.koplugin' | head -1); AS=$(find as -maxdepth 3 -type d -name 'appstore.koplugin' | head -1)
echo "found: $PT | $AS"; test -n "$PT"
test -f "$PT/main.lua"
test -n "$AS"
test -f "$AS/main.lua"
ssh kobo 'mkdir -p /mnt/onboard/.adds/koreader/patches'
COPYFILE_DISABLE=1 scp -q -r "$PT" "$AS" kobo:/mnt/onboard/.adds/koreader/plugins/
COPYFILE_DISABLE=1 scp -q 2-disable-fullyread-progressbars.lua 2-font-override.lua 2-bookshelf-screensaver.lua kobo:/mnt/onboard/.adds/koreader/patches/
ssh kobo 'cd /mnt/onboard/.adds/koreader && ls -d plugins/lascisboard.koplugin plugins/projecttitle.koplugin plugins/appstore.koplugin && ls patches'
```
Paste me all the output.
````

The third block installs Project: Title, App Store and the patches (§5). Skip it when they are
already on the Kobo.

### 2.3 On the Kobo after the block (2 minutes)

1. Exit KOReader and open it again from NickelMenu. Project: Title opens with its own look.
   The first time, let it **Extract and cache book information** (it offers this).
2. 🛠 → Network: turn on **Restore Wi-Fi connection on resume** and **Disable Wi-Fi
   connection when inactive**. These two are what make syncing automatic; the plugin never
   turns Wi-Fi on by itself (REFERENCE.md §3.0).
3. ⚙ → Screen → Sleep screen → Wallpaper → **Bookshelf** (its options are under Wallpaper →
   Bookshelf Settings; the defaults are fine), or leave the sleep screen to the website's
   Books → Kobo → Sleep screen.
4. Open any book, then close it. The plugin captures the reading menu when a book is
   closed, and "Cover of the book you are reading" can be picked as a sleep screen only
   after a book has been opened in KOReader.
5. Back in the library: 🛠 → **Lasci's Board** → **Sync now**. The first sync sends the whole
   library and every reading minute KOReader has recorded so far.

### 2.4 Check

- 🛠 → Lasci's Board → **Status**: a fresh "Last sync", "Device secret: set", "Restore Wi-Fi
  on resume: on", and the plugin version (1.4.0 today; `VERSION` in `main.lua`).
- Books → **Library** lists every book on the Kobo exactly once, unopened ones too. Likely
  duplicates show with a Merge button.
- Books → **Stats** shows today's minutes and the last days.
- Books → **Kobo** shows the device (battery, versions, storage) and the settings with "On
  the Kobo: …"; Settings → Subscriptions → Kobo shows the last sync.
- Send a book from the phone, turn the Kobo's screen on: the book lands in *Send to Kobo*
  by itself and its row in Books → Send to Kobo says downloaded.
- Change the sleep screen on the website, Sync now on the Kobo, put it to sleep: the new one
  shows. Mark a book Finished on the website, Sync now: it shows finished in KOReader.
- While reading, the bottom bar shows "x/20 min · n days".
- Select a sentence → **Ask Lasci's AI** → Explain: an answer appears (Wi-Fi on).
- 🛠 → Lasci's Board → **Capture a note…** → Task: it appears in Tasks · Inbox.
- The next morning (after 05:00, the first Wi-Fi wake in the file browser) the news syncs by
  itself. A night with Wi-Fi off shows as "not heard from the Kobo since …", never as a
  broken streak.

### 2.5 Optional: the Send to Kobo catalogue (OPDS fallback)

The plugin downloads sent books by itself. The OPDS catalogue is a fallback that works
without the plugin: KOReader → OPDS catalog → **Lasci's Board** → *Sync all catalogs*. It is
added over SSH so nobody types the 90-character address. Run it in a **fresh KOReader
session, before OPDS catalog is opened** (KOReader reads `settings/opds.lua` on the first
open and writes its own copy back after any OPDS change). Copy `KOBO_OPDS_TOKEN`'s value to
the clipboard, then:

````
Execute only. Do not research and do not change anything else. Never print the clipboard
or any secret. If any command fails, STOP and paste me the output.

```bash
set -euo pipefail
cd ~/Project_Daily-fresh
git fetch -q origin main
git switch -q --detach origin/main
B=~/KoboBackups/$(date +%F_%H-%M-%S); mkdir -p "$B"
scp -q -r kobo:/mnt/onboard/.adds/koreader/settings "$B/"
echo "settings backed up to $B"
scp -q scripts/kobo/add-opds-catalog.lua kobo:/tmp/add-opds-catalog.lua
TOKEN=$(pbpaste | tr -d '[:space:]'); printf '%s' "$TOKEN" | ssh kobo 'cd /mnt/onboard/.adds/koreader && ./luajit /tmp/add-opds-catalog.lua; s=$?; rm -f /tmp/add-opds-catalog.lua; exit $s'
```
Paste me all the output.
````

It adds or updates the catalogue (other catalogues are kept) and sets its sync folder to
`/mnt/onboard/Send to Kobo`, the folder the plugin uses too. On the Kobo, OPDS "Forbidden"
means the token differs from `KOBO_OPDS_TOKEN`.

## 3. Updating the plugin

When a merged PR changed `scripts/kobo/lascisboard.koplugin/`. If the same PR changed the
server too, it deployed with the merge (migrations, then every function, then the website,
about 3–5 minutes): wait until that merge's **Deploy** run is green (GitHub → Actions →
Deploy) before updating the Kobo.

On the Kobo first: Wi-Fi on, KOReader open in the file browser, SSH server on. Then paste:

````
Execute only. Do not research and do not change anything else. Run the steps in order;
if any command fails, STOP and paste me the output.

```bash
set -euo pipefail
cd ~/Project_Daily-fresh
git fetch -q origin main
git switch -q --detach origin/main
git log --oneline -1
if command -v lua5.1 >/dev/null; then lua5.1 scripts/kobo/test-lbcore.lua; else echo "(lua5.1 not on this Mac — skipped the local check)"; fi
B=~/KoboBackups/$(date +%F_%H-%M-%S); mkdir -p "$B"
scp -q -r kobo:/mnt/onboard/.adds/koreader/settings "$B/"
echo "settings backed up to $B"
bash scripts/kobo/deploy-plugin.sh
grep -m1 "VERSION =" scripts/kobo/lascisboard.koplugin/main.lua
ssh kobo 'cd /mnt/onboard/.adds/koreader/plugins/lascisboard.koplugin && grep -m1 "VERSION =" main.lua && ls'
```
Paste me all the output (the two version lines must match).
````

**Then on the Kobo:** exit KOReader and open it again. Open any book and close it (the
reading menu is captured when a book closes, once per plugin version), go back to the
library, then 🛠 → **Lasci's Board** → **Sync now** (the first sync after an update always
sends the report). **Check:** Status shows the new version and a fresh "Last sync", and
Books → Kobo shows the same plugin version.

The secret, the settings and the reading cursor live in `settings/lascisboard.lua`, which an
update never touches.

**Your own fonts:** put them in the `fonts` folder at the top of the Kobo's storage
(`/mnt/onboard/fonts`), restart KOReader and Sync now — the website's font pickers then
offer exactly what the Kobo has.

## 4. The device secret (and the catalogue token)

### 4.1 Where it lives

- In Supabase → Edge Functions → Secrets as `KOBO_SYNC_SECRET`; `kobo-sync` refuses a plugin
  request whose `x-kobo-secret` header differs (403).
- On the Kobo in `.adds/koreader/settings/lascisboard.lua` (the `secret` key), written by
  `scripts/kobo/set-plugin-secret.lua`, which reads it from stdin over SSH, keeps every other
  key and prints nothing. It can also be pasted by hand: 🛠 → Lasci's Board → Settings →
  Device secret.
- The OPDS catalogue's `KOBO_OPDS_TOKEN` is separate, so rotating one never breaks the other.

### 4.2 Put the secret on the Kobo again (same value)

Copy `KOBO_SYNC_SECRET`'s value to the clipboard; Kobo ready as in §1; then:

````
Execute only. Do not research and do not change anything else. Never print the clipboard
or any secret. If any command fails, STOP and paste me the output.

```bash
set -euo pipefail
cd ~/Project_Daily-fresh
git fetch -q origin main
git switch -q --detach origin/main
SECRET=$(pbpaste | tr -d '[:space:]'); echo "secret length: ${#SECRET}"
curl -s -o /dev/null -w "plugin route: %{http_code}\n" "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/kobo-sync/inbox" -H "x-kobo-secret: $SECRET"
scp -q scripts/kobo/set-plugin-secret.lua kobo:/tmp/set-plugin-secret.lua
printf '%s' "$SECRET" | ssh kobo 'cd /mnt/onboard/.adds/koreader && ./luajit /tmp/set-plugin-secret.lua; s=$?; rm -f /tmp/set-plugin-secret.lua; exit $s'
```
Paste me all the output (the plugin route must answer 200).
````

Then 🛠 → Lasci's Board → **Sync now**.

### 4.3 Rotate it (a new value)

When the Kobo is lost or given away, or the secret may have leaked. **Owner only** — an AI
never changes a Supabase secret.

1. On the Mac: `openssl rand -hex 32 | tr -d '\n' | pbcopy`, and save the value in your
   password manager.
2. Supabase → Edge Functions → Secrets → `KOBO_SYNC_SECRET` → replace it with the clipboard.
   From then on the old secret is refused (403), so an old or lost Kobo can no longer sync.
3. Run §4.2 with the new value on the clipboard, then Sync now.

Rotating `KOBO_OPDS_TOKEN` is the same, except that the new value goes into **both** Edge
Function secrets and Vault (the daily sweep cron reads Vault), and §2.5 is run again to put
the new catalogue address on the Kobo.

## 5. Project: Title and the other add-ons

| What | Why | Version / pin | Checked by |
|---|---|---|---|
| `lascisboard.koplugin` | Our plugin: reading time, library, automatic downloads, morning news, control from the app | this repo | `test-lbcore.lua`, `test-tls.sh` |
| Project: Title | A clean cover/list library instead of the stock file browser | `2026.07-v3.8.3` (built for KOReader 2026.07.0–.2) | SHA256 `c407d343…0701d3` |
| App Store | Update plugins from the Kobo itself | `v1.14.0` | SHA256 `52e802f2…40a548` |
| `2-disable-fullyread-progressbars.lua` | Finished books show a trophy, not a full bar | commit `a5a77c83` | SHA256 `6067a66d…765ec537` |
| `2-font-override.lua` | One modern font (Source Sans) across the whole KOReader UI | commit `a5a77c83` | SHA256 `123e23e7…dc591` |
| `2-bookshelf-screensaver.lua` | Sleep screen: recent books as spines that fill like progress bars, the open book standing on top | commit `3e2b4f11` (ameyrk99) | SHA256 `b1a378c7…c847e7` |

The full checksums are in §2.2's third block. Not installed, on purpose: ZenOS and SimpleUI
(both refuse to run next to Project: Title), Menu Customizer (no stated support for
2026.07), the "print edition" header patch (needs manual tuning).

**Every Project: Title release is tied to one KOReader version.** So:
- Keep App Store away from Project: Title updates.
- **Don't update KOReader (🛠 → Update) until Project: Title has a release for the new
  version.** Then update both in the same sitting, Project: Title over SSH: Claude first
  writes the new release's link and checksum into §2.2's third block, and the block is run
  again.
- If KOReader was updated by mistake and the library looks broken, re-tick **Cover browser**
  in Plugin management until the matching Project: Title is installed.

## 6. Troubleshooting

- **Sync fails with "certificate verify failed" or "certificate check failed".** Plugin 1.4
  checks the server's certificate against KOReader's own CA bundle (`data/ca-bundle.crt`) and
  that it is issued for the server's name (REFERENCE.md §3.0). Untick 🛠 → Lasci's Board →
  Settings → **Check the server's certificate** (syncing works again at once) and tell Claude
  the exact message. If the bundle file is missing, the plugin syncs without the check.
- **"The device secret is not set"** or a 403 in Status: §4.2.
- **Nothing syncs by itself:** Status says "Restore Wi-Fi on resume: off" → turn it on (§2.3).
  The automatic switches are in 🛠 → Lasci's Board → Settings (reading time, sent books,
  morning news).
- **A sent book doesn't arrive:** it comes on the next wake with Wi-Fi; Settings → "Download
  sent books automatically" must be on. The row in Books → Send to Kobo says whether it was
  downloaded; "Could not download … (it stays in the inbox)" in Status means the next sync
  tries again.
- **"Filesystem is busy (dropbear)"** when the cable is plugged in: exit KOReader first.
- **KOReader crashes with a missing module after a USB copy:** the Kobo's file-system check
  renamed files macOS wrote (REFERENCE.md §10.4). `ssh kobo 'find /mnt/onboard/.adds -name "FSCK*"'`
  must print nothing. The blocks here copy over SSH, which avoids it.
- **The library looks broken after a KOReader update:** §5.

## 7. Undo and uninstall

**Single pieces:**
- Menu order set from the app: Reset on the website's Books → Kobo → Menu order, or delete
  `settings/filemanager_menu_order.lua` and `settings/reader_menu_order.lua`, then restart
  KOReader.
- KOReader settings set from the app: Reset on the website stores "nothing", so the Kobo
  deletes its own value at the next sync. The settings backup from every block is in
  `~/KoboBackups/<date>/settings`.
- Project: Title: delete `plugins/projecttitle.koplugin`, then re-tick Cover browser in
  Plugin management.
- Patches: delete the three files in `.adds/koreader/patches/` (pick another sleep screen
  first if Bookshelf is selected).

**The whole plugin:** first Sync now if Status shows "Notes waiting to be sent" (unsent
captures live in `settings/lascisboard_outbox.lua`), and pick a sleep screen that is not
Lasci's Board's images. Then, Kobo ready as in §1:

````
Execute only. Do not research and do not change anything else. If any command fails, STOP
and paste me the output.

```bash
set -euo pipefail
B=~/KoboBackups/$(date +%F_%H-%M-%S); mkdir -p "$B"
scp -q -r kobo:/mnt/onboard/.adds/koreader/settings "$B/"
echo "settings backed up to $B"
ssh kobo 'cd /mnt/onboard/.adds/koreader && rm -rf plugins/lascisboard.koplugin lascisboard-sleep && rm -f settings/lascisboard.lua settings/lascisboard_outbox.lua && ls plugins'
```
Paste me all the output.
````

Exit KOReader and open it again. The app keeps the library and the reading history; the
Kobo card on Settings → Subscriptions simply stops updating. If the device is gone for good,
rotate the secret (§4.3). Removing KOReader and NickelMenu themselves: REFERENCE.md §10.4
("Uninstall").
