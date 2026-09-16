> **Quota protection — 2026-09-16:** Original-image uploads are disabled server-side after exceeding the Free plan Storage quota. Non-cover originals were removed; covers and source metadata remain. Use **Metadatayi-Senkronize-Et** for new games/statistics/source snapshots and **Kapaklari-Guncelle** for optimized covers. The old full/all-image widgets will stop with HTTP 409 at the original-image step. [Cleanup and 15-game audit](games/esde-quota-cleanup-2026-09-16.md).

# RP6 Termux widgets: setup, maintenance and extension guide

This is the permanent entry point for the RP6 Android widgets. Start here when
installing, changing or adding a widget. Keep the implementation in GitHub;
the RP6 contains an installed copy, not an automatically updating checkout.

**Last device verification:** 2026-09-16, user's successful RP6 widget output.
**Device:** RP6 · **Termux distribution:** Google Play · **SD ID:** `6A0A-D741`.

**Content-sync update:** the new installer adds complete source metadata and
original images, explicitly excluding **PDF manuals and video**. Migration 100
and `esde-content-sync` are deployed; the new widget revision still needs to be
installed/run on RP6. The successful device output below describes the earlier
cover-only revision, not a completed original-image upload.

## Quick navigation

- [Existing widgets](#existing-widgets)
- [Install or update](#install-or-update)
- [Where files live](#where-files-live)
- [Change an existing widget](#change-an-existing-widget)
- [Add a similar widget](#add-a-similar-widget)
- [What ES-DE sync actually transfers](#what-es-de-sync-actually-transfers)
- [Troubleshooting](#troubleshooting)
- [Completed work and evidence](#completed-work-and-evidence)

## Existing widgets

| Widget filename / displayed name | Command option | Behavior |
|---|---|---|
| `Oyunlari-Senkronize-Et` | none | Full workflow: import games/statistics, preview covers, raw source metadata, original images, guarded deletions. |
| `Gorselleri-Senkronize-Et` | `--media-only` | Original images in every supported category plus cover previews, for existing DB variants. PDF/video excluded; no game creation/deletion. |
| `Metadatayi-Senkronize-Et` | `--metadata-only` | Import games/statistics and preserve complete parsed XML/context; no image upload or game deletion. |
| `Kapaklari-Guncelle` | `--covers-only` | Sync covers for games already in the DB; no game import or deletion. |
| `Kutuphane-Kontrol` | `--dry-run` | Parse local XML, check ROM access and find cover paths; no network, writes or deletions. It does not decode every image or compare against DB contents. |

Exit ES-DE normally before running a widget so its latest play statistics are
saved. Tap the widget once and keep Termux open until `Sync complete` appears.
Press Enter to close the result. An overlapping run using the same state file
is rejected. A wake lock is held when the Termux command is available.

## Install or update

The Play Store Termux distribution used on this device includes widget support;
see the [maintained Play Store fork](https://github.com/termux-play-store).
Do not mix APK/plugin signing sources or reinstall a working Termux just to
follow an older separate-plugin tutorial.

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
   prompt. Setup reuses an existing private secret on subsequent runs and
   installs Python/Pillow if necessary.
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
The device gets only its revocable ES-DE secret, never a Supabase service key.
Secret rotation requires updating both the Edge Function secret and the private
Termux file; rerunning setup preserves the existing file and does not rotate it.

## Change an existing widget

| Change wanted | Source to edit |
|---|---|
| Label, launch options, terminal message, wake lock | [`setup-esde-widgets.sh`](../scripts/setup-esde-widgets.sh), `create_widget` |
| Workflow, media matching, deletion guards, new CLI option | [`sync-esde.py`](../scripts/sync-esde.py) |
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
3. For workflow/server changes, run the relevant checks listed below. Update this
   guide and the detailed [sync runbook](../scripts/esde-push-README.md) together.
4. Open a PR stating behavior, validation, deployment order and remaining limits.
5. Deploy any required migration/Edge Function explicitly, then install the new
   scripts on RP6. GitHub Actions deploys the frontend only.
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
  echo "Islem tamamlanamadi; yukaridaki hatayi kontrol et."
fi
read -r -p 'Kapatmak icin Enter...' _
exit "$result"
```

The installer must copy the actual task script and write the launcher under
`~/.shortcuts/<stable-name>` with mode `700`. Use private configuration for paths
and credentials. For a sync task, implement an overlap lock, bounded retries,
acknowledged checkpoints and an explicit read-only mode. Before deleting remotely,
verify source completeness and match explicit owner-scoped identities. A missing
SD card is an error, never proof that the user deleted their entire library.

## What ES-DE sync actually transfers

**The new content widget captures game metadata and original images, excluding
PDF manuals and video.** The initial cover-only audit remains a historical record.
Original images go to Storage; metadata, file hashes and references go to the DB.

| Data | Current behavior |
|---|---|
| System + exact ROM path | Identity on `game_platforms`; ROM contents are not uploaded. |
| Name, description, developer, publisher, genre, players, release date, rating | Selected metadata imported on game creation; existing curated metadata is preserved. |
| Play count, play time, last played | Updated incrementally; raw missing/zero values remain distinct in checkpoints. |
| Hidden / broken | Existing inclusion/review rules remain. Active games' original fields are also preserved in their XML source record. Hidden/excluded games are not revived. |
| Other XML tags/attributes, repeated/unknown tags, favorite, folder/system metadata | Parsed XML game element plus context saved in `game_platforms.esde_source`; independent hash detects metadata-only edits. This is semantic XML preservation, not a byte-identical archive of the entire original file. |
| Covers | Existing optimized WebP preview plus an original image asset. |
| Fan art, screenshots, title screens, 3D boxes, back covers, logos/marquees, miximages, physical media | Original bytes uploaded, linked under exact relative path in `game_platforms.esde_assets`. Category names are discovered, not limited to this list. |
| PDF manuals and video | Excluded by the latest user instruction, on both client and server. |

Only play-stat changes automatically select an existing game for the old import
endpoint. `--full` resends metadata but does not make that endpoint overwrite
existing metadata. The new source representation captures changes separately
without overwriting curated fields or ScreenScraper's `games.provider_data`.
Extra images are accessible in `game_platforms.esde_assets`; this change does not
add a frontend gallery or overwrite provider-specific `games.media`.

The content uploader accepts PNG, JPEG, WebP, GIF and BMP originals, up to 20 MB
each. The measured card's non-PDF/non-video assets are PNG/JPEG, and its largest
matched image is 6,406,115 bytes. Unsupported formats, empty/corrupt images and
unmatched assets are reported, not declared uploaded. Shared exact stems with
different ROM extensions keep ES-DE's association with both variants.

The first complete upload includes up to **9,163 image associations, 2,553.7 MiB**
in this card snapshot; 1,442 associations are zero bytes and will be reported.
All **7,721 nonempty associations** passed local Pillow validation (original
bytes total 2,677,793,723). These are source-validation counts, not completed-upload counts. Three games sync
concurrently, with bounded retries. Interrupted runs resume using server hashes;
unchanged source documents and images are not written again. Source images are
read/hashed during comparison, so an unchanged run still reads the SD card.

Missing image references are pruned only after a stable, readable rescan;
missing category folders and large-removal guards stop pruning. Old/replaced
object versions remain in the variant's Storage namespace until that variant is
deleted, avoiding unsafe file removal during concurrent linking. Deleting a game
variant also cleans its managed original-image extensions. ROMs/artwork on SD
are never deleted by these widgets.

See the [media and metadata completeness audit](games/esde-completeness-audit.md)
for measured DB coverage, the requested ten-game comparison and the expansion
acceptance criteria. Keep that audit explicit about which source files were
actually available; do not infer media existence from a gamelist alone.

## Troubleshooting

| Output / symptom | Meaning and next action |
|---|---|
| `Content sync complete` | New full-content stage finished. Earlier `Sync complete` / `Push complete` messages refer to the legacy stages, not the whole new widget. Check invalid/missing counts in the final report. |
| `created:0, updated:26` | Existing records updated; no new records created. It does not prove 26 new play sessions; local checkpoints also affect selection. |
| `uploaded:0, unchanged:866` | Existing matching covers were retained without upload. |
| `Unreadable cover` / `corrupt` | Source image cannot be decoded. The known 161 SNES files were measured as zero bytes. Re-download them in ES-DE; rerun afterwards. Games stay imported. |
| `No such file`, unavailable ROM/system folder | Check SD mount, actual path and Termux storage permission. Do not delete state to bypass the source check. |
| `incomplete/invalid XML` | Close ES-DE and verify the complete live file. Restore from a known-good backup if needed; do not substitute stale statistics silently. |
| `HTTP 401` | Verify device secret and custom-auth deployment (`verify_jwt=false` for these two endpoints). Never disable their own secret validation. |
| `HTTP 500` / timeout | Saved import/deletion requests can resume; retry. Persistent failures need server logs. |
| Pending request from a different context | Review saved batch versus current library/configuration; do not discard it blindly or reset the whole DB. |
| Remote system missing locally | Restore/read that system's gamelist and ROM directory. Missing scan coverage cannot authorize deleting all its games. |
| Large deletion guard | Inspect the exact local changes first; widgets never pass `--allow-large-delete`. |

## Completed work and evidence

### 2026-09-15–16: implementation and recovery

- Implemented the standard-library Termux importer, batches of at most 150,
  exact pending-request replay, atomic checkpoint saves and a process lock.
- Supported ES-DE XML with `alternativeEmulator` beside `gameList`.
- Investigated the truncated SNES gamelist and performed a backed-up recovery.
  Recovered filename-only entries did not receive invented metadata.
- Cleaned known AppleDouble XML entries; added actual-ROM existence checks and
  explicit standalone Switch DLC/update filters. NES/SNES remain in scope.
- Fixed large Switch-path lookup requests by limiting server lookup chunks.
- Added migration 094 and deployed the separate `esde-media-sync` endpoint with
  device-secret authentication; existing cover fields and `game-media` bucket used.
- Added three foreground widgets, one-time private-secret setup, Pillow cover
  conversion, incremental uploads and guarded transactional variant deletion.

### Initial Mac upload, 2026-09-16

- 1,028 active variants, including 30 newly imported games.
- 866 cover objects / 52,354,874 bytes, linked to their variants and game covers.
- 161 zero-byte SNES cover files and one entry without a cover file remained.
- An unchanged repeat sent zero games and zero covers; 866 covers were unchanged.
- Temporary Mac credential file removed after completion.
- Initial implementation published as commit `f8ef652783fac122902ba824c3d5fb7070bb302d`
  and subsequently incorporated into `main`.

### RP6 widget confirmed by the user, 2026-09-16

The user supplied a complete on-device run: 1,030 eligible XML entries,
1,028 active games, 26 existing records updated, zero created, 866 unchanged
covers, 161 unreadable covers, zero deleted variants, ending in `Sync complete`.
This confirms the installed widget ran successfully on RP6, not merely on Mac.
Counts are dated observations, not constants to enforce in future runs.

### Validation and deployment

```sh
python3 -B scripts/verify-esde-push.py
python3 -B scripts/verify-esde-media.py  # Pillow required
python3 -B scripts/verify-esde-content.py # Pillow required
node scripts/verify-esde-media-edge.cjs # Node 24
node scripts/verify-esde-content-edge.cjs # Node 24
bash -n scripts/setup-esde-widgets.sh
git diff --check
```

At delivery: 15 importer tests, 8 coordinator tests, Edge authentication/validation
checks, and rollback-only SQL RPC checks passed. The SQL test is
[`verify-esde-media.sql`](../scripts/verify-esde-media.sql); run only against an
authorized database. It inserts synthetic fixtures and rolls them back.

Server prerequisites: migrations 093/094/100, `esde-sync`, `esde-media-sync` and
`esde-content-sync` deployed, matching
`ESDE_SYNC_SECRET`, and server `HEVY_USER_ID`. Current handlers read those from
**Edge Function environment secrets**; older Vault-only notes are not sufficient.
No frontend build is required for a documentation-only edit. Code/feature changes
must run their applicable checks and record any outstanding deployment/device step.

### Original-image/source expansion, 2026-09-16

The user narrowed the earlier audit target to exclude **both PDF manuals and
video**. Added migration 100, source/asset RPC, the binary content endpoint,
incremental original-image/source coordinator, and two additional widget modes.
The installer updates the existing full-sync widget to use the new coordinator.
Server and local source-scan verification are complete; the initial full upload
is intentionally left for the user to run from Termux. Do not report it as done
until an on-device `Content sync complete` report has been checked.
