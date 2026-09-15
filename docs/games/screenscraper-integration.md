# ScreenScraper + ES-DE integration — working notes

> **TEMP / WORKING DOC.** This is the scratchpad for the Games auto-scrape work
> (ScreenScraper metadata + ES-DE play-stats sync). Fold the settled parts into
> `CLAUDE.md`'s Games Feature Detail and delete this file once the feature ships.
>
> **No credentials live in this file, and none ever should.** `devid` /
> `devpassword` / the member password belong in Supabase Vault only. See the
> security finding below — this is not a formality, the API leaks them if you
> are careless.

Last verified live: **2026-09-15**, against `api.screenscraper.fr/api2`.

---

## 1. What was verified live (not guessed)

Every shape below came from a real call made during this session, per this
repo's "never add a speculative external-API field" rule.

| Endpoint | Result | Notes |
|---|---|---|
| `ssuserInfos.php` | **403** → **200** | 403 with dev credentials alone; 200 once the member `ssid`/`sspassword` are sent (see §2) |
| `jeuRecherche.php` | **200**, ~2.3 MB | Fuzzy search by name. Returned 30 candidate games for one query |
| `jeuInfos.php` (match) | **200**, ~208 KB | Exact lookup by ROM filename. This is the endpoint the sync will use |
| `jeuInfos.php` (no match) | **404** | ⚠️ **plain text, NOT JSON** — see §4 |
| `systemesListe.php` | **200**, ~4.0 MB | 250 systems, carries the ES-DE/RetroPie folder-name mapping (§5) |

---

## 2. Auth: two independent credential pairs, and only one of them is set up

ScreenScraper wants **two** pairs, and they are not interchangeable:

- `devid` + `devpassword` — the *application* identity. **We have this and it
  works.**
- `ssid` + `sspassword` — the *user account*, and what carries the **paid
  membership**. This is the screenscraper.fr website login, NOT the "Password"
  column on the dev page (that one is the devpassword). Now in hand and
  verified working.

Consequence, measured from the live `ssuser` block on an anonymous call:

```
niveau:             0        ← anonymous: no member credentials sent
maxthreads:         1
maxrequestsperday:  10000
maxrequestspermin:  3072
maxdownloadspeed:   128      (KB/s)
```

### Premium IS recognised once the member credentials are sent — measured

The paid membership hangs off the **member account**, not the dev app. Sending
`ssid` + `sspassword` (the screenscraper.fr website login) alongside the dev
pair switches it on. Measured on a real `ssuserInfos.php` call and confirmed
again on a real `jeuInfos.php` call:

| | anonymous (dev only) | **premium (member sent)** | change |
|---|---|---|---|
| `niveau` | 0 | **1** | identified |
| `maxthreads` | 1 | **6** | 6× parallelism |
| `maxrequestsperday` | 10 000 | **100 000** | 10× |
| `maxrequestspermin` | 3 072 | **7 168** | 2.3× |
| `maxdownloadspeed` | 128 KB/s | **2 176 KB/s** | **17×** |
| `maxrequestskoperday` | 1 000 | 10 000 | 10× |

The 17× media download speed is the one that matters most for a first full
scrape, since cover art is the bulk of the bytes. Six threads also means the
scrape no longer has to be strictly sequential.

