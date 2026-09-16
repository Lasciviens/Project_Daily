# ES-DE completeness audit — 2026-09-16

> Historical pre-expansion findings. After reviewing this report, the user
> requested the new widgets to exclude **PDF manuals as well as video**.
> The [current widget guide](../termux-widgets.md) describes migration 100 and
> the new source/original-image uploader. An initial full Termux upload is still
> required; the historical counts below are not claims about its completion.

**Result: the current device sync does not transfer all non-video data.**
Ten games were matched by exact `(esde_system, esde_path)` between the mounted
RP6 SD card and live Supabase. Their source has **87 nonempty non-video assets**;
the DB has **9 cover links**, with **78 other assets unrepresented**. One additional
sample has ten zero-byte media files; uploading cannot recover their contents.

This is the evidence for the user's requirement to preserve all game-related
metadata and media except video. It does not claim that this expansion has been
implemented. The working widget currently synchronizes selected metadata,
statistics, covers and deletions; see the [widget guide](../termux-widgets.md).

## Sources and method

- Live card: `/Volumes/SD-RP5_256/ES-DE`, reconnected for this audit. The older
  Mac `ES-DE Copy` snapshot was not used as media evidence.
- Source: complete per-system XML plus recursively enumerated `downloaded_media`.
  Match media using system + nested relative ROM path with its final extension
  removed. Preserve exact Unicode/path text; do not match by title.
- DB: read-only queries of exact matching variants and their parent games,
  including `cover_url`, `box_url`, `wheel_url`, `primary_cover_url`,
  `screenshot_url`, `fanart_url`, **`media` and `provider_data`**. The newer JSON
  columns were checked so an empty legacy column is not mistaken for missing data.
- Sample: ten different systems, chosen deterministically for media variety,
  favorites, nested paths and one known damaged SNES case. This is deliberately
  a coverage sample, **not a random estimate** of whole-library percentages.
- All ten variants were found. For all ten, `media={}` and `provider_data={}`;
  none of the missing categories was stored there instead.
- The 80 nonempty sample images passed Pillow `verify()`. Seven manuals have
  PDF signatures; their full page rendering was not tested. File sizes of zero
  were counted separately. No source files or DB records were modified.

Reproduce the source inventory with
[`audit-esde-source.py`](../../scripts/audit-esde-source.py):

```sh
python3 scripts/audit-esde-source.py \
  --esde /Volumes/SD-RP5_256/ES-DE \
  --output /tmp/esde-source-audit.json
```

That command only reads the card and writes the requested JSON; it performs no
network or DB access. Re-query the DB with explicit authorization for a new audit.
The compact [comparison evidence](esde-audit-2026-09-16.json) records exact sample
identities, categories, compared fields and statistics without credentials or
user IDs. Counts below are a dated snapshot, not future sync invariants.

## Ten-game comparison

“DB assets” means linked, optimized covers; it does not mean original image
bytes were archived. Missing count excludes empty files and videos.

| System | Game | Nonempty source assets | DB assets | Missing assets | XML metadata / statistics |
|---|---|---:|---:|---:|---|
| Dreamcast | Sonic Adventure | 10 | 1 cover | 9 | Present mapped fields and stats match. |
| GBA | Pokémon Unbound | 8 | 1 cover | 7 | Mapped fields/stats match; `favorite=true` is not preserved. |
| GameCube | Beyond Good & Evil | 10 | 1 cover | 9 | Present mapped fields and stats match. |
| Genesis | Sonic The Hedgehog (USA, Europe) | 10 | 1 cover | 9 | Source has only the name among mapped descriptive fields; name/stats match. `favorite=true` is not preserved. |
| N64 | The Legend of Zelda: Ocarina of Time | 10 | 1 cover | 9 | Mapped fields/stats match; `favorite=true` is not preserved. |
| NES | 8 Eye's | 10 | 1 cover | 9 | Present mapped fields and stats match; nested ROM path matched. |
| PS2 | Burnout 3: Takedown | 10 | 1 cover | 9 | Mapped fields/stats match; `favorite=true` is not preserved. |
| PSP | God of War: Chains of Olympus | 10 | 1 cover | 9 | Mapped fields/stats match; `favorite=true` is not preserved. |
| SNES | NHL Hockey '94 | 0, plus 10 empty files | 0 | 0 recoverable files | Present mapped fields/stats match; all ten media files need recovery/re-download. |
| Switch | Mario Kart 8 Deluxe | 9 | 1 cover | 8 | Present mapped fields and stats match; nested NSP directory matched. |
| **Total** | **10 games** | **87 + 10 empty** | **9** | **78** | **5 favorite flags absent from DB source representation.** |

Mapped comparisons checked source-present name, description, developer,
publisher, players, genres, release date and rating. Rating was compared after
the intended 0–1 → 0–100 conversion; genres after comma splitting. All 30
per-variant play-count/time/last-played comparisons matched, including absent
values. Last-played comparisons converted ES-DE's Europe/Oslo local time to UTC.
Matching the existing allowlist is **not** evidence of lossless XML preservation.

### Which media is missing in these ten games?

