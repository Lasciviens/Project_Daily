# ScreenScraper and ES-DE — integration reference

The durable reference for two integrations of the Games page: **ScreenScraper**
(metadata and artwork for retro games, Games → Scrape) and the **ES-DE import**
from the RP6 handheld (the `esde-sync` contract). The feature itself is
described in [`docs/features/games.md`](../features/games.md); the device side
(Termux scripts and widgets) in [`docs/termux-widgets.md`](../termux-widgets.md).

> **No credentials live in this file, and none ever should.** `devid` /
> `devpassword` / the member password are server-side secrets only. See §3 —
> this is not a formality, the API leaks them if you are careless.

**Where to look:** §16 is the current scraper (rewritten from scratch on
25.09.2026) and the complete API map it was built from. §1–§6 are the API
facts measured first (auth, limits, the credential leak, plain-text errors,
field mapping, system ids). §8–§11 are the ES-DE import: transport, the
measured export, the contract and the order of work. Sections 7 and 12–15
described the first scraper, which is gone; they live in
[`docs/archive/screenscraper-v1.md`](../archive/screenscraper-v1.md). The
numbers are kept so that citations elsewhere (§10, §16 in code, scripts and
the coordination logs) stay valid.

First verified live: **15.09.2026**, against `api.screenscraper.fr/api2`.

---

## 1. What was verified live (not guessed)

Every shape below came from a real call, per this repo's "never add a
speculative external-API field" rule.

| Endpoint | Result | Notes |
|---|---|---|
| `ssuserInfos.php` | **403** → **200** | 403 with dev credentials alone; 200 once the member `ssid`/`sspassword` are sent (see §2) |
| `jeuRecherche.php` | **200**, ~2.3 MB | Fuzzy search by name. Returned 30 candidate games for one query |
| `jeuInfos.php` (match) | **200**, ~208 KB | Exact lookup by ROM filename |
| `jeuInfos.php` (no match) | **404** | ⚠️ **plain text, NOT JSON** — see §4 |
| `systemesListe.php` | **200**, ~4.0 MB | 250 systems, carries the ES-DE/RetroPie folder-name mapping (§6) |

---

## 2. Auth: two credential pairs, both in place

ScreenScraper wants **two** pairs, and they are not interchangeable:

- `devid` + `devpassword` — the *application* identity.
- `ssid` + `sspassword` — the *member account*, which carries the **paid
  membership**. This is the screenscraper.fr website login, NOT the "Password"
  column on the developer page (that one is the devpassword).

Both pairs are set up and verified. They are the four secrets
`SCREENSCRAPER_DEVID` / `SCREENSCRAPER_DEVPASSWORD` / `SCREENSCRAPER_SSID` /
`SCREENSCRAPER_SSPASSWORD` ([`docs/backend/environment.md`](../backend/environment.md)), read by
`screenscraper-sync` and `screenscraper-media`. All four are needed on every
call: with only the dev pair the account is anonymous.

### Anonymous vs premium — measured 15.09.2026

The paid membership hangs off the **member account**, not the dev app. Sending
`ssid` + `sspassword` alongside the dev pair switches it on. Measured on a real
`ssuserInfos.php` call and confirmed again on a real `jeuInfos.php` call:

| | anonymous (dev only) | **premium (member sent)** | change |
|---|---|---|---|
| `niveau` | 0 | **1** | identified |
| `maxthreads` | 1 | **6** | 6× parallelism |
| `maxrequestsperday` | 10 000 | **100 000** | 10× |
| `maxrequestspermin` | 3 072 | **7 168** | 2.3× |
| `maxdownloadspeed` | 128 KB/s | **2 176 KB/s** | **17×** |
| `maxrequestskoperday` | 1 000 | 10 000 | 10× |

The account read **level 10 and 7 threads** when the rewrite measured it on
25.09.2026 (§16.2).

