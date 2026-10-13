# ScreenScraper — the first version (archived)

> **Archived 13.10.2026:** these sections described the first scraper (studio, `apply_match`, `apply_reviewed`, `scrape`), deleted in the 25.09.2026 rewrite; the current design is §16 of [`docs/games/screenscraper-integration.md`](../games/screenscraper-integration.md), and a § number not in this file points into that one.

## 7. Open decisions

- [x] ~~Member account password → premium~~ **DONE** — supplied and verified;
      real premium numbers recorded in §2
- [x] ~~Image strategy~~ **DECIDED — mirror into Supabase Storage.** A URL the
      browser must fetch cannot be hidden from it: whatever goes in `<img src>`
      is visible in devtools and stored in every backup of that row, so the only
      real fix is that the browser never receives a ScreenScraper URL at all.
      The alternative (keep the reference, proxy each view through an edge
      function) removes the storage cost and replaces it with a far worse one —
      every thumbnail view becomes one function invocation plus one
      ScreenScraper download, spending the premium 2176 KB/s and the shared
      100k/day counter on page views rather than on scraping. Mirroring is
      one-time and, at premium speed, cheap: ~150-250 MB for 1210 covers.
      **Hard rule: `primary_cover_url` / `screenshot_url` / `box_url` hold a
      Storage URL only — never a ScreenScraper one.**
- [x] ~~Where an external score lives without colliding with the user's own
      `games.rating`~~ **DECIDED** (§10) — `games.rating` is `numeric(3,1)`
      0-10 and is the USER's own score; nothing external ever writes it. Every
      provider score goes to `game_platforms.rating`, which 089 already sized
      `numeric(4,1)` 0-100 for exactly this. ES-DE's 0-1 decimal is stored
      there ×100; ScreenScraper's /20 will be ×5. One column, one scale, and
      the user's score is never touched
- [x] ~~Whether the device script can compute CRC32~~ **DECIDED — not a
      blocker, revisit as a cheap win.** Matching proceeds on `romnom` +
      `systemeid`, which is the path §1's own successful `jeuInfos` 200 used.
      It is sufficient where it actually matters right now: all 96 games
      missing metadata are `.sfc` with No-Intro names
      (`Super Mario RPG - Legend of the Seven Stars (USA).sfc`), the best case
      for filename matching. Worth picking up later because it is nearly free
      for part of the library: 495 of 1210 entries are `.zip`, whose inner
      CRC32 is readable straight from the archive's central directory with no
      decompression, and file size is a `stat()`. Skip it for the 148 disc
      images (`.chd`/`.iso`/`.rvz`) — hashing those means reading tens of GB on
      a handheld.

---

## 12. Search + hand-picked match (added 16.09.2026)

The automatic pass matches on a ROM **filename**, which is all `jeuInfos.php`
is given. "Contra (USA).zip" landing on Contra III is therefore a normal
outcome, not a bug with a one-time fix — the library needs a way to correct a
match by hand, and a way to approve matches before they are written.

### `search`

`{ action: 'search', query, system? }` → `jeuRecherche.php` (verified live,
§1: 200, 30 candidates for one query), optionally scoped by ES-DE system name
through the same lowest-id-wins alias map the scrape path uses. Returns up to
12 candidates.

**No image URL crosses the boundary.** Every ScreenScraper media URL carries
`devid`/`devpassword` in its query string, so a candidate can only report
`has_cover: true|false`. Artwork is fetched server-side and re-hosted for the
one candidate actually chosen.

### `apply_match`

`{ action: 'apply_match', game_id, jeu_id, query, system?, dry_run? }`.

It **re-runs the same search** and takes the entry with the chosen id, rather
than fetching that id directly. `jeuInfos.php` has a documented `gameid`
parameter, but this session had no way to call the API (the credentials live in
Vault, reachable only from the deployed function), and this repo does not ship
an external field it has not confirmed live. `jeuRecherche` IS confirmed, and
it returns complete game entries — that is why 30 of them weigh 2.3 MB — so the
chosen entry already carries everything a match needs. Cost: one extra search
call per apply. **If a later session can verify `gameid` against the live API,
switching to it removes that call.**

Writes follow the automatic path exactly: `fillOnlyMissing` (nothing the user
entered is overwritten), artwork mirrored into the `game-media` bucket, the
provider score onto `game_platforms.rating` (never `games.rating`). One
difference: a hand-picked match also clears `needs_review`, since choosing it
IS the review.

### `scrape` gained a `systems` scope

