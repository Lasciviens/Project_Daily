-- ============================================================
-- 093 — the ES-DE join key on game_platforms
-- ============================================================
-- The RP6 handheld pushes its EmulationStation-DE library here (see
-- docs/games/screenscraper-integration.md §8-§10). ES-DE identifies a game by
-- exactly two values, both measured against the user's real export:
--   · the system FOLDER name  ("genesis", "snes", "switch") — 24 in use
--   · the <path> inside that system's gamelist.xml ("./Sonic 3.md") — 100%
--     filled across all 1150 games, the only field besides <name> that is
--
-- That pair is the sync's UPSERT target, so it needs to BE a key, not a
-- hopeful lookup. Two columns and one partial unique index is the whole
-- migration; nothing else about the games schema changes.
--
-- Why not reuse existing columns:
--   · `game_platforms.system` is our own DISPLAY value and free text (089
--     deliberately collapsed RP5's systems lookup table into it). Keying a
--     sync on a display string means renaming "genesis" to "Sega Genesis" in
--     the UI silently orphans every row on the next push. `esde_system` is
--     the device's own folder name and is never shown to anyone.
--   · `folder_path` exists but is a different, abandoned concept (RP5's
--     "where is this ROM installed" workflow; every inherited row is NULL).
--     Overloading it would conflate two meanings in one column.
--
-- Why on game_platforms and not games: an ES-DE entry is a (system, file)
-- fact, which is precisely what a platform VARIANT is. 089 already records
-- that a single game legitimately holds more than one variant (the same
-- title on GameCube and PSP).
--
-- The three play-statistic columns come along for the same reason, and they
-- are NOT a duplicate of 089's `games.esde_*` trio. ES-DE reports play stats
-- per (system, file) — per variant — so that is the only level at which the
-- incoming number is a fact. 089's columns on `games` are the ROLL-UP across
-- a game's variants (sum playcount, sum playtime, max last_played), and the
-- importer recomputes them from these after every write.
--
-- Storing only the roll-up was the first design and it does not work: a push
-- carries one variant, the other variants' contributions are nowhere on
-- record, and there is nothing to sum. The choice is per-variant storage or
-- a roll-up rule that cannot be computed — not a simpler schema. For the
-- 1125 single-variant games measured in §9 the two are numerically identical
-- today; the difference only appears once a title is merged across systems,
-- which is exactly when silently discarding a variant's play history would
-- be worst.
--
-- Deliberately NOT added here, per this repo's no-speculative-schema rule:
--   · columns for ES-DE's <hidden>/<broken>/<nogamecount>/<nomultiscrape>/
--     <hidemetadata> flags (2-5 rows each in the real export). They are ES-DE
--     display internals with no surface in this app. The importer READS them
--     off the payload to decide what to skip and what to flag for review; it
--     stores no column for them.
--   · <favorite> (12 rows). `games` has no favourite concept, and `is_iconic`
--     means something else. A column with no reader is debt.
--   · an esde_sync_runs bookkeeping table. Every batch is standalone and
--     idempotent, so there is no run state to carry across requests; "when
--     did this last sync" is already answerable as max(synced_at). If real
--     run history is ever wanted it is its own, later decision.

ALTER TABLE public.game_platforms
  ADD COLUMN IF NOT EXISTS esde_system           text,
  ADD COLUMN IF NOT EXISTS esde_path             text,
  ADD COLUMN IF NOT EXISTS esde_playcount        integer,
  ADD COLUMN IF NOT EXISTS esde_playtime_seconds integer,
  ADD COLUMN IF NOT EXISTS esde_last_played      timestamptz;

COMMENT ON COLUMN public.game_platforms.esde_system IS
  'ES-DE system FOLDER name (genesis, snes, …), not the display value in `system`. Half of the ES-DE sync key.';
COMMENT ON COLUMN public.game_platforms.esde_path IS
  'The <path> verbatim from that system''s gamelist.xml, e.g. ./Sonic 3.md. Half of the ES-DE sync key.';
COMMENT ON COLUMN public.game_platforms.esde_playcount IS
  'Per-variant play stat as ES-DE reports it. games.esde_playcount is the roll-up across a game''s variants.';

-- The real enforcement. Partial, because every row that has never been
-- through an ES-DE sync (a manually added game, an RP5 import) legitimately
-- carries NULL for both and must not collide with anything.
-- Scoped by user_id for the same reason every other index in this schema is:
-- the table is RLS-scoped per user and a sync only ever writes its own rows.
CREATE UNIQUE INDEX IF NOT EXISTS game_platforms_esde_key
  ON public.game_platforms (user_id, esde_system, esde_path)
  WHERE esde_path IS NOT NULL;
