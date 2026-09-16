-- ============================================================
-- 094 — ScreenScraper: the system-id lookup and the media bucket
-- ============================================================
-- Two things the enrichment sync needs and neither of which the ES-DE import
-- could supply: a way to turn "genesis" into ScreenScraper's own numeric
-- system id, and somewhere to put the artwork.
--
-- ── Why a table rather than a constant in the function ──────────────────────
-- ScreenScraper identifies a system by a numeric `systemeid`, and the only
-- honest way to learn ours is `systemesListe.php`, whose `nom_retropie` field
-- is the RetroPie folder name — which is exactly what ES-DE uses, so it joins
-- straight onto game_platforms.esde_system (doc §6).
--
-- That response is ~4 MB and lists 250 systems. Parsing it on every batch would
-- dwarf the actual work, and hard-coding the ~19 ids this library needs would
-- be the speculative-external-API-value this repo's rules forbid: I have not
-- verified a single one of those numbers against a live call. So the function
-- fetches the list ONCE into this table via an explicit `refresh_systems`
-- action, and every later batch reads it from here. A value that turns out
-- wrong is then a row to correct, not a redeploy.
--
-- Shared catalog, mirroring `movies` / `steam_apps`: no `user_id` (a system id
-- is not personal), SELECT for `authenticated`, written only by the edge
-- function's service-role client, and deliberately NO `trg_audit` per the
-- bulk-synced exemption — 250 rows refreshed wholesale is sync traffic, not an
-- audit trail.

CREATE TABLE IF NOT EXISTS public.screenscraper_systems (
  id            integer PRIMARY KEY,          -- ScreenScraper's own systemeid
  name          text,
  -- The join key, as an ARRAY. ES-DE uses RetroPie folder naming, but
  -- ScreenScraper's own `nom_retropie` is a COMMA-SEPARATED alias list
  -- ("genesis,megadrive") — one system legitimately answers to several folder
  -- names, and an exact match against the raw string would miss every alias
  -- but the first. Split at ingest so the lookup is a plain membership test.
  retropie_names text[],
  company       text,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.screenscraper_systems ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'screenscraper_systems'
      AND policyname = 'Authenticated can read screenscraper systems'
  ) THEN
    CREATE POLICY "Authenticated can read screenscraper systems"
      ON public.screenscraper_systems
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- The lookup is always "which id is this ES-DE folder", never by name — a
-- containment test over the alias array, so GIN rather than btree.
CREATE INDEX IF NOT EXISTS screenscraper_systems_retropie
  ON public.screenscraper_systems USING GIN (retropie_names);

-- ============================================================
-- game-media — the mirrored artwork bucket
-- ============================================================
-- Every media URL ScreenScraper returns carries `devid` and `devpassword` in
-- its query string (doc §3). A URL the browser must fetch cannot be hidden
-- from it, so storing one in primary_cover_url would publish those credentials
-- to the client and into every backup of that row. The edge function downloads
-- server-side and writes the bytes here instead; the DB then holds only a
-- Storage URL.
--
-- PUBLIC read, deliberately: box art is not a secret, and a private bucket
-- would mean minting a signed URL for every thumbnail in a 1200-cover grid to
-- protect nothing. Writes are service-role only — no policy grants INSERT or
-- UPDATE to `authenticated`, so the browser cannot put anything in this bucket.

INSERT INTO storage.buckets (id, name, public)
VALUES ('game-media', 'game-media', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read of game media'
  ) THEN
    CREATE POLICY "Public read of game media"
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'game-media');
  END IF;
END $$;