`{ action: 'scrape', systems: ['snes','n64'] }` narrows the automatic candidate
pick to those ES-DE systems. The scope is walked in slices of 200 ids
(PostgREST's `.in()` is URL-length bound — 200 ≈ 7.4 KB is safe, 1000 is a
measured 400) until enough unscraped games are found, rather than truncating at
the first slice and reporting "nothing left" while later slices still held work.

---

## 13. The workbench (16.09.2026)

The first review UI was one button reading "look up next 6". It chose the six
itself, so the only thing worth knowing — WHICH six — became visible after the
answers came back, when it was too late not to ask. Two deeper problems were
found reviewing it, and both were real:

**Approval was not bound to what was reviewed.** The dry run and the apply were
two independent `jeuInfos.php` calls. The user approved the result of lookup A
and the app wrote whatever lookup B returned. Usually identical; nothing
guaranteed it, and nothing checked it.

The apply still re-fetches — that is how the check is made — so the flow does
cost two metadata calls per approved game. **That is the price of the
guarantee, not a defect, and the UI quotes both halves** ("≈ 6 to look up,
6 more to save") rather than showing one and spending the other. Dropping the
second call would mean trusting a payload the client sends back, which is the
weaker design.

**The dry run returned field NAMES, never values.** "Would fill: description,
genres" cannot be approved by anyone — approving means reading the description
and seeing whose game it describes.

### What replaced it

| Piece | What it is |
|---|---|
| `screenscraperStudio.ts` | Pure logic: what a game is missing, candidate selection, request-cost projection, quota verdict, title-confidence, undo derivation. (Deleted with the studio in the 25.09.2026 rewrite, §16.) |
| `apply_reviewed` | Writes EXACTLY the reviewed entry. Carries the `jeu_id` that was shown; if the fetch answers with a different entry it returns `stale_proposal` and writes nothing. `fillOnlyMissing` still runs against the live row, so the client can only ever narrow a write, never widen it. |
| `proposed` on a dry run | The actual values, truncated at 600 chars, so a field can be read before it is accepted. Per-field checkboxes, defaulted on. |
| Candidate art | The cover is mirrored to `game-media/pending/<game_id>/<jeu_id>/cover.<ext>` at REVIEW time and promoted by a Storage **copy** on approval — no second image download. The browser still never receives a ScreenScraper URL. Note the bucket is world-readable by policy (094), so this prefix is separated from the database and the canonical paths, **not** from the internet. `sweep_pending` clears what nobody approved, and a "Clear unused art" button calls it. |
| `scrape_decisions` (097) | Every decision, durably. Progress across sessions, and the substrate for undo. |
| `undo_run` | Reverts a whole run. Costs nothing against the quota. It nulls the fields the run wrote, but **only where the live value still equals `written_values`** — a field edited since belongs to the user and is reported back rather than cleared. A first draft compared against `null` instead, which detects nothing and would have destroyed a hand-rewritten description while claiming it could not. Storage objects are removed only for columns actually cleared, and `needs_review` is restored only if it is still what the apply left. |
| Pacing | §2b's ~1.2 s interval between waves, which the code promised in writing and had never implemented. |
| Match signals | The ROM filename the match was made on, the system actually searched, and the entry's own `notgame`/hack/beta/proto/region flags — all present in every response and previously discarded. |

### Deliberately NOT built

- **A confidence percentage, and anything auto-approved by one.** There is no
  ground truth to calibrate a threshold against, this repo has a standing rule
  against synthetic composite metrics (Health's "no derived sleep metrics",
  `RecoveryLoadPanel`'s refusal of a readiness score), and a number invites the
  auto-approve button that defeats the reason a review step exists. The signals
  are named observations instead.
- **An "overwrite existing fields" mode.** `fillOnlyMissing` is load-bearing
  three times over: it protects the user's own curation, it protects ES-DE's
  98%-filled metadata, and it is the ONLY reason undo can be derived without
  storing row snapshots. Removing it silently removes undo.
- **Candidate artwork straight from `search` results.** A media URL carries the
  credentials, full stop. Art reaches the browser only through the quarantine
  mirror, and only for a proposed match — not for twelve search hits of which
  eleven are discarded.
- **An ETA or a per-request budget from `requeststoday`.** §2b measured it
  non-1:1 and disagreeing with their own panel by three orders of magnitude.
  It is shown as a ceiling, labelled as approximate, and never counted down.

---

## 14. Looking a game up by what you actually know (16.09.2026)

Name search is the WEAKEST identity a game has, and it was the only one the
workbench offered. On this library it is a guess competing with every romhack
that shares the title — which is how 604 games ended up matched against hack
collections in the first place.

**Researched against two sources before building anything**: ScreenScraper's
own API page (`api.screenscraper.fr/webapi2.php`) and Skyscraper's
`screenscraper.cpp`, the reference client.

| Parameter | Endpoint | What it is |
|---|---|---|
| `crc` / `md5` / `sha1` | `jeuInfos.php` | An **exact** identity. Skyscraper sends all three together with the filename, because a hash cannot be wrong and a filename is a guess. |
| `romnom` + `romtaille` | `jeuInfos.php` | The filename, sharpened by the file size. `romtaille` is what Skyscraper adds whenever it has it. |
| `serialnum` | `jeuInfos.php` | The disc serial (`SLUS-00001`), for CD/DVD systems. |
| `gameid` | `jeuInfos.php` | Their own game id, straight off a screenscraper.fr page. |
| `systemeid` | both | Scopes the lookup. |
| `romtype` | `jeuInfos.php` | `rom` for everything here. |
| `recherche` | `jeuRecherche.php` | The name. **This endpoint really does take only `recherche` + `systemeid`** — the richness is all on `jeuInfos`. |

So the panel is a query builder with five modes, and only `name` goes through
`jeuRecherche`; the rest go through `jeuInfos` and answer with ONE definite
game rather than a list. A hash is shape-checked client-side and again in the
function before it is sent — a mistyped hash otherwise spends a request to be
told nothing, and their 404s are plain text, not JSON.

**`gameid` also removes the extra search call `apply_match` used to make.**
§12 flagged it as documented-but-unverified and re-ran the whole search to find
the chosen entry again. It is now fetched by id, **with the search re-run kept
as the fallback** — documented is not the same as verified against the live
API, and this repo does not confuse the two. It is also the only way to apply a
candidate from a hash, serial or id lookup, which have no search behind them.

### Side by side, not a list of field names

The review card printed field NAMES, then a later version printed the incoming
values on their own. Neither answers the question a person actually asks —
*"is this the same game as mine?"* — which two columns and a mark per row
answer at a glance: **yours on the left, theirs on the right, ✓ where they
agree and ✕ where they do not**, with the gaps they can fill tickable.

`comparableAgreement` scores only the fields BOTH sides filled. Scoring the
others would give a bare row a perfect zero-of-zero against every candidate,
right and wrong alike. `valuesAgree` is deliberately loose — case-insensitive,
order-insensitive for lists — because marking `Action, Platform` against
`platform, action` as a difference trains the eye to ignore the marks.

---

## 15. What their answer actually contains, and what we now keep (16.09.2026)

Three defects found in live use, all mine.

**`systemeid` is MANDATORY for a filename lookup.** Their own error says it:
`Champ systemeid obligatoire si aucun CRC`. §14's change assumed it was
optional and turned a clean refusal into their 400. The correct behaviour:
filename + system when the system is known, and the game's **title through
jeuRecherche** (which genuinely needs no id) when it is not — marked `via:
'name'` so the review knows a name match is a weaker claim than a filename
match. A hash needs no system either, which is why it is the best mode.

**The dry run sent only the GAPS.** `proposed` was built from
`fillOnlyMissing`, so any field the user already had was absent from the
payload and the comparison rendered it as "—" on ScreenScraper's side. A
complete response looked like a nearly empty one, and the side-by-side view was
useless exactly where it mattered. `proposed` is now the WHOLE mapped
candidate; `would_fill` remains what is writable.

**Twenty-three of twenty-six media types were being thrown away**, along with
most of the metadata block. Migration `099` adds two jsonb columns:

| Column | What goes in |
|---|---|
| `games.media` | media type → **Supabase Storage URL**, for every non-video type mirrored. Never a ScreenScraper URL — theirs carry `devid`/`devpassword`. |
| `games.provider_data` | everything else: their /20 score, `rotation`, `cloneof`, `notgame`, every regional title and date, the full `classifications` list, the ROM block's crc/md5/sha1/size/regions/languages and its beta/demo/proto/hack/unl/alt flags, and the **media inventory** — which types exist with their region/format/size, including the ones not mirrored, so "what else is available" is answerable without asking again. |

Two jsonb columns rather than twenty-six real ones because this is a provider's
payload, not facts this app reasons about: nothing filters, sorts or joins on
it, and the UI reads a key when it wants one. Same shape, same reason, as
`health_workouts.raw`.

**Video is the one exclusion, and it is deliberate**: `video` and
`video-normalized` are tens of megabytes per game against a bucket sized for
box art, and nothing in this app plays one. Everything else they send is taken.

Mirroring all of it is one download per image, so `all_media` defaults on but
is a flag — twenty images a game across a thousand games is not something to
spend a shared daily allowance on by accident.
