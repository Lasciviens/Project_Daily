# RP6 ES-DE library push (C7)

## One-touch sync with covers (2026-09-16)

Use **`sync-esde.py`** for the complete flow: new games + metadata, changed play
statistics, matched cover images, and removal of deleted ES-DE variants.
The older `push-esde-library.py` command described below remains import-only.

### RP6: one-time widget setup

The SD card's `Download` directory needs these three files together:
`push-esde-library.py`, `sync-esde.py`, `setup-esde-widgets.sh`.
With the card back in the RP6, run once:

```sh
bash /storage/6A0A-D741/Download/setup-esde-widgets.sh
```

Setup installs `python-pillow` if needed, copies the scripts into Termux private
storage, and asks for the **existing** `ESDE_SYNC_SECRET` once (hidden input).
It stores the secret with mode 600 in `~/.config/esde-sync/secret`, never on the
SD card. The public URL and local paths are in the adjacent `config.json`.
To rotate the secret, update that private file as well as the Edge secret.

Long-press the Android home screen → Widgets → Termux → add the widget. Choose:

- **Oyunlari-Senkronize-Et**: games, statistics, covers, deletions.
- **Kapaklari-Guncelle**: covers of already imported games only.
- **Kutuphane-Kontrol**: local check, no network or database writes.