**Watch the shared daily counter.** That same call reported
`requeststoday: 24160` — the quota is per *account*, so scraping done on the
device itself (ES-DE's own scraper) spends from the same 100 000. Read
`requeststoday` at the start of a run and back off rather than assuming a fresh
budget.

Earlier dead ends, recorded so nobody retries them: forcing a level via the
documented debug mode (`devdebugpassword` + `forcelevel`) at 0/1/20/30/99
returned identical anonymous limits every time, because `forcelevel` overrides a
*logged-in* user's level and there was no logged-in user. And
`userlevelsListe.php` returns **contribution** ranks (Membre → Contributeur →
Admin), a different axis from the paid membership.

**Store as** `SCREENSCRAPER_DEVID` / `SCREENSCRAPER_DEVPASSWORD` /
`SCREENSCRAPER_SSID` / `SCREENSCRAPER_SSPASSWORD` in Supabase Vault. All four
are needed; the pairs are not interchangeable.

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

This account reads **6 threads** = 1 base + 5 donor, matching its panel
(`Member donor (1) / Developer`). Contributor tier is earned by contributing
data, not bought.

### ⚠️ `requeststoday` is NOT the panel's "Scrapes Today", and NOT a clean counter

The user's panel showed `Scrapes Today: 30 / 100000` while the API's
`ssuser.requeststoday` read **24 320** at the same moment. Measured directly:

- calling `ssuserInfos.php` repeatedly did **not** move the counter (5 reads,
  4 s apart, all `24330`) — so status reads are free;
- **3 real `jeuInfos` calls moved it by 10**, not by 3.

So `requeststoday` counts something coarser and/or wider than "scrapes this
tool made" — it does not increment 1:1 with our requests, and it does not agree
with the figure the website shows. **Do not build pacing on the assumption that
it is our own request count.** Read it as a rough ceiling indicator only; do the
real pacing client-side, from requests we actually issued.

### Pacing rule to implement

- **Sleep ~1.2 s between requests.** Skyscraper hard-codes
  `limitTimer.setInterval(1200)` with the comment that it is "set a bit above
  1.0 as requested by the good folks at ScreenScraper". That is a politeness
  contract with the service, not just a technical limit — honour it even though
  our measured `maxrequestspermin` is far higher.
- **Never exceed `maxthreads`** (6 here). RomM's issue documents the formula
  `maxrequestspermin = threads × 50`; note our account reports **7168**, which
  does not fit that formula, so prefer the reported field over the formula and
  prefer the 1.2 s floor over both.
- **Track KO (not-found) separately.** `maxrequestskoperday` is 10 000 here and
  is its own budget. A library full of unmatched files burns it fast — which is
  exactly why the `._` AppleDouble sidecars and the `androidapps`/`steam`
  pseudo-systems (§9) must be filtered out *before* scraping, not discovered as
  failures.

### Failure signals to branch on

Confirmed live: the API signals via **HTTP status**, and the body of a failure is
**plain text, not JSON** (§4). Verified headers carry no rate-limit metadata —
no `Retry-After`, no `X-RateLimit-*`; the response headers are plain nginx +
CORS only. So status code is the only structured signal.

Skyscraper additionally matches these strings, which are worth recognising
because they mean *stop*, not *retry*:

| String | Meaning |
|---|---|
| `Votre quota de scrape est …` | daily quota exhausted |
| `API totalement fermé` | API fully closed |
| `API fermé pour les non membres` / `API closed for non-registered members` | closed to non-members |
| `Le logiciel de scrape utilisé a été blacklisté` | this software is blacklisted |
| `non trouvée` | game not found (normal) |

Skyscraper retries up to **4 times** on ordinary failures but **never** on
blacklist / quota / API-closed / invalid-JSON — those abort the run. Mirror
that: retrying a quota error just deepens the hole.

### Practical budget for our case

The whole library is well under 10 000 games (§9). At 1.2 s/request sequentially
that is a few hours for a first full pass, and essentially nothing on the
incremental runs afterwards. **The quota is not the binding constraint; the
politeness interval is.** There is no reason to push threads to 6 for a one-off
backfill that can simply run in the background.

---

## 3. ⚠️ Security finding: media URLs embed the credentials in plaintext

This is the single most important finding here.

Every media entry the API returns carries a ready-made URL with credentials
inline — and once the member pair is sent (which we now do, for premium), the
URL carries **the account password too**, not just the dev one:

```
https://neoclone.screenscraper.fr/api2/mediaJeu.php
  ?devid=<DEVID>&devpassword=<DEVPASSWORD>&softname=...
  &ssid=<SSID>&sspassword=<ACCOUNT PASSWORD>&systemeid=1&jeuid=3&media=sstitle(wor)
```

The same is true of `systemesListe`'s `medias[].url`.

**Therefore:**
- **Never store a ScreenScraper media URL verbatim** in `games.primary_cover_url`,
  `screenshot_url`, `fanart_url`, or anywhere else in the DB. Those columns are
  read by the browser, so doing this would ship our API credentials to the client
  and into every DB backup.
- The sync must either (a) download the image server-side and re-host it in
  Supabase Storage, or (b) store only the *parameters* (`systemeid`, `jeuid`,
  `media` type) and have an edge function rebuild the signed URL on demand.
- **(a) is the better fit** — it matches how this app already treats external
  media, and it removes the runtime dependency entirely. It also sidesteps the
  128 KB/s anonymous download cap being hit on every page view.

---

## 4. ⚠️ Error responses are plain text, not JSON

Both failure modes return a non-JSON body. Parsing the response as JSON
unconditionally will throw before the error is ever inspected:

| Condition | HTTP | Body (verbatim) |
|---|---|---|
| ROM not found | `404` | `Erreur : Rom/Iso/Dossier non trouvée !` |
| Bad credentials | `403` | `Erreur de login : Vérifier les identifiants utilisateurs !` |

The sync must branch on **status code first**, and only parse JSON on `200`.
A 404 is a normal, expected outcome (an unmatched ROM) — it should mark the row
`needs_review`, never fail the run.

---

## 5. Field mapping → our `games` schema

Real response keys from `jeuInfos.php` → `response.jeu`:

```
id, romid, notgame, noms, cloneof, systeme, editeur, developpeur,
joueurs, note, topstaff, rotation, synopsis, classifications, dates,
genres, modes, familles, tips, actions, medias, roms, rom
```

| Our column | ScreenScraper source | Shape / gotcha |
|---|---|---|
| `title` | `noms[]` | Array of `{region, text}` — regions seen: `ss`, `us`, `jp`, `eu`. Pick `ss` (ScreenScraper canonical) first, then `us`, then `eu` |
| `release_year` | `dates[]` | Array of `{region, text}`, text is `YYYY-MM-DD`. Take the earliest, or match the ROM's own region |
| `publisher` | `editeur.text` | `{id, text}` |
| `developer` | `developpeur.text` | `{id, text}` |
| `description` | `synopsis[]` | Array of `{langue, text}` — pick `langue == 'en'` |
| `genres` (text[]) | `genres[]` | Each has `noms[{langue,text}]`; take the `en` entry. `principale: "1"` marks the primary genre |
| `series_name` | `familles[]` | **This is the series** ("Sonic"). Same `noms[{langue,text}]` shape; often only `fr` exists — fall back to any language |
| `players` | `joueurs.text` | A **range string** like `"1-2"`, not an integer |
| `modes` | `modes[]` | Same multi-language `noms[]` shape |
| `age_rating` | `classifications[]` | Array of `{type, text}` — types seen: `SS`, `PEGI`, `CERO`, `ESRB`, `Tectoy`. Prefer `PEGI`, else `ESRB` |
| `external_ref` | `jeu.id` | The stable ScreenScraper game id |
| `external_source` | — | Literal `'screenscraper'` (already in the CHECK) |
| `primary_cover_url` etc. | `medias[]` | **See §3 — do not store the URL** |

**`note.text` is a rating out of 20**, not out of 10 or 100 (`"17"` = 17/20).
Convert deliberately; do not write it into a 1-10 `rating` column raw — and note
that `games.rating` is the user's OWN score, so a ScreenScraper score probably
belongs in a separate column or nowhere at all.

### Media types available (26)

```
bezel-16-9, box-2D, box-2D-back, box-2D-side, box-3D, box-texture,
fanart, manuel, mixrbv1, mixrbv2, pictocouleur, pictoliste,
pictomonochrome, screenmarquee, screenmarqueesmall, ss, sstitle,
steamgrid, support-2D, support-texture, themehs, video,
video-normalized, wheel-carbon, wheel-hd, wheel-steel
```

Each entry: `{type, parent, url, region, crc, md5, sha1, size, format}`.
For our three columns: `box-2D` → cover, `ss` (in-game screen) → screenshot,
`fanart` → fanart.

### The `rom` block — exact-match keys

`jeu.rom` carries `romfilename`, `romcrc`, `rommd5`, `romsha1`, `romsize`,
`romregions`, plus flags (`beta`, `demo`, `proto`, `hack`, `unl`, `alt`, `best`).
**CRC/MD5/SHA1 matching is far more reliable than filename matching** — if the
device-side script can compute a CRC32 per ROM, use `crc=` instead of `romnom=`.

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
join key: an ES-DE `roms/megadrive/` folder → `systemeid=1`. Build this map
ONCE and cache it (it is a 4 MB response; re-fetch quarterly at most).

Also on each system: `extensions` (`"gen,md,smd,bin,sg"`) and `romtype`.

---

## 7. Open decisions

- [x] ~~Member account password → premium~~ **DONE** — supplied and verified;
      real premium numbers recorded in §2
- [ ] Image strategy: mirror into Supabase Storage (recommended) vs. on-demand
      signed URL via edge function
- [x] ~~Where an external score lives without colliding with the user's own
      `games.rating`~~ **DECIDED** (§10) — `games.rating` is `numeric(3,1)`
      0-10 and is the USER's own score; nothing external ever writes it. Every
      provider score goes to `game_platforms.rating`, which 089 already sized
      `numeric(4,1)` 0-100 for exactly this. ES-DE's 0-1 decimal is stored
      there ×100; ScreenScraper's /20 will be ×5. One column, one scale, and
      the user's score is never touched
- [ ] Whether the device script can compute CRC32 (→ much better matching)

---

## 8. ES-DE transport — decision and rationale

See the repo discussion; summary of the agreed shape:

**Phase 1 — one-time full export (manual).** Pull the ES-DE `gamelist.xml`
files off the device once, land them somewhere reachable, and do the initial
bulk import. No automation needed for this; it happens once.

**Phase 2 — incremental push from the device.** A small script on the RP6
(Termux) reads the gamelist files, sends only what changed, and is triggered
manually/occasionally rather than on a schedule.

**Why a device-side push, not a cloud-side pull:** Supabase's `pg_cron` can only
reach things that are already on the internet. The RP6 is behind home NAT with
no stable address, so a cron job can never "go get" the file. The device has to
initiate. This is exactly the pattern `phone-gateway` already uses (device holds
a secret, POSTs to an edge function, function acts as the single user with the
service role) — reuse it rather than inventing a second one.

**Syncthing vs KDE Connect vs Termux script:**

| Option | Verdict |
|---|---|
| **KDE Connect** | ✗ Not suited. It is a phone↔desktop pairing tool (notifications, clipboard, ad-hoc file send). It has no unattended folder-sync daemon, so nothing would happen unless you pushed the file by hand every time |
| **Syncthing** | ~ Works, but solves the wrong half. It would keep `gamelist.xml` mirrored to your MacBook continuously — good for Phase 1 convenience, but it still needs a *second* step to get the data into Supabase, and the Mac has to be on. It adds a moving part without removing one |
| **Termux script → edge function** | ✓ **Recommended.** One hop, no intermediate device, no always-on node. The script parses the XML on-device, diffs against a stored hash, and POSTs only changes. Matches `phone-gateway`'s existing security model exactly |

**Incremental strategy (the "only updates, not everything" requirement):** store
a per-file hash (or per-game `lastplayed`/`playcount` fingerprint) on the device
after each successful push, and send only rows whose fingerprint changed. The
server side stays a plain idempotent upsert keyed on `(system, rom filename)`,
so a full re-push is always safe if the local state is ever lost.

**Ownership: Codex owns the device-side Termux script** (user decision,
2026-09-15). It lives under `scripts/` and touches the device, not `src/` or
`supabase/`, which matches Codex's existing side of the two-AI split in
`CLAUDE.md`. Claude owns the receiving end (the edge-function action, the
migration and the schema). Revisit later if that split stops fitting.

---

## 9. The real ES-DE export — measured, 2026-09-15

Run against the user's actual export (`ES-DE Copy`, ES-DE **3.4.1-58 (r51)**,
Android app on an Adreno 740 device). **Self-check passed** — `<path>` count
equals `<game>` count in every file, so every number below is measured, not
estimated.

