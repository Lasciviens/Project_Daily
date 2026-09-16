# RP6 ES-DE library push (C7)

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

1. Server prerequisites (Claude/user's side): apply migration **093**, deploy
   **esde-sync** with JWT verification disabled, set **ESDE_SYNC_SECRET** in
   Supabase Vault, and ensure the server's **HEVY_USER_ID** is configured.
   The device secret must match the Vault value. Do not use the iPhone secret,
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
