# ES-DE quota cleanup and metadata audit — 2026-09-16

## Storage cleanup

Deleted 6,847 non-cover objects through the Storage API. Preserved all cover-category assets and objects referenced as game/variant covers. Removed non-cover asset manifest entries from 865 variants. SD card files were not changed.

Storage before: 8,614 objects / 2,740,042,210 bytes. After: 1,767 objects / 595,384,917 bytes.

Original-image uploads are temporarily blocked in esde-content-sync v2 (HTTP 409) to prevent the old widget from restoring the deleted files. Source metadata and optimized-cover endpoints remain available. The one-time cleanup endpoint was disabled after completion.

## 15-game comparison

Five platforms, three deterministic first/middle/last database variants each, compared against the currently mounted SD card. Complete parsed XML and system/folder context plus stored SHA-256 match for all 15. These are source-preservation checks, not proof that the source itself contains every possible metadata field.

| Platform | Game | Source fields | Exact source/hash match |
|---|---|---:|---|
| gba | Advance Wars 2 : Black Hole Rising | 12 | Yes |
| gba | Metroid Fusion | 9 | Yes |
| gba | Super Mario Advance 4: Super Mario Bros. 3 | 9 | Yes |
| gc | Beyond Good & Evil | 9 | Yes |
| gc | Prince of Persia : The Two Thrones | 9 | Yes |
| gc | Tom Clancy's Rainbow Six 3 | 9 | Yes |
| nes | 8 Eye's | 12 | Yes |
| nes | The Krion Conquest | 9 | Yes |
| nes | Zombie Nation | 9 | Yes |
| ps2 | Burnout 3 : Takedown | 13 | Yes |
| ps2 | Metal Gear Solid 3 : Subsistence | 9 | Yes |
| ps2 | Street Fighter Anniversary Collection | 9 | Yes |
| snes | ActRaiser | 12 | Yes |
| snes | Monopoly | 9 | Yes |
| snes | Zoop (USA) | 2 | Yes |

Zoop has only path and name in the SD XML; the import preserved both, but description, developer, publisher and other descriptive metadata are absent at the source. App title/description/developer/publisher match the source in all 15 cases. Raw rating, date, genre, players, favorite and statistics are retained in the source snapshot when present.

All 1,023 ES-DE variants have source snapshots in the database. The five device entries previously reported as not imported are not covered by this claim.