**1.3 MB total.** 33 files; 26 `gamelist.xml` (24 live + 2 stale CLEANUP
snapshots) totalling 1.2 MB. `downloaded_media` was not copied and is not
needed. Only `gamelists/` plus two config files are in scope.

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
21 AppleDouble sidecars (below). At the measured premium ceiling that is a
single-digit-minute full pass, and incremental runs are far smaller.

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

**`altemulator` does NOT appear in this export.** An earlier draft of this
section listed it from a mis-parsed sample; the verified run shows 18 distinct
`<game>` child elements and `altemulator` is not among them. Do not write an
importer branch for it.

**`playtime` is the find.** `games` already has empty `esde_playcount` /
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
   quota. (They exist in the *copy*; whether the device itself has them is worth
   confirming before the device-side script assumes either way.)
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
  system. `platform` is the natural bridge to ScreenScraper's system ids (§6);
  `extension` says which files are even candidate ROMs.
- **`custom_systems/es_find_rules.xml`** (55 entries) — emulator discovery. Not
  useful to us.
- **`settings/es_settings.xml`** (9 KB) — 103 `<bool>`, 53 `<string>`, 17
  `<int>`. App preferences; nothing we need.
- **`collections/custom-mario.cfg`, `custom-pokemon.cfg`** — both **empty**, so
  there is no custom-collection data to import today.

