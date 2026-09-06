-- ============================================================
-- 085 — body_composition_reports (smart-scale OCR import)
-- ============================================================
-- One row per smart-scale "Body composition analysis report" the user shares
-- from their phone: an Apple Shortcut OCRs the report image on-device (no
-- LLM involved) and POSTs the extracted numbers to phone-gateway's new
-- import_body_composition action, which writes here as the single user
-- (service role, same pattern as every other phone-gateway action).
--
-- Deliberately narrow: only the 14 measured numbers + measured_at. Name,
-- gender, "Normal" reference ranges, segmental left/right breakdowns and the
-- device's own High/Normal/Low classifications are NOT stored — those are
-- either PII duplicated from auth.users, derivable client-side, or judgments
-- this table has no business making (phone-gateway validates numeric
-- SANITY, never reproduces the device's own classification bands).
--
-- Explicitly OUT of scope for this migration (do not add here):
--   - no FK/join to hevy_body_measurements or health_metrics — those are
--     separately-synced sources (Hevy app, Health Auto Export) and merging
--     this in would desync them from their own sync logic.
--   - no original-image storage requirement.
--
-- Rows are IMMUTABLE once written: phone-gateway never updates a row (see its
-- import_body_composition handler) — a re-send of an identical report is a
-- silent no-op ("already_exists"), a re-send with DIFFERENT numbers for the
-- same (user_id, source, measured_at) is rejected as a conflict rather than
-- overwriting history. There is therefore no updated_at column and no
-- update_updated_at() trigger (AGENTS.md: "add updated_at when rows are
-- mutated" — these never are).
CREATE TABLE IF NOT EXISTS public.body_composition_reports (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The real point-in-time instant the scale took the reading, resolved from
  -- the report's LOCAL wall-clock time (it carries no UTC offset of its own)
  -- + an explicit IANA timezone at import time — phone-gateway does this
  -- conversion (DST-safe, never a hardcoded +02:00) BEFORE insert, so this
  -- column always holds a real, unambiguous instant. Never the upload time.
  measured_at              timestamptz NOT NULL,

  -- The 14 measured numbers, matching the report layout exactly. Plain
  -- `numeric` (no fixed precision) mirrors hevy_body_measurements' own
  -- weight_kg/lean_mass_kg/fat_percent columns (024_hevy.sql) — the source
  -- report prints one decimal place, and phone-gateway range-checks these
  -- before insert, so a fixed-scale numeric buys nothing extra here.
  weight_kg                numeric NOT NULL CHECK (weight_kg > 0),
  body_fat_percent         numeric NOT NULL CHECK (body_fat_percent BETWEEN 0 AND 100),
  body_fat_mass_kg         numeric NOT NULL CHECK (body_fat_mass_kg >= 0),
  lean_body_mass_kg        numeric NOT NULL CHECK (lean_body_mass_kg >= 0),
  body_water_percent       numeric NOT NULL CHECK (body_water_percent BETWEEN 0 AND 100),
  protein_percent          numeric NOT NULL CHECK (protein_percent BETWEEN 0 AND 100),
  muscle_percent           numeric NOT NULL CHECK (muscle_percent BETWEEN 0 AND 100),
  skeletal_muscle_percent  numeric NOT NULL CHECK (skeletal_muscle_percent BETWEEN 0 AND 100),
  skeletal_muscle_index    numeric NOT NULL CHECK (skeletal_muscle_index >= 0),
  bmi                      numeric NOT NULL CHECK (bmi > 0),
  -- Visceral fat index prints as a small whole number on the report (e.g.
  -- 7, 8) — kept as a generous-bound integer rather than replicating the
  -- device's own 1-9/1-59-style scale, which is a classification, not a
  -- measurement, and out of scope here.
  visceral_fat_index       integer NOT NULL CHECK (visceral_fat_index >= 0),
  subcutaneous_fat_kg      numeric NOT NULL CHECK (subcutaneous_fat_kg >= 0),
  bmr_kcal                 integer NOT NULL CHECK (bmr_kcal > 0),
  -- The report's own 0-100 "Body Score" — stored as reported, never
  -- recomputed or reinterpreted here.
  body_score               integer NOT NULL CHECK (body_score BETWEEN 0 AND 100),

  -- Which report format produced this row. A CHECK list (not an enum) per
  -- AGENTS.md rule 7 — trivially extendable with a future ALTER when a
  -- second report format shows up. 'movinglife_report' is the stable id for
  -- this "life" (MovingLife-branded) smart-scale report layout — see
  -- docs/iphone-examples.md's import_body_composition contract.
  source                   text NOT NULL DEFAULT 'movinglife_report'
                           CHECK (source IN ('movinglife_report')),

  created_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.body_composition_reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'body_composition_reports'
      AND policyname = 'Users manage own body composition reports'
  ) THEN
    CREATE POLICY "Users manage own body composition reports"
      ON public.body_composition_reports
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- DB-level dedupe: the actual enforcement behind phone-gateway's
-- already_exists/conflict logic. Same (user_id, source, measured_at) can
-- never produce two rows — phone-gateway checks for an existing row first
-- (so it can return a clean already_exists/conflict instead of a raw
-- constraint-violation error), but this index is what makes that guarantee
-- real even under a concurrent duplicate submit (the 23505 race the gateway
-- handler explicitly catches and re-resolves).
CREATE UNIQUE INDEX IF NOT EXISTS body_composition_reports_user_source_measured_at_key
  ON public.body_composition_reports (user_id, source, measured_at);

-- Query pattern is always "this user's reports, newest/oldest first" — no
-- separate (user_id) index needed (AGENTS.md rule 8: index the column you
-- actually filter/sort on; the unique index above already covers user_id as
-- its leading column for a plain user-scoped scan too).
CREATE INDEX IF NOT EXISTS body_composition_reports_user_measured_at
  ON public.body_composition_reports (user_id, measured_at);

-- User-authored data (imported by explicit user action, not a bulk external
-- sync), so it gets trg_audit in the same migration (AGENTS.md rule 9) —
-- same reasoning as wish_items (069) and athlete_profile (070).
DROP TRIGGER IF EXISTS trg_audit ON public.body_composition_reports;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.body_composition_reports
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
