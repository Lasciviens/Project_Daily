# RP6 Termux widgets: setup, maintenance and extension guide

This is the one guide for syncing the RP6 handheld's ES-DE library into the app:
the Termux widgets, the scripts behind them, the manual import command, state
and recovery, and the dated record of what ran. Start here when installing,
changing or adding a widget. Keep the implementation in GitHub; the RP6 holds an
installed copy, not an automatically updating checkout.

The server-side request contract for the game import is
[`docs/games/screenscraper-integration.md` §10](games/screenscraper-integration.md#10-the-es-de-import-contract--esde-sync-import_esde_games).

**Last device verification:** 16.09.2026, the owner's successful RP6 run of the
cover-only widget revision (see [Completed work](#completed-work-and-evidence)).
**Device:** RP6 · **Termux distribution:** Google Play · **SD ID:** `6A0A-D741`.

> **Storage keeps low-resolution pictures only (owner, 13.10.2026).** The owner
> deleted most of the `game-media` bucket, including the ES-DE originals; the
> originals stay on the SD card. **`Oyunlari-Senkronize-Et` (Sync games) and
> `Gorselleri-Senkronize-Et` (Sync images) still upload originals** — for new or
> changed images, up to the 850 MB cap — until the uploader is changed. Until
> then use `Metadatayi-Senkronize-Et` (games and statistics) and
> `Kapaklari-Guncelle` (cover previews). The widget names move to English later
> (owner, 13.10.2026).

## Quick navigation

- [Existing widgets](#existing-widgets)
- [Install or update](#install-or-update)
- [Where files live](#where-files-live)
- [Change an existing widget](#change-an-existing-widget)
- [Add a similar widget](#add-a-similar-widget)
- [What ES-DE sync actually transfers](#what-es-de-sync-actually-transfers)
- [Which entries are sent](#which-entries-are-sent)
- [Game and deletion behavior](#game-and-deletion-behavior)
- [Local state and recovery](#local-state-and-recovery)
- [Manual import-only command](#manual-import-only-command)
- [Troubleshooting](#troubleshooting)
- [Validation](#validation)
- [Completed work and evidence](#completed-work-and-evidence)

## Existing widgets

The widget names are the launcher file names on the device (on-device text);
the second column says what each one is.

| Widget file name | In English | Command | Behavior |
|---|---|---|---|
| `Oyunlari-Senkronize-Et` | Sync games | `sync-esde-content.py` | Full workflow: import games/statistics, cover previews, raw source metadata, original images, guarded deletions. |
| `Gorselleri-Senkronize-Et` | Sync images | `sync-esde-content.py --media-only` | Original images in every supported category plus cover previews, for existing DB variants. PDF/video excluded; no game creation/deletion. |
| `Metadatayi-Senkronize-Et` | Sync metadata | `sync-esde-content.py --metadata-only` | Import games/statistics and preserve complete parsed XML/context; no image upload or game deletion. |
| `Kapaklari-Guncelle` | Update covers | `sync-esde.py --covers-only` | Sync covers for games already in the DB; no game import or deletion. |
| `Kutuphane-Kontrol` | Check library | `sync-esde-content.py --dry-run` | Parse local XML, check ROM access, list matching images and their total size; no network, writes or deletions. It does not decode every image or compare against DB contents. |

Exit ES-DE normally before running a widget so its latest play statistics are
saved. Tap the widget once and keep Termux open until the last line appears:
`Content sync complete` for the three `sync-esde-content.py` widgets (an earlier
`Sync complete` or `Push complete` line is only a stage), `Sync complete` for
`Kapaklari-Guncelle`. Press Enter to close the result. An overlapping run using
the same state file is rejected. A wake lock is held when the Termux command is
available.

## Install or update

The Play Store Termux distribution used on this device includes widget support;
see the [maintained Play Store fork](https://github.com/termux-play-store).
Do not mix APK/plugin signing sources or reinstall a working Termux just to
follow an older separate-plugin tutorial. Update that app if its widget is not
listed.

1. Put these four files from the **same reviewed revision** into the SD card's
   `Download` directory:
   - [`push-esde-library.py`](../scripts/push-esde-library.py)
   - [`sync-esde.py`](../scripts/sync-esde.py)
   - [`sync-esde-content.py`](../scripts/sync-esde-content.py)
   - [`setup-esde-widgets.sh`](../scripts/setup-esde-widgets.sh)
2. On RP6, run once in Termux:

   ```sh
   bash /storage/6A0A-D741/Download/setup-esde-widgets.sh
   ```

3. On first installation, enter the existing `ESDE_SYNC_SECRET` at the hidden
   prompt. Setup stores it with mode 600 in `~/.config/esde-sync/secret`, never
   on the SD card, reuses it on later runs, installs Python/Pillow if necessary,
   copies the scripts into Termux private storage (and `push-esde-library.py`
   also to `~/push-esde-library.py`, so the manual command uses the same filters
   and state), then runs a local check.
4. Long-press the Android home screen → Widgets → Termux → add the widget and
   choose one of the names above. Refresh/re-add the widget if its list is stale.

**To update:** copy the new four-file set, rerun the same setup command, then
run `Kutuphane-Kontrol`. Copying files to SD or merging a PR alone does **not**
update the installed scripts in Termux. Setup overwrites the five generated
launchers and resets configuration to its packaged defaults; record any custom
paths in the installer before rerunning it. Extra custom launchers are retained.

Changing the SD card requires updating the installer's `card` check **and** its
generated JSON paths. The current installer also checks a readable NES gamelist;
adapt that check when reusing this installer for a different library.

## Where files live

| Purpose | RP6 path |
|---|---|
| Widget launchers | `~/.shortcuts/` |
| Installed Python scripts | `~/.local/share/esde-sync/` |
| Public URL and library paths | `~/.config/esde-sync/config.json` |
| Private device secret | `~/.config/esde-sync/secret` — mode `600` |
| Import checkpoints and lock | `~/.local/state/esde-sync/state.json` and `.lock` |
| Pending deletion batch | `~/.local/state/esde-sync/pending-deletions.json` |
| Optimized cover cache | `~/.local/state/esde-sync/covers/` |
| Full-content results and invalid-image list | `~/.local/state/esde-sync/content-report.json` |
| Live XML | `/storage/6A0A-D741/ES-DE/gamelists/<system>/gamelist.xml` |
| ROMs | `/storage/6A0A-D741/ROMs/<system>/` |
| Downloaded media | `/storage/6A0A-D741/ES-DE/downloaded_media/<system>/` |
| Transfer/install files | `/storage/6A0A-D741/Download/` |

The same SD was mounted on Mac at `/Volumes/SD-RP5_256`. Volume names can change;
check the mount rather than assuming that path still exists. The older Mac
`ES-DE Copy` snapshot is not a substitute for current device media/statistics.

Never commit/copy the secret into a launcher, SD card, PR, screenshot or example.
The device gets only its revocable ES-DE secret — never the iPhone's secret, an
account password or a Supabase service key. Secret rotation requires updating
both the Edge Function secret and the private Termux file; rerunning setup
preserves the existing file and does not rotate it.

## Change an existing widget

| Change wanted | Source to edit |
|---|---|
| Label, launch options, terminal message, wake lock | [`setup-esde-widgets.sh`](../scripts/setup-esde-widgets.sh), `create_widget` |
| Workflow, cover matching, deletion guards, new CLI option | [`sync-esde.py`](../scripts/sync-esde.py) |
| Full XML capture, original image categories, PDF/video exclusions | [`sync-esde-content.py`](../scripts/sync-esde-content.py) |
| XML allowlist, ROM/add-on filters, import batches/checkpoints | [`push-esde-library.py`](../scripts/push-esde-library.py) |
| Server game import/mapping | [`esde-sync/index.ts`](../supabase/functions/esde-sync/index.ts) |
| Server inventory, cover upload, explicit deletion | [`esde-media-sync/index.ts`](../supabase/functions/esde-media-sync/index.ts) |
| Original image bytes and raw metadata endpoint | [`esde-content-sync/index.ts`](../supabase/functions/esde-content-sync/index.ts) |
| Source/manifest storage and atomic writes | [Migration 100](../supabase/migrations/100_esde_source_and_assets.sql) |
| Atomic cover link/deletion database contract | [Migration 094](../supabase/migrations/094_esde_media_and_reconcile.sql); use a **new** migration for future changes |

1. Branch from current `main`; inspect the current source and this guide. Do not
   overwrite newer work using an old local branch or a saved chat excerpt.
2. Change the repository source. Direct edits under `~/.shortcuts` are useful
   for a quick trial but will be overwritten by setup; port them into the installer.
3. Run the checks listed under [Validation](#validation) and update this guide
   in the same change.
4. Open a PR stating behavior, validation and remaining limits.
5. A merge to `main` deploys new migrations and every edge function, then the
   website (`AGENTS.md` → Deploy and backend) — never deploy a function or run a
   migration by hand. Installing the new scripts on the RP6 is still a manual
   step (see [Install or update](#install-or-update)).
6. Run the local-check widget, then one real run and an unchanged repeat. Save a
   dated result summary, including failures/skips, without secrets or raw credentials.

## Add a similar widget

Keep the launcher small: it should call a maintained script and show the outcome.
Put parsing, authentication, retries, locking and synchronization in that script.
For another ES-DE mode, first add and document a CLI option in `sync-esde-content.py`,
then add a `create_widget` call in the installer. Do not pass an unsupported option.

Minimal foreground launcher pattern for another task (example, not installed):

```sh
#!/data/data/com.termux/files/usr/bin/bash
command -v termux-wake-lock >/dev/null && termux-wake-lock
trap 'command -v termux-wake-unlock >/dev/null && termux-wake-unlock' EXIT
python "$HOME/.local/share/my-task/run.py"
result=$?
if [ "$result" -ne 0 ]; then
  echo "Not finished; see the error above."
fi
read -r -p 'Press Enter to close...' _
exit "$result"
```

The installer must copy the actual task script and write the launcher under
`~/.shortcuts/<stable-name>` with mode `700`. Use private configuration for paths
and credentials. For a sync task, implement an overlap lock, bounded retries,
acknowledged checkpoints and an explicit read-only mode. Before deleting remotely,
verify source completeness and match explicit owner-scoped identities. A missing
SD card is an error, never proof that the user deleted their entire library.

## What ES-DE sync actually transfers

The content widgets capture game metadata and original images, excluding PDF
manuals and video. Original images go to Storage; metadata, file hashes and
references go to the DB. ROM contents are never uploaded.

| Data | Current behavior |
|---|---|
| System + exact ROM path | Identity on `game_platforms`; ROM contents are not uploaded. |
| Name, description, developer, publisher, genre, players, release date, rating | Selected metadata imported on game creation; existing curated metadata is preserved. |
| Play count, play time, last played | Updated incrementally; raw missing/zero values remain distinct in checkpoints. |
| Hidden / broken | Hidden entries are not imported; broken ones are flagged for review. Active games' original fields are also preserved in their XML source record. Hidden/excluded games are not revived. |
| Other XML tags/attributes, repeated/unknown tags, favorite, folder/system metadata | Parsed XML game element plus context saved in `game_platforms.esde_source`; an independent hash detects metadata-only edits. This is semantic XML preservation, not a byte-identical archive of the entire original file. |
| Covers | Optimized WebP preview (below) plus an original image asset. |
| Fan art, screenshots, title screens, 3D boxes, back covers, logos/marquees, miximages, physical media | Original bytes uploaded, linked under exact relative path in `game_platforms.esde_assets`. Category names are discovered, not limited to this list. |
| PDF manuals and video | Excluded, on both client and server. |

Only play-stat changes automatically select an existing game for the import
endpoint. `--full` resends metadata but does not make that endpoint overwrite
existing metadata. The source representation captures changes separately
without overwriting curated fields or ScreenScraper's `games.provider_data`.
Extra images are accessible in `game_platforms.esde_assets`; the Games page
uses them as a fallback for covers, fan art and screenshots, and no image
overwrites provider-specific `games.media`.

### Covers

- Exact `(system, relative ROM path)` match into
  `downloaded_media/<system>/covers/<ROM path without last extension>` with a
  `.png`, `.jpg`, `.jpeg` or `.webp` extension. Nested directories are preserved.
  No title guessing.
- Original images on the card are untouched. Previews are WebP, at most 640
  pixels on the longest side, quality 82, stripped of metadata. The cache is in
  private sync state.
- Only new/changed images upload; at most three requests run concurrently.
  Server keys include the variant UUID and the SHA-256 of the optimized bytes, so
  CDN caches cannot show an old cover after an update.
- Uses the public `game-media` bucket; links `game_platforms.cover_url` and
  `games.primary_cover_url`. A manually selected cover is preserved.
- Missing or corrupt source images are reported and skipped; games remain. On
  16.09.2026 the card had **161 SNES covers of 0 bytes** — they need to be
  scraped again in ES-DE; empty files cannot be repaired by uploading. One active
  NAND/system-title entry had no cover file at all.
- Previous versions of a changed cover remain in its variant's hashed namespace
  until that variant is removed, so a request still linking a file never loses
  it. Unchanged runs create no new copies.

### Original images and source metadata

The content uploader accepts PNG, JPEG, WebP, GIF and BMP originals, up to 20 MB
each. The measured card's non-PDF/non-video assets are PNG/JPEG, and its largest
matched image is 6,406,115 bytes. Unsupported formats, empty/corrupt images and
unmatched assets are reported, not declared uploaded. Shared exact stems with
different ROM extensions keep ES-DE's association with both variants.

A complete upload of this card snapshot (16.09.2026) is up to **9,163 image
associations, 2,553.7 MiB**; 1,442 associations are zero bytes and are reported.
All **7,721 nonempty associations** passed local Pillow validation (original
bytes total 2,677,793,723). These are source-validation counts, not
completed-upload counts — and more than the Storage cap allows (see the check at
the top). Three games sync concurrently, with bounded retries. Interrupted runs
resume using server hashes; unchanged source documents and images are not
written again. Source images are read/hashed during comparison, so an unchanged
run still reads the SD card.

Missing image references are pruned only after a stable, readable rescan;
missing category folders and large-removal guards stop pruning. Old/replaced
object versions remain in the variant's Storage namespace until that variant is
deleted, avoiding unsafe file removal during concurrent linking. Deleting a game
variant also cleans its managed original-image extensions. ROMs/artwork on SD
are never deleted by these widgets.

The archived [media and metadata completeness audit](archive/esde-completeness-audit.md)
(16.09.2026) holds the measured ten-game comparison and the whole-card inventory
that led to the content widgets. Do not infer media existence from a gamelist
alone.

## Which entries are sent

The import reads `gamelists/<system>/gamelist.xml` and sends only real games:

- **Never sent:** the launcher pseudo-systems (`androidapps`, `androidgames`,
  `emulators`, `steam`), paths starting with `._` (macOS AppleDouble sidecars),
  `<folder>` elements and anything under `gamelists/CLEANUP/` (ES-DE's dated
  backups — never point a script there to substitute stale statistics). Files
  may contain an `alternativeEmulator` block next to `gameList`; the reader
  supports it.
- **ROM must exist.** Readable ROM storage is required before any request,
  including a pending retry. By default `ES-DE/gamelists` uses the sibling
  `ROMs` directory on the same volume; `--roms /actual/ROMs` sets another.
  XML entries whose ROM path no longer exists are excluded as `missing_roms`;
  directory-based games are kept. Path traversal outside the system directory is
  rejected. Permission/I/O errors stop the run.
- **Standalone Switch add-ons are excluded** as `addons`: explicit DLC/update/
  upgrade package markers or dedicated add-on folders, and a single bracketed
  Switch application ID ending in `800` in an `.nsp`/`.nsz` filename (update
  ProgramIds have 0x800 set — see
  [DBI's title-ID documentation](https://github.com/rashevskyv/dbi/blob/main/README.md)).
  Classification uses the ROM path, never the display title: `DLC Quest`,
  `Upgrade` and `[Base+Update]` bundles are kept. Unlabelled packages cannot be
  classified from XML alone.
- NES and SNES are included.
- `--report /path/exclusions.json` writes an audit of excluded identities and
  reasons (also during `--dry-run`).
- The filter version and ROM root are part of the local sync context: the first
  run after an upgrade performs a full filtered push when no request is pending.

## Game and deletion behavior

- New games get the metadata allowed by the import contract. Existing game
  metadata and notes are preserved; play statistics update. New ROMs must first
  appear in ES-DE's saved gamelist (scrape/save in ES-DE).
- A fresh server inventory also catches games missing from the DB even when a
  local fingerprint checkpoint exists.
- ROMs absent from disk, hidden entries and excluded Switch add-ons are not in
  the active set. After successful import/cover work, only explicit missing
  ES-DE variant IDs are deleted. A game with another platform survives; its
  statistics and removed-cover reference are recomputed. A game whose only
  variants were ES-DE ones is removed when none remain.
- Deletion is one database transaction per batch. Each identity and `updated_at`
  must still match the inventory, otherwise the whole batch fails. Requests are
  saved before sending and can resume after a network failure. Associated
  managed images are removed through the Storage API after the transaction;
  referenced images are retained. No ROM, XML or artwork is deleted from the card.
- Missing/unreadable system folders, malformed XML, empty scans, or changed
  XML/ROM eligibility stop deletion. A remote system missing locally is an error,
  not an instruction to wipe that system. To remove a whole system on purpose,
  keep an empty readable ROM folder and a valid empty gamelist for that system.
- More than `max(25, 25 % of remote variants)` deletions requires an explicit
  `--allow-large-delete` run after inspecting the local library. Widgets never
  pass that override. `--dry-run` is a **local** check and does not compare DB
  state.
- The secret is never sent to redirects, and the Supabase service key stays on
  the server.

## Local state and recovery

- State: `~/.local/state/esde-sync/state.json` in Termux's private home
  (`--state /path/state.json` to override; keep using the same path).
- The fingerprint is SHA-256 over the **raw playcount + playtime + lastplayed**
  values with missing keys omitted. Keys use the complete `(system, path)` pair,
  so same-named ROMs in different subdirectories stay distinct.
- Only acknowledged batches advance fingerprints, including server-skipped
  games. Metadata-only/hidden/broken changes do not trigger incremental sends
  (the content widgets capture metadata edits separately); use `--full` to
  submit those to the import again.
- An in-flight batch's exact JSON body is saved **before** the request. Network
  errors, 408, 429 and 5xx retry unchanged (3 attempts by default, bounded
  backoff; `--attempts 1` disables retries, `--timeout 30` sets the per-request
  timeout). The next run replays any pending body unchanged after validating
  current files and ROM eligibility; play stats that changed meanwhile are then
  sent separately. If a pending request contains a now-excluded game, the script
  stops and keeps that request.
- HTTP 400 logs the server's zero-based entry indexes, advances no fingerprints,
  and drops the rejected pending body because the server guarantees no writes.
  Fix the reported XML/configuration and rerun. Other non-retryable HTTP errors
  stop and keep the pending body.
- A pending request from a different context (changed filter version, ROM root,
  project URL, gamelists location or timezone) needs reconciliation: it is
  neither silently discarded nor replayed without filtering. Lost/corrupt state,
  a changed project URL, gamelists location or timezone start fresh with a full
  push. The secret is never saved in state.
- State replacement is atomic and an OS file lock prevents overlapping runs
  using the same state file. A crash after server success but before the local
  save replays safely through server idempotency; server cover hashes avoid
  uploading unchanged covers again.
- XML parse errors, missing name/path or duplicate identities stop the new scan
  before any newly planned batch is sent. The source files are never modified.
- For a deliberate server-side library reset, first back up and delete only the
  authorized ES-DE rows, then run with `--full`, which sends all eligible rows
  regardless of the fingerprint checkpoint.

## Manual import-only command

`push-esde-library.py` imports games and play statistics only (no covers, no
images, no deletions — device deletions are not propagated by it). It uses
Python's standard library and the same filters and state as the widgets; setup
copies it to `~/push-esde-library.py`. Without the widget setup:

```sh
pkg update && pkg install python
termux-setup-storage        # grant Android's storage permission
export ESDE_GAMELISTS='/storage/6A0A-D741/ES-DE/gamelists'   # the LIVE gamelists folder
export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
```

First a check with no upload (no network, no state writes, no secret needed):

```sh
python ~/push-esde-library.py --gamelists "$ESDE_GAMELISTS" --dry-run
```

Missing local state selects the full library. On the measured export, 1,125
eligible games were **7 × 150 + 75 = 8 requests**; the reported `systems` count
includes only systems with eligible games.

Then the push, reading the secret without putting it in shell history:

```sh
read -r -s -p 'ES-DE sync secret: ' ESDE_SYNC_SECRET
echo
export ESDE_SYNC_SECRET
python ~/push-esde-library.py --gamelists "$ESDE_GAMELISTS"
```

Each batch logs `created`, `updated`, `skipped` and `flagged`; it ends with
`Push complete.` or `Already up to date.` and exits 0 on success, nonzero on
failure. In a new Termux session, set the variables and read the secret again.
Nothing is scheduled. `--full` resends every eligible game.

## Troubleshooting

| Output / symptom | Meaning and next action |
|---|---|
| `Content sync complete` | The full-content stage finished. Earlier `Sync complete` / `Push complete` lines refer to earlier stages, not the whole widget. Check invalid/missing counts in the final report. |
| `created:0, updated:26` | Existing records updated; no new records created. It does not prove 26 new play sessions; local checkpoints also affect selection. |
| `skipped` / `flagged` | `skipped` = hidden entries the server declined. `flagged` = written entries marked broken; they are also counted in created/updated, not extra games. |
| `uploaded:0, unchanged:866` | Existing matching covers were retained without upload. |
| `Unreadable cover` / `corrupt` / `empty` | The source image cannot be decoded. The known 161 SNES files were measured as zero bytes. Re-download them in ES-DE; rerun afterwards. Games stay imported. |
| `HTTP 413; nothing marked complete` | The upload would take the `game-media` bucket past the 850 MB guard (`storage_full`). The run stops there; space has to be freed (or less uploaded) before a rerun can get further. |
| `No such file`, unavailable ROM/system folder | Check SD mount, actual path and Termux storage permission. Do not delete state to bypass the source check. |
| `incomplete/invalid XML` | Close ES-DE and verify the complete live file. Restore from a known-good backup if needed; do not substitute stale statistics silently. (On 15.09.2026 a Mac copy's SNES gamelist ended mid-file at exactly 262,144 bytes.) |
| `HTTP 400` | The server rejected the batch and wrote nothing; the log names the entry indexes. Fix the XML/configuration and rerun. |
| `HTTP 401` | Verify the device secret and the custom-auth setup (`verify_jwt = false` for `esde-sync`, `esde-media-sync` and `esde-content-sync` in `supabase/config.toml`). Never disable their own secret validation. |
| `HTTP 500` / timeout | Saved import/deletion requests can resume; retry. Persistent failures need server logs. |
| Pending request from a different context | Review the saved batch versus the current library/configuration; do not discard it blindly or reset the whole DB. |
| Remote system missing locally | Restore/read that system's gamelist and ROM directory. Missing scan coverage cannot authorize deleting all its games. |
| Large deletion guard | Inspect the exact local changes first; widgets never pass `--allow-large-delete`. |

## Validation

```sh
python3 -B scripts/verify-esde-push.py
python3 -B scripts/verify-esde-media.py   # Pillow required
python3 -B scripts/verify-esde-content.py # Pillow required
node scripts/verify-esde-media-edge.cjs   # Node 24
node scripts/verify-esde-content-edge.cjs # Node 24
node scripts/verify-esde-import-rules.cjs
bash -n scripts/setup-esde-widgets.sh
git diff --check
```

- `verify-esde-push.py` (15 tests) uses temporary XML/state fixtures and mocked
  HTTP responses: the contract, all exclusions, sparse/zero values, 1,125-row
  batching, incremental changes, partial success, identical retry across
  restarts, 400, invalid responses, state loss/corruption, malformed XML,
  dry-run and concurrent-run locking.
- `verify-esde-import-rules.cjs` (59 assertions) covers the server's pure import
  rules (timestamps, rating rescale, roll-up).
- [`verify-esde-media.sql`](../scripts/verify-esde-media.sql) and
  [`verify-esde-content.sql`](../scripts/verify-esde-content.sql) exercise the
  real RPCs with synthetic fixtures inside a rollback-only transaction (cover
  linking, manual-cover preservation, user scoping, stale-inventory rollback,
  other-platform preservation, retry behavior; source/asset writes). Run them
  only against an authorized database.

Server side, in place: migrations 093/094/100 and the three functions
`esde-sync`, `esde-media-sync`, `esde-content-sync`, all with JWT verification
off because each authenticates `x-esde-secret` itself. They read
`ESDE_SYNC_SECRET` and `HEVY_USER_ID` from the **Edge Function secrets**
([`docs/backend/environment.md`](backend/environment.md)).

## Completed work and evidence

Counts below are dated observations, not constants to enforce in future runs.

### 15.09.2026–16.09.2026: implementation and recovery

- Implemented the standard-library Termux importer, batches of at most 150,
  exact pending-request replay, atomic checkpoint saves and a process lock.
- Supported ES-DE XML with `alternativeEmulator` beside `gameList`.
- Investigated the truncated SNES gamelist and performed a backed-up recovery.
  Recovered filename-only entries did not receive invented metadata.
- Cleaned known AppleDouble XML entries; added actual-ROM existence checks and
  explicit standalone Switch DLC/update filters. NES/SNES remain in scope.
- Fixed large Switch-path lookup requests by limiting server lookup chunks.
- Added migration 094 and the separate `esde-media-sync` endpoint with
  device-secret authentication; existing cover fields and the `game-media`
  bucket are used.
- Added three foreground widgets, one-time private-secret setup, Pillow cover
  conversion, incremental uploads and guarded transactional variant deletion.

### Initial Mac upload, 16.09.2026

- 1,028 active variants, including 30 newly imported games.
- 866 cover objects / 52,354,874 bytes, linked to their variants and game covers.
- 161 zero-byte SNES cover files and one entry without a cover file remained.
- An unchanged repeat sent zero games and zero covers; 866 covers were unchanged.
- Temporary Mac credential file removed after completion.
- Initial implementation published as commit `f8ef652783fac122902ba824c3d5fb7070bb302d`
  and subsequently incorporated into `main`.

### RP6 widget confirmed by the owner, 16.09.2026

The owner supplied a complete on-device run of the cover-only revision: 1,030
eligible XML entries, 1,028 active games, 26 existing records updated, zero
created, 866 unchanged covers, 161 unreadable covers, zero deleted variants,
ending in `Sync complete`. This confirms the installed widget ran on RP6, not
merely on Mac.

### Original-image/source expansion, 16.09.2026

The owner narrowed the earlier audit target to exclude **both PDF manuals and
video**. Added migration 100, the source/asset RPC, the binary content endpoint,
the incremental original-image/source coordinator and two widget modes; the
installer points the full-sync widget at the new coordinator. Server and local
source-scan verification were complete at delivery; the first full upload was
left for the owner to run from Termux. The owner later confirmed the uploads
done and, on 13.10.2026, deleted the originals again (the note at the top).

### Storage guard, 26.09.2026 and 04.10.2026

`esde-content-sync` and `esde-media-sync` refuse an upload that would take the
`game-media` bucket past the cap with 413 `storage_full` (950 MB from
26.09.2026, 850 MB from 04.10.2026 to leave room for the Kobo buckets). On
25.09.2026 the bucket held 537 MB of ES-DE originals and 52 MB of ES-DE cover
previews. On 13.10.2026 the owner deleted the originals and kept only
low-resolution pictures (see the note at the top); the earlier discussion is in
[`screenscraper-integration.md` §16.3](games/screenscraper-integration.md#163-storage--the-constraint-and-the-choice).