### Running it

```
node scripts/inspect-esde-export.mjs        # native macOS folder picker
node scripts/inspect-esde-export.mjs /path/to/ES-DE
```

`--deep` also descends into media/theme folders, `--full` prints longer samples.
READ-ONLY, uploads nothing. Paste the OUTPUT, never the files.

---

## 10. The gateway contract — `import_esde_games`

**This section is the contract.** The device-side script (Codex, C7) and the
edge-function handler (Claude) are written against it; neither side may assume
anything it does not state. Everything here is derived from the measured export
in §9, not from what ES-DE could theoretically emit.

### Endpoint

```
POST https://<project>.supabase.co/functions/v1/esde-sync
Content-Type: application/json
x-esde-secret: <ESDE_SYNC_SECRET>
```

**Its own function and its own secret, not an action on `phone-gateway`.**
§8 said "reuse the phone-gateway *pattern*", and that is what this does — device
holds a static revocable secret, POSTs to an edge function, the function
resolves the single user server-side with the service role, which never leaves
the server. But `phone-gateway` is the *iPhone's* door and carries the iPhone's
secret. This is a different physical device with a different lifecycle:
revoking the handheld must never revoke the phone's Shortcuts, and vice versa.
Same pattern, separate door.

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
| `action` | yes | exactly `import_esde_games` |
| `timezone` | no | IANA zone the device's timestamps are in. Defaults to `Europe/Oslo` — the only zone in play. Resolved DST-safely server-side, same two-pass technique `import_body_composition` already uses |
| `batch`, `batches` | no | purely informational, echoed back so a partial run is legible in the device's own log. They carry **no server state** — see "Batching" below |
| `games` | yes | 1-150 entries |

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

