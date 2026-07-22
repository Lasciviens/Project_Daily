-- Water intake diary. One row per logged amount (a +250/+500 ml tap, or a
-- future phone/NFC log). The day's total = SUM(amount_ml) for that date.
--
-- Deliberately its OWN table, NOT a food_log_entries slot: water carries no
-- macros and the nutrition calorie ring must never count it (the ring sums
-- food_log_entries only). Owner-only RLS mirrors dev_requests (migration 042);
-- user_id DEFAULT auth.uid() so an insert needs no explicit user_id. No audit
-- trigger — this is high-frequency, low-value-to-audit user data (same reasoning
-- as the bulk-synced-table audit exemption).
CREATE TABLE IF NOT EXISTS public.water_log_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  date       date NOT NULL DEFAULT CURRENT_DATE,
  amount_ml  integer NOT NULL CHECK (amount_ml > 0),
  logged_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.water_log_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_log_entries' AND policyname = 'Users manage own water log'
  ) THEN
    CREATE POLICY "Users manage own water log"
      ON public.water_log_entries
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS water_log_entries_user_date_idx
  ON public.water_log_entries (user_id, date);
