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
| `ssuserInfos.php` | **403** | Fails with dev credentials alone — needs the *member* account password too (see §2) |
| `jeuRecherche.php` | **200**, ~2.3 MB | Fuzzy search by name. Returned 30 candidate games for one query |
| `jeuInfos.php` (match) | **200**, ~208 KB | Exact lookup by ROM filename. This is the endpoint the sync will use |
| `jeuInfos.php` (no match) | **404** | ⚠️ **plain text, NOT JSON** — see §4 |
| `systemesListe.php` | **200**, ~4.0 MB | 250 systems, carries the ES-DE/RetroPie folder-name mapping (§5) |

---

## 2. Auth: two independent credential pairs, and only one of them is set up

ScreenScraper wants **two** pairs, and they are not interchangeable:

- `devid` + `devpassword` — the *application* identity. **We have this and it
  works.**
- `ssid` + `sspassword` — the *user account*. **We do NOT have the password.**
  The "Password" column on the dev page is the devpassword, not this one.

Consequence, measured from the live `ssuser` block on an anonymous call:

```
niveau:             0        ← anonymous, premium NOT recognised
maxthreads:         1        ← one request at a time
maxrequestsperday:  10000
maxrequestspermin:  3072
maxdownloadspeed:   128      (KB/s)
```

### Why a paid premium membership changes nothing *yet* — measured, not assumed

The user has a paid premium membership. It is **not being applied**, and the
reason is mechanical rather than a quota problem:

- `ssuser.id` comes back as `""` (empty) on our calls. **The API does not know
  who is calling** beyond the dev-app identity. Membership is attached to the
  *member account*, and we never send member credentials, so there is nothing
  for it to apply the benefit to.
- Sending `ssid=Lasciviens` with the **dev** password returns `403
  Erreur de login`. That 403 is itself the proof the pair *is* validated — we
  simply have the wrong password in that slot.
- Forcing a level through the documented debug mode
  (`devdebugpassword` + `forcelevel`) was tried at levels 0, 1, 20, 30 and 99.
  **Every one returned identical limits** (`niveau=0, maxthreads=1,
  req/day=10000`), because `forcelevel` overrides a *logged-in user's* level and
  there is no logged-in user to override.

Also worth knowing: `userlevelsListe.php` returns **contribution** ranks
(Membre → Contributeur → … → Admin), i.e. how much you have contributed to the
database. Those are a different axis from the paid membership and are not what
unlocks throughput on their own.

**So the fix is one missing string:** the password used to log in to
screenscraper.fr as the member `Lasciviens`. Not the dev password, not the debug
password — those are already in hand and are a separate pair.

**Verdict: 10 000 requests/day is comfortably enough** for a library of a few
thousand ROMs scraped once and then only on changes, so this is **not a
blocker** for building the sync. What it costs today is `maxthreads: 1` — a
strictly sequential scrape, and a 128 KB/s media download cap. Supplying the
member password lifts both.

**TODO (user):** supply the ScreenScraper *member account* password (your
screenscraper.fr website login). Store in Vault as `SCREENSCRAPER_SSID` /
`SCREENSCRAPER_SSPASSWORD`. Then re-run the measurement above to record the real
premium numbers here, replacing the anonymous ones.

---

## 3. ⚠️ Security finding: media URLs embed the credentials in plaintext

This is the single most important finding here.

Every media entry the API returns carries a ready-made URL that has **our
devid and devpassword inline**:

```
https://neoclone.screenscraper.fr/api2/mediaJeu.php
  ?devid=<DEVID>&devpassword=<DEVPASSWORD>&softname=...
  &ssid=&sspassword=&systemeid=1&jeuid=3&media=sstitle(wor)
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

- [ ] Member account password → premium threading. **Confirmed to be the only
      thing standing between us and the paid benefits** (see §2); the dev and
      debug passwords are already in hand and do not carry membership
- [ ] Image strategy: mirror into Supabase Storage (recommended) vs. on-demand
      signed URL via edge function
- [ ] Where the ScreenScraper score (`note`, /20) lives, if anywhere — must not
      collide with the user's own `games.rating`
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

## 9. Reading the ES-DE export without burning tokens

A full ES-DE export is megabytes of XML across dozens of system folders.
Pasting that into a chat to "let Claude look at it" would cost an enormous
number of tokens to learn three things:

1. which `<game>` child tags ES-DE *actually* writes (vs. what the docs claim),
2. how `<path>` values are shaped (the join-key candidate),
3. how many games there are per system, and how many carry real play stats.

`scripts/inspect-esde-gamelist.mjs` answers exactly those **locally** and prints
a compact report — tens of lines, not megabytes. It is read-only and uploads
nothing.

```
node scripts/inspect-esde-gamelist.mjs <folder> [--sample]
```

`<folder>` is wherever the ES-DE export was copied to — the script **searches
downwards** for every `gamelist.xml`, so the exact level does not have to be
right, and a wrong path prints where to look instead of failing silently.
`--sample` adds one full `<game>` block per system for the first three systems.

**Workflow: run it, paste the OUTPUT, never the XML.** That output is enough to
finalise the field mapping and the migration. The full files only ever need to
be read by the sync script itself, on the device — never by a human or a model.