Exit ES-DE normally before tapping. Keep Termux open until the result appears.
The script holds a wake lock when supported and prevents overlapping runs.
The current [Google Play Termux fork includes widget functionality](https://github.com/termux-play-store),
so this setup does not require replacing Termux or mixing differently signed
Termux APKs. Update that app if its widget is not listed.

### Cover behavior

- Exact `(system, relative ROM path)` match into
  `downloaded_media/<system>/covers/<ROM path without last extension>.png/jpg/jpeg/webp`.
  Nested directories are preserved. No title guessing, video, ROM, or XML upload.
- Original images are untouched. Copies are WebP, maximum 640 pixels on the
  longest side, quality 82, stripped of metadata. Cache is in private sync state.
- Only new/changed images upload. Three requests at most run concurrently.
  Server keys include variant UUID and SHA-256 of the optimized bytes, so CDN
  caches cannot show an old cover after an update.
- Uses the existing public `game-media` bucket; links `game_platforms.cover_url`
  and `games.primary_cover_url`. Existing manually selected covers are preserved.
- Missing or corrupt source images are reported and skipped; games remain.
  On the attached card measured on September 16, **161 SNES covers are 0 bytes**.
  These need to be scraped/downloaded again in ES-DE; empty files cannot be repaired
  by uploading. One active NAND/system-title entry has no cover file at all.
- Previous versions of a changed cover remain in its variant's hashed namespace
  until that variant is removed. This avoids deleting a file another request is
  still linking. Unchanged runs create no new copies.

### Game and deletion behavior

- New games include the metadata allowed by the existing import contract.
  Existing game metadata/user notes are preserved; play statistics update.
  New ROMs must first appear in ES-DE's saved gamelist (scrape/save in ES-DE).
- A fresh server inventory also catches games missing from the DB even when
  a local fingerprint checkpoint exists. NES and SNES are included.
- ROMs absent from disk, hidden entries, and excluded standalone Switch add-ons
  are absent from the active set. After successful import/cover work, only
  explicit missing ES-DE variant IDs are deleted. A game with another platform
  survives; its statistics and removed-cover reference are recomputed.
  A solely ES-DE game with no remaining variants is removed.
- Deletion is one database transaction per batch. Each identity and `updated_at`
  must still match the inventory, otherwise the whole batch fails. Requests are
  saved before sending and can resume after a network failure. Associated managed
  images are removed through Storage API after the transaction; referenced images
  are retained. No ROM, XML or artwork is deleted from the card.
- Missing/unreadable system folders, malformed XML, empty scans, or changed
  XML/ROM eligibility stop deletion. A remote system missing locally is an error,
  not an instruction to wipe that system. To remove a whole system intentionally,
  retain an empty readable ROM folder and valid empty gamelist for that system.
- More than `max(25, 25% of remote variants)` deletions requires an explicit
  `--allow-large-delete` run after inspecting the local library. Widgets never
  pass that override. `--dry-run` is a **local** check and does not compare DB state.
- The secret is never sent to redirects and the Supabase service key stays on
  the server. Local state loss may cause a full import; server cover hashes avoid
  uploading unchanged covers again.

### Server deployment and verification

Migration **094** adds service-role-only, security-invoker cover/delete RPCs.
Deploy **esde-media-sync** alongside **esde-sync**, both with JWT verification
off because each authenticates `x-esde-secret` itself. The implementation reads
`ESDE_SYNC_SECRET` and `HEVY_USER_ID` from **Edge Function environment secrets**.
No new table or frontend type is needed; existing cover fields are used.

```sh
python3 -B scripts/verify-esde-push.py
python3 -B scripts/verify-esde-media.py  # requires Pillow
node scripts/verify-esde-media-edge.cjs # Node 24
```

`scripts/verify-esde-media.sql` exercises real RPCs with synthetic fixtures inside
a rollback-only transaction: cover linking, manual-cover preservation, user
scoping, stale-inventory rollback, other-platform preservation and retry behavior.

## Original import-only command

`push-esde-library.py` runs manually in Termux with Python's standard library.
It reads `gamelists/<system>/gamelist.xml` and sends game records directly to
`esde-sync` using the literal [§10 contract](../docs/games/screenscraper-integration.md#10-the-gateway-contract--import_esde_games).
No ROM, artwork, XML file, ScreenScraper credential, or checksum is uploaded.

## Live-file filtering (2026-09-16)

The script now requires readable ROM storage before any request, including a
pending retry. By default `ES-DE/gamelists` uses the sibling `ROMs` directory
on the same volume. Use `--roms /actual/ROMs` for a different layout.

- XML entries whose ROM path no longer exists are excluded as `missing_roms`.
  Existing directory-based games are retained. Path traversal outside the
  system directory is rejected. Permission/I/O errors stop the run.
- Explicit Switch DLC/update/upgrade package markers or dedicated add-on
  folders are excluded as `addons`. A single bracketed Switch application ID
  ending in `800` also identifies an update in `.nsp`/`.nsz` filenames (see
  [DBI's title-ID documentation](https://github.com/rashevskyv/dbi/blob/main/README.md)).
  Classification uses the ROM path, never
  the display title. `DLC Quest`, `Upgrade`, and `[Base+Update]` bundles are
  retained. Unlabelled packages cannot be reliably classified from XML alone.
- NES and SNES remain included. Nothing is deleted from the card or database.
- Add `--report /path/exclusions.json` to write an audit of excluded identities
  and reasons. This explicit report also writes during `--dry-run`; no network
  requests or sync-state writes are made by dry-run.
- Filter version and ROM root are part of local sync context. The first run
  after upgrading performs a full filtered push when there is no pending
  request. A pending request from a different context requires reconciliation;
  it is neither silently discarded nor replayed without filtering.
- Current XML/ROM eligibility is checked before replay. If a pending request
  contains a now-excluded game, the script stops and preserves that request.

For a deliberate server-side library reset, first back up and delete only the
authorized ES-DE rows, then run the new script with `--full`. This sends all
eligible rows regardless of the existing fingerprint checkpoint. Future
device deletions are not automatically propagated to the database.

## One-time setup

1. Server prerequisites: apply migration **093**, deploy
   **esde-sync** with JWT verification disabled, set **ESDE_SYNC_SECRET** in
   Supabase Edge Function secrets, and ensure **HEVY_USER_ID** is configured there.
   The device secret must match that value. Do not use the iPhone secret,
   an account password, or the Supabase service-role key.
2. In Termux:

   ```sh
   pkg update
   pkg install python
   termux-setup-storage
   ```

   Grant Android's storage permission. Official references:
   [Termux commands](https://github.com/termux/termux-tools/blob/master/doc/termux.1.md.in),
   [Python installation](https://github.com/termux/termux-create-package/blob/master/INSTALLATION.md).
3. Copy `push-esde-library.py` to RP6 Downloads, then into Termux's home:

   ```sh
   cp ~/storage/downloads/push-esde-library.py ~/push-esde-library.py
   ```

   Only this single script is needed. No repository clone or pip install.
4. Locate the **live** ES-DE `gamelists` directory in the Android file manager.
   It must contain system directories such as `nes/gamelist.xml`. The example
   below is a placeholder location, not an auto-detected device path:

   ```sh
   export ESDE_GAMELISTS='/storage/emulated/0/ES-DE/gamelists'
   export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
   ```

   Replace both values. If the folder lives on an SD card, use its actual
   `/storage/<volume>/.../gamelists` path and confirm Termux can read it.
   A permission error means access must be fixed first; the script cannot
   bypass Android storage restrictions.

## First check: no upload

Exit ES-DE normally so it finishes saving its play statistics. Run:

```sh
python ~/push-esde-library.py --gamelists "$ESDE_GAMELISTS" --dry-run
```

This reads and compares files without network access or state writes; no secret
is required. Missing local state selects the full library. For **1125 eligible
games**, batching is **7 × 150 + 75 = 8 requests**. Counts on the RP6 may differ
from the measured Mac copy, especially if AppleDouble sidecars are absent.
The reported `systems` count includes only systems with eligible games, not
excluded launcher systems; do not expect the original 24-file count.

**Known local-copy issue (2026-09-15):** the available Mac copy's SNES file is
exactly 262144 bytes and ends inside `<genre>`. It is incomplete, so an actual
full-library parse correctly fails. Check the live RP6 file; if also incomplete,
restore a complete current gamelist through ES-DE before pushing. Never point
the script at `CLEANUP` to substitute stale statistics. Files may also contain
an `alternativeEmulator` block next to `gameList`; the reader supports this.

## Push

Read the device secret without putting it in shell command history (Termux Bash):

```sh
read -r -s -p 'ES-DE sync secret: ' ESDE_SYNC_SECRET
echo
export ESDE_SYNC_SECRET
python ~/push-esde-library.py --gamelists "$ESDE_GAMELISTS"
```

Each batch logs `created`, `updated`, `skipped`, and `flagged`. `flagged` overlaps
with written games; it is not an extra game count. Hidden games are sent with
their flag and the server decides to skip them. The script exits 0 on success
and nonzero on failure. Keep Termux open until it finishes.

For later pushes, exit ES-DE and run the same Python command. In a new Termux
session, set the two paths/URL variables and read/export the secret again.
Nothing is scheduled. To deliberately resend every eligible game, add `--full`.
This remains subject to server update semantics (currently existing metadata
is preserved by the handler); it does not force an overwrite of user edits.

## Local state and recovery

- Default state: `~/.local/state/esde-sync/state.json` in Termux's private home.
  Override with `--state /path/state.json`. Keep using the same path.
- The fingerprint is SHA-256 over the **raw playcount + playtime + lastplayed**
  values with missing keys omitted. Keys use the complete `(system, path)` pair,
  so same-named ROMs in different subdirectories stay distinct.
- Only acknowledged batches advance fingerprints, including server-skipped
  games. Metadata-only/hidden/broken changes do not trigger incremental sends;
  use `--full` to submit those again. No deletion requests are sent.
- An in-flight batch's exact JSON body is saved **before** the request. Network
  errors, 408, 429 and 5xx retry unchanged (3 attempts by default, bounded
  backoff). `--attempts 1` disables automatic retries; `--timeout 30` sets the
  per-request timeout. The next manual run replays any pending body unchanged
    after validating current files and ROM eligibility. If play stats changed during the interruption,
  those new values are then sent separately.
- HTTP 400 logs the server's zero-based entry indexes, advances no fingerprints,
  and drops the rejected pending body because the server guarantees no writes.
  Fix the reported XML/configuration and rerun. Other non-retryable HTTP errors
  stop and retain the pending body; 401 usually means check deployment/auth and
  the matching device secret.
- Lost/corrupt state falls back to a full push. A changed project URL, gamelists
  location or timezone also starts fresh. The secret is never saved in state.
- State replacement is atomic and an OS file lock prevents overlapping runs
  using the same state file. A crash after server success but before local save
  replays safely through server idempotency.
- XML parse errors, missing name/path or duplicate identities stop the new scan
  before any newly planned batch is sent. The source files are never modified.

## Offline verification

```sh
python3 -B scripts/verify-esde-push.py
```

Uses temporary XML/state fixtures and mocked HTTP responses. Covers the contract,
all exclusions, sparse/zero values, 1125-row batching, incremental changes,
partial success, identical retry across restarts, 400, invalid responses, state
loss/corruption, malformed XML, dry-run, and concurrent-run locking.
