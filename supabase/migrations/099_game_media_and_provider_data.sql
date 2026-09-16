-- ============================================================
-- 099 — everything ScreenScraper sends, not the six fields that had columns
-- ============================================================
-- `games` has three image columns (cover, screenshot, fanart) and
-- `game_platforms` two more (box, wheel). ScreenScraper answers with TWENTY-SIX
-- media types and a dozen metadata fields beyond what those columns hold — box
-- backs and sides, 3D boxes, cartridge/support art, marquees, title screens,
-- mixed-render composites, Steam grids, manuals, bezels, several wheel styles —
-- and all of it was being discarded because there was nowhere to put it.
--
-- Two jsonb columns rather than twenty-six more real ones: these are a
-- provider's payload, not facts this app reasons about. Nothing filters, sorts
-- or joins on them; the UI reads a key when it wants to show one. That is
-- exactly the shape `health_workouts.raw` already uses for the same reason —
-- a later UI addition needs no migration.

ALTER TABLE public.games
  -- type → PUBLIC STORAGE URL, for every media mirrored. Never a
  -- ScreenScraper URL: theirs carry devid/devpassword in the query string.
  ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The rest of their answer: regions, languages, rotation, the ROM block's
  -- own hashes and flags, their /20 score, clone-of, and the full media
  -- INVENTORY (which types exist, with region/format/size) even for the ones
  -- not mirrored — so "what else is available" is answerable without asking
  -- them again.
  ADD COLUMN IF NOT EXISTS provider_data jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.games.media IS
  'Mirrored artwork: ScreenScraper media type -> Supabase Storage URL. A provider URL is never stored here — theirs carry the developer credentials.';
COMMENT ON COLUMN public.games.provider_data IS
  'The rest of the provider response: regions, languages, rotation, rom hashes and flags, their /20 score, and the media inventory including types that were not mirrored.';
