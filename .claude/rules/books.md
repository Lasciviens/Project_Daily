---
paths:
  - "src/features/books/**"
  - "scripts/kobo/**"
  - "supabase/functions/kobo-sync/**"
  - "supabase/functions/book-meta/**"
---
# Books and Kobo rules

Background: `docs/features/books.md`, device facts: `docs/kobo/REFERENCE.md`, setup: `docs/kobo/SETUP.md`.

- The plugin never turns Wi-Fi on and does no network work on suspend.
- Firmware: never accept a Kobo 5.x/6.x opt-in update; never update KOReader without a matching Project: Title release.
- The plugin never writes the open book and never writes `.kobo/KoboReader.sqlite` (Nickel, Kobo's own reader; reading it is fine); statuses go into KOReader sidecars and are confirmed through `/applied`.
- On the device: back up before any write, copy over SSH (`scp`), never USB; never install firmware; never print or commit `KOBO_SYNC_SECRET` or `KOBO_OPDS_TOKEN`.
- The plugin checks the server certificate against KOReader's CA bundle and the host name (`scripts/kobo/test-tls.sh`).
- The Kobo writes only settings in its generated allow-list (`lbsettings.lua`, from `scripts/kobo/gen-settings-catalogue.mjs`); risky keys are refused on the device too.
- News issues (`books.kind = 'news'`) never carry a status, rating or queue place (trigger, 128).
- `readingSync.ts` and `opdsFeed.ts` are GENERATED into `kobo-sync` (`scripts/sync-kobo-shared.mjs --check`).
- Storage object names are ASCII (`book.<ext>`); the real name stays in `filename`.
- A streak day after the Kobo's last complete sync is unknown, never zero.