| Card category | Nonempty sample files | Represented in DB | Missing |
|---|---:|---:|---:|
| `covers` | 9 | 9 optimized cover links | 0 derivatives; originals not archived |
| `3dboxes` | 9 | 0 | 9 |
| `backcovers` | 8 | 0 | 8 |
| `fanart` | 9 | 0 | 9 |
| `manuals` | 7 PDFs | 0 | 7 |
| `marquees` | 9 | 0 | 9 |
| `miximages` | 9 | 0 | 9 |
| `physicalmedia` | 9 | 0 | 9 |
| `screenshots` | 9 | 0 | 9 |
| `titlescreens` | 9 | 0 | 9 |

Pokémon Unbound has no matching manual or back cover in the source; Mario Kart
has no matching manual. Those are source absences, not failed uploads.
The NHL sample has zero-byte files in all ten categories, not only its cover.

## Whole-card inventory (includes inactive/leftover files)

These counts describe **all files in the media directories**, excluding AppleDouble
sidecars. They include assets for hidden, deleted or excluded games and must not
be used directly as an upload list. Link/reconcile against active game identities.

| Category | Files | Empty | Bytes |
|---|---:|---:|---:|
| `covers` | 1,165 | 161 | 616,688,321 |
| `3dboxes` | 1,165 | 161 | 302,454,546 |
| `backcovers` | 1,017 | 156 | 559,628,882 |
| `fanart` | 1,138 | 159 | 371,913,306 |
| `physicalmedia` | 1,158 | 160 | 343,218,312 |
| `marquees` | 1,165 | 161 | 107,307,007 |
| `screenshots` | 1,165 | 161 | 115,818,626 |
| `titlescreens` | 1,165 | 161 | 71,579,983 |
| `manuals` | 959 | 161 | 2,542,853,775 |
| `miximages` | 1,186 | 162 | 765,132,212 |
| **All non-video** | **11,283** | **1,603** | **5,796,594,970** |
| `videos` — excluded | 1,165 | 162 | 7,775,166,771 |

Non-video originals occupy about **5.80 GB / 5.40 GiB**, including leftovers;
manuals alone account for about 2.54 GB. The previous ~50 MiB figure described
optimized covers only. This audit does not imply that all 5.80 GB belongs to
currently active games or will need uploading.

## Metadata gaps beyond media

The current XML reader only sends its explicit allowlist. The card also contains
`favorite` (11 entries), `nogamecount` (2), `nomultiscrape` (2), and `hidemetadata`
(2); these are not sent. `hidden` (4) and `broken` (2) affect filtering/review but
are not retained as a complete source record. Counts here include all parsed game
entries, not only active games. No game-element attributes appeared in this
snapshot, but an implementation promising complete capture must not discard
attributes if future source files contain them.

Nine system files include an `alternativeEmulator` block. The parser tolerates
it but does not preserve it as system metadata. Folder entries are also not a
lossless part of the current import. Existing mapped metadata is written only
on creation; later source-only metadata edits do not trigger the stats-only
fingerprint and are not applied by the import endpoint even with `--full`.

At audit time the DB had 1,023 ES-DE variants, of which 865 had cover links;
`box_url` and `wheel_url` counts were zero. Among 984 parent games still labeled
`external_source='esde'`, 826 had primary covers and none had screenshot/fanart
or populated `media`/`provider_data`. Other source labels exist after library
curation: parent counts must not be equated with variant counts. One ScreenScraper
parent had provider data; that separate pipeline does not establish ES-DE source
coverage, and none of the ten samples used it.

## Required coverage contract — expansion not yet implemented

The requested target is **all game-related source data and media except video**.

1. Preserve the complete game XML representation (including raw text, missing
   versus explicit values, attributes and unknown future tags), with per-system
   emulator context and relevant folder metadata. Keep this source representation
   separate from user-edited titles, ratings and notes. Do not overwrite another
   provider's data; current `games.media`/`provider_data` already exist and must be
   reviewed before choosing a namespaced representation.
2. Inventory **all** non-video game assets, including PDF manuals, multiple files
   in a category and future category names. Use explicit MIME/extension checks
   in addition to the `videos` folder. Keep original source identity, size and
   content hash; a preview derivative is not the original asset.
3. Store media bytes in Supabase Storage and owner/variant/source/category/path/
   hash links in the DB. Do not put binary images/PDFs directly in table rows.
   Preserve originals when promising lossless capture; optimized previews may
   coexist for display. Plan resumable large-file uploads for manuals.
4. Match exact paths, including nested directories and Unicode. Detect missing,
   empty, invalid, ambiguous and unclassified files separately; never label them
   all “synced.” Keep videos, ROM binaries, AppleDouble junk and application
   credentials outside this game-data contract.
5. Track metadata-only edits and all asset additions/changes/removals. Preserve
   merged/multi-platform games and independent ScreenScraper data. Reuse the
   existing mount/readability, locking, incomplete-scan and deletion guards.
6. Prove completeness with a per-game manifest reconciliation: expected valid
   non-video files versus DB/Storage objects, verified hashes, explicit missing
   reasons, and full source metadata comparison. Repeat these ten examples and
   then reconcile the complete active library; an unchanged rerun should write
   nothing. Regenerate the device installer and test on RP6 before declaring done.

Application themes, controller profiles, logs, global settings/credentials and
ROM contents are not game metadata and are not authorized for blind uploading
by this coverage requirement. The media/metadata expansion must not revive the
previously excluded standalone DLC/update files as playable games.