`system` (the folder name), `path` and `name` are **required** — they are the
only three fields §9 measured at 100 % (`name` at 100 %, `path` at 100 %, and
`system` is the folder the file was read from). Every other field is omitted
when ES-DE did not write it; **do not send `null`, an empty string or a zero
for a missing value** — absent and zero are different facts, especially for
`playcount`/`playtime`.

**Send ES-DE's values verbatim.** Do not reformat the timestamps, do not split
`genre` on the comma, do not rescale `rating`, do not resolve `path` to an
absolute path. Every one of those conversions is the gateway's job, and doing
it twice is how the two sides drift apart.

### What the device must NOT send

All four are measured facts from §9, not defensive guesses:

1. **`androidapps`, `androidgames`, `emulators`, `steam`** — launcher
   shortcuts, not ROMs (a real entry is `./Settings.app`). 4 games total.
2. **Any path whose basename starts with `._`** — macOS AppleDouble sidecars,
   21 of them. Present in the Mac copy; confirm whether the device itself has
   them rather than assuming either way.
3. **`<folder>` elements** — directory entries that carry their own metadata
   and are not games (switch 7, genesis 3, n3ds 3, nes/snes/wiiu 1 each).
4. **Anything under `gamelists/CLEANUP/`** — ES-DE's own dated backups. Real
   files, stale data.

After those exclusions the real payload is **1125 games**.

### Batching