**Watch the shared daily counter.** The quota is per *account*, so scraping done
on the device itself (ES-DE's own scraper) spends from the same 100 000. Read
`requeststoday` at the start of a run and back off rather than assuming a fresh
budget (the rewrite's quota floor does this, §2b).

Earlier dead ends, recorded so nobody retries them: forcing a level via the
documented debug mode (`devdebugpassword` + `forcelevel`) at 0/1/20/30/99
returned identical anonymous limits every time, because `forcelevel` overrides a
*logged-in* user's level and there was no logged-in user. And
`userlevelsListe.php` returns **contribution** ranks (Membre → Contributeur →
Admin), a different axis from the paid membership.

---

## 2b. How to scrape correctly — limits, counters and back-off

Researched against the official API behaviour plus two battle-tested open-source
implementations (Skyscraper, which has shipped for years, and an open RomM issue
covering exactly this). Every number below was either measured live on this
account or cited from those sources.

### Tier ladder (community-documented)

| Tier | Threads | Speed |
|---|---|---|
| Free / unregistered | 1 | 128 Kb/s |
| **Donor (€10 one-time)** | **+5 for life** | — |
| Contributor | 8 | 40 Mb/s |

On 15.09.2026 this account read **6 threads** = 1 base + 5 donor, matching its
panel (`Member donor (1) / Developer`); it read 7 on 25.09.2026. Contributor
tier is earned by contributing data, not bought.

### ⚠️ `requeststoday` is NOT the panel's "Scrapes Today", and NOT a clean counter

The panel showed `Scrapes Today: 30 / 100000` while the API's
`ssuser.requeststoday` read **24 320** at the same moment. Measured directly:

- calling `ssuserInfos.php` repeatedly did **not** move the counter (5 reads,
  4 s apart, all `24330`) — so status reads are free;
- **3 real `jeuInfos` calls moved it by 10**, not by 3.

So `requeststoday` counts something coarser and/or wider than "scrapes this
tool made" — it does not increment 1:1 with our requests, and it does not agree
with the figure the website shows. Treat it as a rough ceiling indicator, never
as our own request count.

### Pacing

- **Skyscraper sleeps ~1.2 s between requests** (`limitTimer.setInterval(1200)`,
  "set a bit above 1.0 as requested by the good folks at ScreenScraper") — a
  politeness contract with the service, not just a technical limit.
- **Never exceed `maxthreads`.** RomM's issue documents
  `maxrequestspermin = threads × 50`; that does not fit this account. The
  formula that does is `1024 × (maxthreads + 1)` (§16.2: 6 threads → 7 168).
  Prefer the reported field over any formula.
- **Track KO (not-found) separately.** `maxrequestskoperday` is its own budget.
  A library full of unmatched files burns it fast — which is why the `._`
  AppleDouble sidecars and the launcher pseudo-systems (§9) must be filtered out
  *before* scraping, not discovered as failures.

**What the current code does** (§16): it does not sleep between requests; it
bounds concurrency instead. `screenscraper-sync` runs at most **3** lookups at
once per call (Many games looks up 10 games per call and saves 5), retries once
after 1.5 s when ScreenScraper says busy, and refuses to start when fewer than
**300 requests or 50 misses** are left today — a floor kept for the handheld,
read from `requeststoday` as a rough ceiling. The browser loads proxied images
3 at a time (`ssImageQueue.ts`), retrying after a pause on "busy".

### Failure signals to branch on

The API signals via **HTTP status** and a failure body is **plain text, not
JSON** (§4) — and a failed login often comes back as HTTP **200** (§16.2), so
the body has to be read too (`classifyText` in `scraper/ssRules.ts`). Verified
headers carry no rate-limit metadata — no `Retry-After`, no `X-RateLimit-*`.

Skyscraper additionally matches these strings, which mean *stop*, not *retry*:

| String | Meaning |
|---|---|
| `Votre quota de scrape est …` | daily quota exhausted |
| `API totalement fermé` | API fully closed |
| `API fermé pour les non membres` / `API closed for non-registered members` | closed to non-members |
| `Le logiciel de scrape utilisé a été blacklisté` | this software is blacklisted |
| `non trouvée` | game not found (normal) |

Skyscraper retries up to **4 times** on ordinary failures but **never** on
blacklist / quota / API-closed / invalid-JSON — those abort the run. Retrying a
quota error just deepens the hole.

### Practical budget

The whole library is well under 10 000 games (§9). **The quota is not the
binding constraint for this library; politeness and the shared counter are.**

---

## 3. ⚠️ Security finding: media URLs embed the credentials in plaintext

This is the single most important finding here.

Every media entry the API returns carries a ready-made URL with credentials
inline — and since the member pair is sent, the URL carries **the account
password too**, not just the dev one:

```
https://neoclone.screenscraper.fr/api2/mediaJeu.php
  ?devid=<DEVID>&devpassword=<DEVPASSWORD>&softname=...
  &ssid=<SSID>&sspassword=<ACCOUNT PASSWORD>&systemeid=1&jeuid=3&media=sstitle(wor)
```

The same is true of `systemesListe`'s `medias[].url`, of
`header.commandRequested` (it echoes the full request URL) and of a hack's
`downloadurl`.

**How the app handles it (§16.4):** no ScreenScraper URL is ever stored,
logged or returned to the browser. Every payload passes through
`stripCredentials`, and every error is scrubbed. A file the owner keeps is
**copied** server-side into Supabase Storage (the image columns —
`primary_cover_url`, `screenshot_url`, `fanart_url` — only ever take a stored
copy); everything else is streamed through the `screenscraper-media` proxy,
which adds the credentials server-side and only serves requests signed per
game.

---

## 4. ⚠️ Error responses are plain text, not JSON

Failure bodies are not JSON. Parsing the response as JSON unconditionally will
throw before the error is ever inspected:

| Condition | HTTP | Body (verbatim) |
|---|---|---|
| ROM not found | `404` | `Erreur : Rom/Iso/Dossier non trouvée !` |
| Bad credentials | `403` | `Erreur de login : Vérifier les identifiants utilisateurs !` |

Branch on the status code **and** the body; only parse JSON when the body is
JSON. The full list of codes is in §16.2. A miss is a normal outcome (an
unmatched ROM): the scraper reports it as "no match" for that lookup and goes
on; it never fails the run and never flags the game.

---

## 5. Field mapping → our schema

Real response keys from `jeuInfos.php` → `response.jeu` (the complete list,
including `themes`, `styles`, `hacks` and the rest, is in §16.2):

```
id, romid, notgame, noms, cloneof, systeme, editeur, developpeur,
joueurs, note, topstaff, rotation, synopsis, classifications, dates,
genres, modes, familles, tips, actions, medias, roms, rom
```

How the current scraper maps them (`toCandidate` in `scraper/ssRules.ts`).
Region and language orders come from "What to save" (`screenscraper_prefs`;
defaults: regions `ss, wor, eu, us, jp`, languages `en, fr, de, es, it, pt`).
Every field has a policy — **fill** (only when empty, the default), **replace**
or **skip**.

| Our column | ScreenScraper source | Shape / gotcha |
|---|---|---|
| `games.title` | `noms[]` | `{region, text}`; picked by the region order (`ss` = their canonical name). Non-games carry a `ZZZ(notgame):` prefix, which is stripped |
| `games.release_year` | `dates[]` | `{region, text}`, text `YYYY` or `YYYY-MM-DD`; the earliest year across all regions |
| `game_platforms.release_date` | `dates[]` | A full date only: the ROM's own region first, then the region order, else the earliest. A year is never padded into a fake day |
| `games.publisher` / `developer` | `editeur.text` / `developpeur.text` | `{id, text}` |
| `games.description` | `synopsis[]` | `{langue, text}`, picked by the language order |
| `games.genres` / `modes` (text[]) | `genres[]` / `modes[]` | Each entry has `noms[{langue,text}]`; `principale: "1"` entries lead |
| `games.series_name` | `familles[]` | **This is the series** ("Sonic"). Often only `fr` exists — falls back to any language |
| `games.players` | `joueurs.text` | A **range string** like `"1-2"`, not an integer |
| `games.age_rating` | `classifications[]` | `{type, text}`; PEGI first, then ESRB, CERO, USK, SS — stored as `"PEGI 12"` |
| `game_platforms.rating` | `note.text` | **Out of 20** (`"17"` = 17/20), stored ×5 on the 0–100 scale |
| `game_platforms.region` / `version_title` / `rom_status` | `rom{…}` | The matched dump's regions and filename tags; `rom_status = 'verified'` only after a hash match |
| `primary_cover_url` / `screenshot_url` / `fanart_url` / `game_platforms.wheel_url` | `medias[]` | `box-2D` / `ss` / `fanart` / `wheel-hd`, and **only a stored copy** — never their URL (§3) |
| `games.ss_jeu_id` | `jeu.id` | The match marker (+ `ss_scraped_at`). **Never** `external_source`/`external_ref` — those belong to the ES-DE sync (§16.6) |

**Scores never touch `games.rating`.** `games.rating` is `numeric(3,1)` 0–10
and is the **user's own** score; nothing external ever writes it. Every
provider score goes to `game_platforms.rating`, `numeric(4,1)` 0–100: ES-DE's
0–1 decimal ×100 (§10), ScreenScraper's /20 ×5. One column, one scale.

### Media types

The first sample carried 26 types:

```
bezel-16-9, box-2D, box-2D-back, box-2D-side, box-3D, box-texture,
fanart, manuel, mixrbv1, mixrbv2, pictocouleur, pictoliste,
pictomonochrome, screenmarquee, screenmarqueesmall, ss, sstitle,
steamgrid, support-2D, support-texture, themehs, video,
video-normalized, wheel-carbon, wheel-hd, wheel-steel
```

`mediasJeuListe` lists 50 (§16.2); the app's catalogue with each type's default
mode is `scraper/ssMediaCatalog.ts`. Each entry:
`{type, parent, url, region, crc, md5, sha1, size, format}`.

### The `rom` block — exact-match keys

`jeu.rom` carries `romfilename`, `romcrc`, `rommd5`, `romsha1`, `romsize`,
`romregions`, plus flags (`beta`, `demo`, `proto`, `hack`, `unl`, `alt`, `best`).
**Hash matching is far more reliable than filename matching**; the current
search sends hashes, filename, size and serial when it has them (§16.2).

---

## 6. ES-DE folder → ScreenScraper system id

`systemesListe.php` solves this. Each of the 250 systems carries:

```json
"noms": {
  "nom_eu": "Megadrive",
  "nom_us": "Genesis",
  "nom_recalbox": "megadrive",
  "nom_retropie": "genesis,megadrive",   ← comma-separated aliases
  "nom_launchbox": "Sega Genesis",
  "noms_commun": "Sega Megadrive,Sega Genesis,..."
}
```

**ES-DE uses the RetroPie folder-naming convention**, so `nom_retropie` is the
main join key: an ES-DE `roms/megadrive/` folder → `systemeid=1`. Also on each
system: `extensions` (`"gen,md,smd,bin,sg"`) and `romtype`.

**How it is stored:** the list is cached in `screenscraper_systems` (migration
094), filled by `screenscraper-sync`'s `refresh_systems` action (a 4 MB answer —
re-fetch rarely). Each row's aliases are `nom_retropie` plus every other name
(eu, us, jp, common, recalbox, launchbox), also in a punctuation-free form,
because some ES-DE folders (`n3ds`) are not in their RetroPie field. Several
systems claim the same alias (`snes`: 4 Super Nintendo and 202 "Super Mario
World Hacks"), so **the lowest id wins** — a last-write-wins map once sent 604
games to a ROM-hack database.

---

## 7. Open decisions (moved)

The first version's decision list moved to
[the archive](../archive/screenscraper-v1.md). The one decision still in force
— provider scores never write `games.rating` — is in §5.

---

## 8. ES-DE transport — decision and rationale

**One path for the first import and every later push.** A script on the RP6
(Termux) reads the gamelist files, sends only what changed, and is triggered by
hand (a Termux widget), never on a schedule. The one-time full import was the
same code path with more rows (§11).

**Why a device-side push, not a cloud-side pull:** Supabase's `pg_cron` can only
reach things that are already on the internet. The RP6 is behind home NAT with
no stable address, so a cron job can never "go get" the file. The device has to
initiate. This is the pattern `phone-gateway` already uses (device holds a
secret, POSTs to an edge function, the function acts as the single user with
the service role) — reused, with its own door (§10).

**Syncthing vs KDE Connect vs Termux script:**

| Option | Verdict |
|---|---|
| **KDE Connect** | ✗ Not suited. It is a phone↔desktop pairing tool (notifications, clipboard, ad-hoc file send). It has no unattended folder-sync daemon, so nothing would happen unless the file was pushed by hand every time |
| **Syncthing** | ~ Works, but solves the wrong half. It would keep `gamelist.xml` mirrored to a Mac continuously, but still needs a *second* step to get the data into Supabase, and the Mac has to be on. It adds a moving part without removing one |
| **Termux script → edge function** | ✓ **Chosen.** One hop, no intermediate device, no always-on node. The script parses the XML on-device, diffs against stored fingerprints, and POSTs only changes. Matches `phone-gateway`'s security model |

**Incremental strategy (the "only updates, not everything" requirement):** a
per-game fingerprint is stored on the device after each acknowledged push, and
only rows whose fingerprint changed are sent. The server side stays a plain
idempotent upsert keyed on `(system, rom path)`, so a full re-push is always
safe if the local state is ever lost.

**History.** The device-side push started as Codex task C7 (done 16.09.2026,
PR #440); Claude wrote the receiving functions, the migrations and this
contract. Who may change which file now follows the two-AI rules in
`AGENTS.md`. Install, update and troubleshooting:
[`docs/termux-widgets.md`](../termux-widgets.md).

---

## 9. The real ES-DE export — measured 15.09.2026

Run against the owner's actual export (`ES-DE Copy`, ES-DE **3.4.1-58 (r51)**,
Android app on an Adreno 740 device). **Self-check passed** — `<path>` count
equals `<game>` count in every file, so every number below is measured, not
estimated.

**1.3 MB total.** 33 files; 26 `gamelist.xml` (24 live + 2 stale CLEANUP
snapshots) totalling 1.2 MB. `downloaded_media` was not copied for this
measurement. Only `gamelists/` plus two config files were in scope.

### 1150 games across 24 systems

| system | games | | system | games |
|---|---|---|---|---|
| nes | 277 | | fbneo | 12 |
| snes | 239 | | n3ds | 6 |
| genesis | 182 | | saturn | 6 |
| switch | 125 | | dreamcast | 3 |
| n64 | 91 | | segacd | 2 |
| psp | 57 | | steam | 2 |
| gc | 47 | | wiiu | 2 |
| ps2 | 39 | | xbox360 | 2 |
| gba | 22 | | androidapps | 1 |
| nds | 18 | | emulators | 1 |
| psx | 14 | | snesna | 1 |
| | | | wii | 1 |
| | | | androidgames | 0 |

**Not everything here is a scrapeable ROM.** `androidapps` (a real entry is
`./Settings.app` — the Android Settings app), `androidgames`, `emulators` and
`steam` are launcher shortcuts. They will never match on ScreenScraper and must
be excluded up front so they do not burn the separate KO quota (§2b).

**Real scrape budget: 1125 games.** 1150 minus 4 launcher-shortcut entries minus
21 AppleDouble sidecars (below).

`<folder>` elements also exist alongside `<game>` in some lists (switch 7,
genesis 3, n3ds 3, nes/snes/wiiu 1 each). They are directory entries carrying
their own metadata, **not games** — counted separately above and ignored by the
importer.

### `<game>` fields ES-DE actually writes — measured fill rates over all 1150

| Field | Fill | Notes |
|---|---|---|
| `path` | **100 %** | **The join key.** Relative, `./`-prefixed, e.g. `./Burnout 3 - Takedown .chd` |
| `name` | **100 %** | Display name, already cleaned by the scraper |
| `desc` | 98 % | Long synopsis |
| `developer` | 98 % | plain string |
| `publisher` | 98 % | plain string |
| `players` | 98 % | range string: `1`, `1-2`, `1-4` |
| `releasedate` | 98 % | `YYYYMMDDTHHMMSS`, e.g. `19991014T000000` — **no timezone** |
| `genre` | 98 % | **comma-separated inside ONE string**, e.g. `Racing, Driving` |
| `rating` | 97 % | **0–1 decimal** (`0.9`, `1`) — not 0–5, not 0–10 |
| `playcount` | 8 % (94) | integer — times launched |
| `lastplayed` | 8 % (88) | `YYYYMMDDTHHMMSS`, e.g. `20260519T210643` |
| `playtime` | 7 % (85) | **integer SECONDS** (`17`, `29`, `2814`) |
| `favorite` | 1 % (12) | `true` |
| `hidden` | 5 | `true` — ES-DE curation flag |
| `broken` | 3 | `true` |
| `nogamecount` | 3 | `true` |
| `nomultiscrape` | 3 | `true` |
| `hidemetadata` | 2 | `true` |

The 97–98 % band is one consistent set: those are the games ES-DE has already
scraped. The ~2 % gap is the same unscraped games in every column, not a
per-field quality issue — which is exactly the set ScreenScraper should fill.

**`altemulator` does NOT appear in this export.** An earlier draft listed it
from a mis-parsed sample; the verified run shows 18 distinct `<game>` child
elements and `altemulator` is not among them.

**`playtime` is the find.** `games` already had `esde_playcount` /
`esde_last_played` / `esde_playtime_seconds` columns; all three map directly and
`playtime` is already in seconds.

Play stats are sparse by nature — only games actually launched carry them
(7–8 % here). Absence means "never played", not a sync failure. **No play-stat
column may be `NOT NULL`;** the metadata columns are 98 %-filled but the 2 % gap
is real, so those cannot be `NOT NULL` either. `path` and `name` are the only
two fields the data supports making required.

### Two traps in real `path` values

1. **macOS AppleDouble sidecars — 21 found.** Entries like
   `./._Legend of Zelda, The - Ocarina of Time (USA).z64`. The `._` prefix is a
   macOS resource-fork sidecar created when the folder was copied to the Mac,
   **not a real ROM**. Filter them out or they get scraped, fail, and burn KO
   quota.
2. **Extension-less paths** exist (folder-based games). Matching logic that
   assumes an extension will mishandle them.

### Stale snapshots

ES-DE keeps dated copies under `gamelists/CLEANUP/<timestamp>/<system>/`. Real
files, stale data. The inspector excludes them from the aggregate and reports
the count separately — an early run sampled one by accident and reported a
5-game n64.

### Other files

- **`custom_systems/es_systems.xml`** (42 KB, 25 `<system>`, every field 100 %
  filled) — `name`, `fullname`, `path`, `extension`, `platform`, `theme` per
  system. `platform` is a natural bridge to ScreenScraper's system ids (§6);
  `extension` says which files are even candidate ROMs.
- **`custom_systems/es_find_rules.xml`** (55 entries) — emulator discovery. Not
  useful to us.
- **`settings/es_settings.xml`** (9 KB) — 103 `<bool>`, 53 `<string>`, 17
  `<int>`. App preferences; nothing we need.
- **`collections/custom-mario.cfg`, `custom-pokemon.cfg`** — both **empty**, so
  there was no custom-collection data to import.

### Running the inspector

```
node scripts/inspect-esde-export.mjs        # native macOS folder picker
node scripts/inspect-esde-export.mjs /path/to/ES-DE
```

`--deep` also descends into media/theme folders, `--full` prints longer samples.
READ-ONLY, uploads nothing. Paste the OUTPUT, never the files.

---

## 10. The ES-DE import contract — `esde-sync` (`import_esde_games`)

**This section is the contract** between the device-side push
(`scripts/push-esde-library.py`, also used by the widgets' `sync-esde.py`) and
the `esde-sync` edge function. Neither side may assume anything it does not
state. Everything here is derived from the measured export in §9, not from what
ES-DE could theoretically emit. Pure rules are verified by
`scripts/verify-esde-import-rules.cjs` (59 assertions), whose source
`src/features/games/api/esdeImportRules.ts` is hand-mirrored into the function.

### Endpoint

```
POST https://<project>.supabase.co/functions/v1/esde-sync
Content-Type: application/json
x-esde-secret: <ESDE_SYNC_SECRET>
```

**Its own function and its own secret, not an action on `phone-gateway`.** It
reuses the `phone-gateway` *pattern* — the device holds a static revocable
secret, POSTs to an edge function, and the function resolves the single user
(`HEVY_USER_ID`) server-side with the service role, which never leaves the
server. But `phone-gateway` is the *iPhone's* door and carries the iPhone's
secret. The handheld is a different physical device with a different lifecycle:
revoking one must never revoke the other. JWT verification is off for this
function (`supabase/config.toml`); it checks its own secret. `ESDE_SYNC_SECRET`
and `HEVY_USER_ID` are read from the Edge Function secrets.

The same secret also opens the two companion endpoints the widgets use:
`esde-media-sync` (inventory, optimized covers, guarded variant deletion —
migration 094) and `esde-content-sync` (source XML and original images —
migration 100). They are described in [`docs/termux-widgets.md`](../termux-widgets.md).

### Request

```json
{
  "action": "import_esde_games",
  "timezone": "Europe/Oslo",
  "batch": 1,
  "batches": 8,
  "games": [ … ]
}
```

| Field | Required | Notes |
|---|---|---|
| `action` | yes | exactly `import_esde_games` (the only action) |
| `timezone` | no | IANA zone the device's timestamps are in. Defaults to `Europe/Oslo`. Resolved DST-safely server-side, the same two-pass technique `phone-gateway`'s `import_body_composition` uses; an unknown zone rejects the batch |
| `batch`, `batches` | no | purely informational, echoed back so a partial run is legible in the device's own log. They carry **no server state** — see "Batching" below |
| `games` | yes | 1–150 entries |

### One `games` entry — exactly the fields §9 measured

```json
{
  "system": "genesis",
  "path": "./Sonic the Hedgehog 3 (USA).md",
  "name": "Sonic the Hedgehog 3",
  "desc": "Yet again Sonic and friends find themselves…",
  "developer": "Sonic Team",
  "publisher": "SEGA",
  "genre": "Platform, Action",
  "players": "1-2",
  "releasedate": "19940202T000000",
  "rating": 0.9,
  "playcount": 4,
  "playtime": 2814,
  "lastplayed": "20260519T210643",
  "hidden": false,
  "broken": false
}
```

`system` (the folder name), `path` and `name` are **required** — the only three
fields §9 measured at 100 % (`system` is the folder the file was read from).
Every other field is omitted when ES-DE did not write it; **do not send `null`,
an empty string or a zero for a missing value** — absent and zero are different
facts, especially for `playcount`/`playtime`. ES-DE's own all-zero timestamp
reads as absent.

**Send ES-DE's values verbatim.** Do not reformat the timestamps, do not split
`genre` on the comma, do not rescale `rating`, do not resolve `path` to an
absolute path. Every one of those conversions is the server's job, and doing it
twice is how the two sides drift apart.

### What the device must NOT send

All four are measured facts from §9, not defensive guesses:

1. **`androidapps`, `androidgames`, `emulators`, `steam`** — launcher
   shortcuts, not ROMs (a real entry is `./Settings.app`).
2. **Any path whose basename starts with `._`** — macOS AppleDouble sidecars.
3. **`<folder>` elements** — directory entries that carry their own metadata
   and are not games.
4. **Anything under `gamelists/CLEANUP/`** — ES-DE's own dated backups. Real
   files, stale data.

The device script adds its own filters on top (ROMs missing from disk,
standalone Switch DLC/update packages); see
[`docs/termux-widgets.md`](../termux-widgets.md#which-entries-are-sent). On the
measured export the real payload was **1125 games**.

### Batching

Batches are **independent and idempotent**. There is no run id, no server-side
assembly, and no ordering requirement: the server upserts whatever arrives and
answers for that request alone. A failed batch is retried by re-sending it
unchanged; a full re-push is always safe. That is deliberate — it removes the
entire class of "half a sync is stuck in the database" failure, and it is why
no `esde_sync_runs` table exists (093's header note).

Cap a request at **150 games**, so 1125 games are 8 requests. One
`(system, path)` may appear only once per batch.

### Response

```json
{ "status": "ok", "batch": 1, "received": 150,
  "created": 148, "updated": 2, "skipped": 0, "flagged": 1 }
```

- `skipped` — entries the server itself declined (`hidden: true`).
- `flagged` — written entries with `broken: true` (they are also counted in
  `created` or `updated`).
- `400 { "status": "validation_error", "errors": { "3": "path is required" } }`
  — keyed by the entry's index in `games` (or `timezone` / `games` for a
  batch-level problem). **Nothing is written**; the whole batch is rejected, so a
  fixed-and-resent batch cannot double-apply.
- `401` — wrong or missing `x-esde-secret`. `503` — `HEVY_USER_ID` not set.
- `500 { "status": "server_error", … }` — retry the same batch. If the
  `games` rows went in but the `game_platforms` insert failed, the answer says
  `games_written`; a re-sent batch then finds them by key.

### What the server does with each field

**Create** (no row for the key yet) — one `games` row plus one `game_platforms`
row:

| Incoming | Lands as |
|---|---|
| `system` | `game_platforms.esde_system` (the key) **and** `game_platforms.system` — after that the display value is the user's to rename |
| `path` | `game_platforms.esde_path` (the key) |
| `name` | `games.title` |
| `desc` | `games.description` |
| `developer`, `publisher` | same-named `games` columns |
| `genre` | split on `,`, trimmed → `games.genres text[]` |
| `players` | `games.players` verbatim (it is a range string, `1-2`) |
| `releasedate` | year → `games.release_year`; full date → `game_platforms.release_date` |
| `rating` (0–1) | `game_platforms.rating` **×100**. Never `games.rating` (§5) |
| `playcount`, `playtime`, `lastplayed` | `game_platforms.esde_*` and the same values on `games.esde_*` |
| `broken: true` | `needs_review = true` on both rows |
| `hidden: true` | entry skipped entirely |
| — | `external_source = 'esde'` on both rows, `synced_at = now()`, `is_primary_variant = true` (a new game's only variant is its primary) |

**Update** (the key exists) — **play statistics only**, plus
`needs_review = true` for `broken: true`. Metadata is a create-time fact:
re-writing title/description/genres on every push would silently undo the
user's own curation (the same shape as the Hevy body-measurement overwrite
incident). `--full` resends metadata but does not make the server overwrite it.

**Timestamps.** `YYYYMMDDTHHMMSS` with no offset — ES-DE writes local wall-clock
time. Resolved through the request's `timezone`, never a hardcoded offset.

**Play-statistic roll-up.** ES-DE reports per (system, file) — per variant —
while `games.esde_playcount` / `esde_playtime_seconds` / `esde_last_played`
describe the whole game. On every update the server **sums** play count and
play time and takes the **latest** last-played across the game's variants (null
when no variant reported anything — "never launched" is not "0 launches").
Summing is the only rule that cannot discard a real play session. This matters
for games merged in Games → Advanced → Duplicates (migration 131 moves the
other copy's variants over); a single-variant game's roll-up is just its own row.

**Backlog → Playing.** When the rolled-up play time reaches **30 minutes** and
the game's status is `backlog`, the server sets it to `playing`. Only from
`backlog`: `completed`, `dropped` and `wishlist` are statements the user made.

**Not written:** the source-neutral play columns from migration 096
(`play_seconds` / `play_count` / `last_played_at`). The page reads the live
`esde_*` columns for retro rows (`playStatsOf` in `gameStats.ts`); the gap is
tracked in [`test-game-known-issues.md`](test-game-known-issues.md).

**Matching.** The upsert target is the partial unique index migration 093
creates: `(user_id, esde_system, esde_path)`. **One ES-DE entry always becomes
one game row.** The server never merges two entries into one game by title
similarity — a title appearing on two systems is a real, intentional shape, and
deciding that two files are the same game is a curation judgement (the owner's,
through Duplicates → Compare & merge), not something a sync should guess at.

---

## 11. Order of operations — import first, scrape second

Worth stating plainly because the intuitive order is backwards.

**Step 1 — ES-DE into the database.** The device script reads the gamelists on
the handheld and POSTs them to `esde-sync`. No ScreenScraper involvement at all.
§9 measured the metadata at **97–98 % already filled**, because ES-DE has
scraped this library before, so this single step lands a working library:
titles, descriptions, developers, publishers, genres, release years, players and
ratings, plus the play statistics nothing else in this app has.

**Step 2 — ScreenScraper fills what is left.** Two real gaps: the ~2 % of games
ES-DE never matched, and artwork beyond what the handheld uploads. That is a
much smaller job than scraping a whole library from nothing.

**Why not scrape first:** a scraper has to be told what to look for. Before step
1 the database is empty, so there is nothing to enrich and no way to tell a match
from a miss. After step 1 every row carries a real title, system and filename —
which is exactly what ScreenScraper matches on.

**How it went:** step 1 landed on 16.09.2026 (1,028 active variants and 866
optimized covers; dated record in `docs/termux-widgets.md`). The handheld's
content widget later added the parsed source XML and original images. Step 2 is
the Scrape page, rewritten on 25.09.2026 (§16).

---

## 16. The rewrite (25.09.2026) — the full API map and the current design

### 16.1 Why

Measured against the live database before the rewrite: 1,030 retro games, **45**
ever matched, `provider_data` filled on **1**, `games.media` on **0**, age rating
3 %, modes 2 %, series 4 %, `game_platforms.region/wheel_url/box_url` 0 %. The
first version's per-game Scrape button (`apply_match`) never wrote
`provider_data` or extra media, and only about 11 of the ~25 fields their answer
carries were mapped. Storage: the `game-media` bucket already held **596 MB of
the Free plan's 1 GB** (537 MB ES-DE original PNGs, 52 MB ES-DE WebP covers,
13 MB ScreenScraper).

### 16.2 The API, completely (verified)

Sources: the official page (webapi2.php — much of it describes an OLD flat
layout; real JSON wins where they disagree), five real captured responses
(hash, crc, gameid and search lookups, 2023–2026, credentials redacted) and the
parsers in ES-DE, Skyscraper, RomM, Batocera, Recalbox and artie.

**Envelope.** `{header:{APIversion, dateTime, commandRequested, success, error}, response:{serveurs, ssuser, <payload>}}`.
`header.commandRequested` echoes the full request URL — **credentials included**.
Scalars are strings (`"0"`/`"1"` flags, ids as strings); list endpoints use numbers.
Known JSON defects: trailing commas, unescaped backslashes in synopses (parsed leniently).

**Endpoints.**

| Endpoint | Use | Notes |
|---|---|---|
| `jeuInfos.php` | one game + the matched ROM + media | params below |
| `jeuRecherche.php` | name search | `recherche` (≥ 4 letters after dropping "the" and a trailing `+`), `systemeid`; ≤ 30 results, full `jeu` shape minus `rom`/`roms`/`romid`/`cloneof`; no hit = `jeux:[{}]` |
| `mediaJeu.php` | a game image | `systemeid`, `jeuid`, `media` (token), `maxwidth`, `maxheight`, `outputformat=png\|jpg`, `crc`/`md5`/`sha1` → `CRCOK`/`MD5OK`/`SHA1OK`/`NOMEDIA` |
| `mediaVideoJeu.php`, `mediaManuelJeu.php` | video (mp4), manual (pdf) | same, **no resizing** |
| `mediaSysteme.php`, `mediaGroup.php`, `mediaCompagnie.php` | system art, genre/mode/rating pictograms, publisher logos | resizable |
| `systemesListe.php` | 250 systems with every naming convention | cached in `screenscraper_systems` (§6) |
| `genresListe`, `regionsListe`, `languesListe`, `famillesListe`, `classificationsListe`, `mediasJeuListe` (50 types), `infosJeuListe`, `infosRomListe`, `nbJoueursListe`, `supportTypesListe`, `romTypesListe`, `userlevelsListe` | catalogues | six languages (`nom_fr/de/en/es/it/pt`) |
| `ssuserInfos.php`, `ssinfraInfos.php` | account / server status | `ssuser` also rides along with every answer |
| `botNote.php`, `botProposition.php` | **write** (rate, propose) | not used |

Endpoints that do NOT exist (404): `modesListe`, `themesListe`, `stylesListe`,
`classificationListe` (it has an s), `compagniesListe`, `jeuxListe`.

**jeuInfos parameters.** `crc`, `md5`, `sha1`, `romtaille` (bytes), `systemeid`,
`romtype` (`rom`/`iso`/`dossier`/`fichier`), `romnom` (a filename, never a path
— a path is a 400), `serialnum`, `gameid`. A filename needs `systemeid` when no
CRC is sent; `gameid` alone works and returns `roms[]` but no `rom`/`romid`/`cloneof`.
A hash match wins over the name (the returned `rommd5` equals the one sent).

**`response.jeu`.** `id`, `romid`, `notgame` (names then carry a `ZZZ(notgame):`
prefix), `noms[{region,text}]` (`ss` = their canonical name), `systeme{id,text}`,
`editeur{id,text}`, `developpeur{id,text}`, `joueurs{text}`, `note{text}` (/20),
`topstaff`, `rotation`, `resolution`, `controles`, `couleurs`,
`synopsis[{langue,text}]`, `classifications[{type,text}]` (SS, PEGI, ESRB, CERO,
USK, VRC, Tectoy…), `dates[{region,text}]` (`YYYY` or `YYYY-MM-DD`), the group
arrays `genres`/`modes`/`familles` (series)/`numeros`/`themes`/`styles`
(`{id, nomcourt, principale, parentid, noms[{langue,text}]}`), `actions[]`
(control mappings), `tips[]`, `sp2kcfg`, `hacks[]` (with their own synopses,
media and a credentialed `downloadurl`), `medias[]`, `rom{…}`, `roms[]`.

**`medias[]`.** `{type, parent, url, region, crc, md5, sha1, size, format}` +
optional `support` (disc), `version`, bezel `posx/posy/posw/posh`. `parent` is
`jeu` for the game's own files; `editeur`/`developpeur`/`genre`/`famille`/
`region`/`joueurs`/`note`/`classification` are pictograms; `hack` belongs to a
hack. The URL's `media` parameter is the **token** the file is asked for by:
`box-2D(us)`, `support-2D(eu)[1]`, region-less `fanart`, `maps(1,0)`.

**`rom` / `roms[]`.** `id`, `romfilename`, `romsize`, `romcrc`, `rommd5`,
`romsha1`, `romserial`, `romtype`, `romsupporttype`, `romnumsupport`,
`romtotalsupport`, `romcloneof`, flags `beta demo proto trad hack unl alt best
netplay`, and `regions`/`langues` as parallel arrays (`regions_shortname[]`…).

**Codes.** Regions (44): ae afr ame asi au bg br ca cl cn cus cz de dk eu fi fr
gr hu il it jp kr kw mex mor nl no nz oce pe pl pt ru se sk sp ss tr tw uk us
wor za (Spain is `sp`). Languages (21): cz da de en es fi fr hu it ja kr nl no
pl pt ru sk sv tr tw zh — in practice de/en/es/fr/it/pt.

**Errors** (plain text; a failed login is often HTTP **200**): 400 missing
fields / bad hash / path in `romnom`; 401 closed to non-members (server CPU >
60 %); 403 bad developer login; 404 not found; 423 fully closed; 426 software
blacklisted; 429 thread or per-minute limit; 430 daily quota; 431 too many
unrecognised ROMs today.

**Account (measured 25.09.2026).** Level 10, premium, **7 threads**, 100,000
requests/day, account-wide (the handheld's ES-DE scraping spends from the same
counter); `maxrequestspermin = 1024 × (maxthreads + 1)`; resets at midnight CET.

**Licence.** Media is CC BY-NC-SA 4.0 — the app credits ScreenScraper.fr.

### 16.3 Storage — the constraint and the choice

- Free plan: 1 GB storage, 5 GB egress, **no** image transformations (Pro only,
  billed per source image), no Smart CDN. Over quota: a one-off grace period,
  then **every request in the project returns 402** — tasks, food and training
  too. So a budget check in code is required, not optional.
- Edge functions: 2 s CPU per request, 150 s wall clock (free). WebP encoding in
  WASM (jSquash) measured 0.1–0.9 s CPU per image in Node and needed `.wasm`
  bundling that the hand deploys of the time (Dashboard) could not do —
  rejected. Deploys use the CLI since 12.10.2026, so the CPU cost is the
  remaining reason. ScreenScraper resizes for free (`maxwidth` +
  `outputformat`), so that is what Save uses.
- Measured sizes: box art 162–734 KB PNG → 24–61 KB at 640 px; a transparent
  logo 63 → 14 KB; a native-resolution pixel-art screenshot is 3–4 KB as PNG
  and gets *bigger* as JPEG (hence "small originals stay PNG").
- External stores were evaluated: Cloudflare R2 (10 GB free, free egress, but
  proper public serving needs a Cloudflare-hosted domain), Backblaze B2 (public
  buckets need payment history), ImageKit/Cloudinary (metered credits), GitHub
  Pages/jsDelivr (their terms forbid media hosting). None beats "store little,
  link the rest" for one user.
- **The model:** per media type **Copy** (resized copy, counted against the
  budget), **Online** (nothing stored; the `screenscraper-media` proxy streams
  it when viewed, browser-cached until its signature expires) or **Skip**.
  The function reads `game_media_usage()` and reserves room for the WHOLE save
  before copying anything (`decideMediaModes`); what does not fit is shown
  online instead and the result says so. The budget (default 800 MB) is capped
  at **850 MB** in code (`HARD_CAP_MB`; lowered from 950 MB on 04.10.2026 to
  leave 130 MB for the Kobo buckets — inbox 100, covers 20, sleep images 10,
  migrations 125/127), and the ES-DE pushes
  (`esde-content-sync`, `esde-media-sync`) refuse uploads past the same 850 MB
  with 413 `storage_full`. Unused copies can be found and deleted from the
  settings sheet (`cleanup`, dry run first). Defaults copy box front/back,
  screenshot, title screen, fan art and the HD logo (≈ 285 MB worst case for
  1,100 games), link 3D box/spine/texture/cartridge/Steam grid/logos/
  marquees/manual, skip composites/bezels/themes/pictograms/video.
- **The ES-DE originals** (537 MB on 25.09.2026; the card's full set is about
  2.5 GiB, see `docs/termux-widgets.md`) are the obvious reclaim — they are on
  the handheld's SD card anyway. On 13.10.2026 the owner deleted them; Storage
  keeps low-resolution pictures only (`docs/termux-widgets.md`).

### 16.4 The credential problem, solved twice

Every ScreenScraper URL carries all four credentials. The first version solved
it by downloading and re-hosting everything it showed (costly: every preview a
Storage object). The rewrite keeps that for **Save** and adds a proxy for
everything else:

- `screenscraper-media` takes `j` (game id), `s` (system id), `m` (their media
  token), optional `w`/`f` (resize), `e` (video/manual) and `k` — an HMAC-SHA256
  of `ssm2|<game>|<system>|<expiry>` (`x`) keyed from `SCREENSCRAPER_MEDIA_KEY`
  or, without it, the service-role key (hashed with a label first), truncated
  to 32 base64url characters, compared in constant time. The expiry is the end
  of NEXT week — one value all week, so URLs and browser caches stay stable,
  and no link outlives two weeks; a request claiming more than two weeks ahead
  is refused. `screenscraper-sync` issues it with every candidate
  (`media_sig` + `media_exp`) and, for saved games, per visit through the
  `sign` action — **it is never stored**. The browser can build a URL for ANY
  file of that game (at fixed widths 120/200/360/640/1280) and nothing else.
  JWT verification is off (an `<img>` cannot send a header).
- The function adds the credentials server-side, follows at most one redirect
  and never with them, passes through only file content types and a header
  whitelist (+ `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  inline disposition — manuals without the sandbox CSP, which PDF viewers
  refuse), and maps their plain-text answers to 404/503 without echoing them.
- `screenscraper-sync` is **owner only** (`HEVY_USER_ID`, else 403).

### 16.5 Contract (`screenscraper-sync`)

| Action | Body | Answer |
|---|---|---|
| `status` | — | account (level, premium, threads, used, max, misses), `remaining_today`, `storage` (per category + budget/hard cap), library counts, `systems_known` |
| `storage` | — | `{ total, groups[], budget_mb, hard_cap_mb }` from `game_media_usage()` — no ScreenScraper request |
| `refresh_systems` | — | re-reads `systemesListe.php` into `screenscraper_systems` (§6); `{ systems }` |
| `sign` | `items[{jeu_id, system_id}]` (≤ 60) | fresh `{sig, exp}` per game for the media proxy (never stored) |
| `search` | `name?`, `system?` (ES-DE folder or id), `rom?` `{filename,size,crc,md5,sha1,serial}`, `jeu_id?`, `previous_id?`, `use_name?`, `use_rom?` | `candidates[]` (normalized, signed), `outcomes[]` per lookup, `system`, `remaining_today` |
| `candidate` | `jeu_id`, `matched_by?` | one candidate (all dumps) + `record` (their answer minus URLs) |
| `apply` | `game_id`, `jeu_id`, `system?`, `rom?`, `fields{field: fill\|replace\|skip}`, `media[{type, token, mode: store\|on_demand}]`, `overrides{title_region, description_lang}`, `matched_by`, `prefs?`, `run_id?` | `result{outcome, verified_rom, written[], skipped[], media[], bytes_stored, remaining_today}` |
| `find_batch` | `game_ids` (≤ 10) | per game: best match (previous id → verified filename → name) or why not |
| `apply_batch` | `items[{game_id, jeu_id, system, rom_filename, matched_by}]` (≤ 5, deadline-bounded) | per game results (+ `not_started`), saved defaults |
| `undo` | `run_id`, `game_ids?` | latest apply per game only; restores prior values where unchanged since, removes copies nothing references |
| `cleanup` | `dry_run` | ScreenScraper copies nothing references: count/bytes, or deleted |

The browser never sends a field value — only choices. The function refetches the
entry (by ROM first when ROM info is known, so the answer carries this dump's
`rom` block), refuses when a different entry comes back (`stale`), and applies
the choices against the live row. A save clears `needs_review`; undo restores it.

### 16.6 Where the data lives

- `games.ss_jeu_id` / `ss_scraped_at` — the match marker. **Never**
  `external_source`/`external_ref`: those are the ES-DE sync's (`esde-sync`
  upserts on them); the first rewrite overwrote them and broke that sync for
  the affected games — migration 104 moves those ids to `ss_jeu_id` and puts
  `esde`/`manual` back.
- `games.provider_data` — a small v2 pointer only (`jeu_id`, `rom_id`, system,
  `matched_by`, `verified_rom`, `saved` type → Storage URL, `linked` type →
  chosen version token, `media_count`, `run_id`, `fetched_at`).
- `game_scrape_records` — one row per game: the normalized record (every
  title/date/rating board/dump/hack/tip, the full media inventory) and, with
  "Save their full record", their raw answer minus URLs. Owner read-only,
  written by the function, deleted by undo.
- `scrape_decisions` — the journal: `written_values`, `prior_values`,
  `replaced_paths`. The browser can read it (Recent saves) but not write it;
  no audit trigger (it is itself the audit).
- Storage `game-media/screenscraper/<game>/…` — copies only; unique paths per
  save, so undo can restore the previous copy and `cleanup` can find orphans.
- `screenscraper_prefs` — "What to save" (field policies, media modes, image
  size, region and language order, full-record switch, budget).

### 16.7 Known limitations — reviewed and accepted (26.09.2026)

- **Proxy links are per game, not per file** (`screenscraper-media`): one
  signature opens any file of that game on that system until it expires (end of
  next week). A leaked link can stream that game's manual or video for up to two
  weeks, spending the shared daily allowance; the proxy has no quota floor of its
  own (it cannot see the counter without an extra request per file). Accepted:
  the owner is the only user and links are never stored.
- **Undo does not bring back the previous full record** (`game_scrape_records`
  holds one row per game; undo deletes it). A re-scrape fetches it again.
- **The storage budget is checked per save**: two saves running at the same
  moment (two tabs) each reserve against the same usage reading and can
  overshoot the budget by one save's copies. The 850 MB hard cap and the ES-DE
  guard still hold.
- **Changing "What to save" during an open review** does not change that
  review's choices (they are seeded when it opens); the next review uses the new
  settings.