Batches are **independent and idempotent**. There is no run id, no server-side
assembly, and no ordering requirement: the server upserts whatever arrives and
answers for that request alone. A failed batch is retried by re-sending it
unchanged; a full re-push is always safe. That is deliberate — it removes the
entire class of "half a sync is stuck in the database" failure, and it is why
no `esde_sync_runs` table exists (093's header note).

Cap a request at **150 games**, so the full library is 8 requests.

### Response

```json
{ "status": "ok", "batch": 1, "received": 150,
  "created": 148, "updated": 2, "skipped": 0, "flagged": 1 }
```

- `skipped` — entries the server itself declined (`hidden: true`).
- `flagged` — rows written with `needs_review = true` (`broken: true`).
- `400 { "status": "validation_error", "errors": { "3": "path is required" } }`
  — keyed by the entry's index in `games`. **Nothing is written**; the whole
  batch is rejected, so a fixed-and-resent batch cannot double-apply.
- `500 { "status": "server_error", … }`.

### What the server does with each field

| Incoming | Lands as |
|---|---|
| `system` | `game_platforms.esde_system` (the key) **and** `game_platforms.system` on create only — after that the display value is the user's to rename |
| `path` | `game_platforms.esde_path` (the key) |
| `name` | `games.title` |
| `desc` | `games.description` |
| `developer`, `publisher` | same-named `games` columns |
| `genre` | split on `,`, trimmed → `games.genres text[]` |
| `players` | `games.players` verbatim (it is a range string, `1-2`) |
| `releasedate` | year → `games.release_year`; full date → `game_platforms.release_date` |
| `rating` (0-1) | `game_platforms.rating` **×100**. Never `games.rating` — that is the user's own 0-10 score (§7) |
| `playcount`, `playtime`, `lastplayed` | rolled up onto `games` (below) |
| `broken: true` | `needs_review = true` on both rows |
| `hidden: true` | entry skipped entirely |
| — | `external_source = 'esde'`, `synced_at = now()` |

**Timestamps.** `YYYYMMDDTHHMMSS` with no offset — ES-DE writes local wall-clock
time. Resolved through the request's `timezone` using the same DST-safe
two-pass conversion `import_body_composition` uses, never a hardcoded offset.

**Play-statistic roll-up.** 089 put `esde_playcount` / `esde_playtime_seconds`
/ `esde_last_played` on `games`, while ES-DE reports per (system, file) — i.e.
per variant. When a game holds more than one variant the server **sums**
playcount and playtime and takes the **max** `lastplayed` across them. For the
1125 games here that is a no-op (one variant each); it only matters once a
title is manually merged across systems later, and summing is the only
answer that does not silently discard a real play session.

**Matching.** The upsert target is the partial unique index migration 093
creates: `(user_id, esde_system, esde_path)`. No row → create one `games` row
plus one `game_platforms` row. **One ES-DE entry always becomes one game row.**
The server never merges two entries into one game by title similarity — a
title appearing on two systems is a real, intentional shape (089's own note),
and deciding that two files are the same game is a curation judgement, not
something a sync should guess at.

### Where the pieces stand

| Piece | Owner | State |
|---|---|---|
| Migration 093 (the sync key + per-variant stat columns) | Claude | written, **not applied** |
| `supabase/functions/esde-sync/` | Claude | written, **not deployed** |
| `ESDE_SYNC_SECRET` in Supabase Vault | user | not set |
| Device-side reader + pusher (C7) | Codex | not started, unblocked by this section |
| ScreenScraper enrichment | Claude | not started — deliberately AFTER the import, see §11 |

---

## 11. Order of operations — import first, scrape second

Worth stating plainly because the intuitive order is backwards.

**Step 1 — ES-DE into the database.** Codex's script reads the gamelists on the
device and POSTs them to `esde-sync`. No ScreenScraper involvement at all. §9
measured the metadata at **97-98 % already filled**, because ES-DE has scraped
this library before, so this single step lands a working library: 1125 games
with titles, descriptions, developers, publishers, genres, release years,
players and ratings, plus the play statistics nothing else in this app has.

There is no intermediate hop — no MacBook, no file transfer. The one-time full
import and the later incremental pushes are the same code path with a different
number of rows, which is also why the first run needs no separate script.

**Step 2 — ScreenScraper fills what is left.** Two real gaps: the ~2 % of games
ES-DE never matched, and artwork (the device's `downloaded_media` folder is
15 GB and was deliberately not copied). That is a much smaller, much cheaper job
than scraping 1125 games from nothing — and at the premium limits measured in
§2 it is minutes, not an overnight run.

**Why not scrape first:** a scraper has to be told what to look for. Before
step 1 the database is empty, so there is nothing to enrich and no way to tell
a match from a miss. After step 1 every row carries a real title, system and
filename — which is exactly what ScreenScraper matches on. Doing it in the
other order means scraping blind and then trying to reconcile two independently
built libraries.
