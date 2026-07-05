-- CRUD audit log — DB-level triggers so every write is captured no matter the
-- source (web UI, Ask AI's generic DB layer, edge functions, webhooks).
-- Surfaced in the Developer page's Activity tab.
--
-- Deliberately NOT audited: bulk-synced tables (hevy_*, health_*,
-- strava_activities, movies/tv_series catalog) — each sync would spam
-- hundreds of upsert rows and drown the log. Add per-table later if needed.

-- ============================================================
-- Table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Taken from the audited row's own user_id (fallback auth.uid()) — nullable
  -- so a service-role write to a row we somehow can't attribute still logs.
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name  text NOT NULL,
  operation   text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id      text,
  -- UPDATE stores only the changed keys on both sides (not full rows);
  -- INSERT stores the full new row, DELETE the full old row.
  old_data    jsonb,
  new_data    jsonb,
  -- 'web' = authenticated browser session; 'service' = service-role write
  -- (ai-proxy generic DB layer, sync functions, webhooks).
  actor       text NOT NULL,
  -- Rows sharing a tx_id changed in the same transaction — lets the UI show
  -- "this delete also triggered those" (e.g. FK cascade deletes).
  tx_id       bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Read + clear own logs from the client. No INSERT/UPDATE policy on purpose:
-- rows are written only by the SECURITY DEFINER trigger function below.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_logs' AND policyname = 'Users read own audit logs'
  ) THEN
    CREATE POLICY "Users read own audit logs"
      ON public.audit_logs FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_logs' AND policyname = 'Users delete own audit logs'
  ) THEN
    CREATE POLICY "Users delete own audit logs"
      ON public.audit_logs FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, DELETE ON public.audit_logs TO authenticated;

CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx
  ON public.audit_logs (user_id, created_at DESC);
-- For the global retention sweep in the trigger function.
CREATE INDEX IF NOT EXISTS audit_logs_created_idx
  ON public.audit_logs (created_at);

-- ============================================================
-- Trigger function
-- ============================================================
-- SECURITY DEFINER: fires inside end-user transactions, but the insert into
-- audit_logs must bypass that user's RLS (there is no insert policy).
CREATE OR REPLACE FUNCTION public.log_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_j    jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  new_j    jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  row_j    jsonb := COALESCE(new_j, old_j);
  diff_old jsonb;
  diff_new jsonb;
  v_user   uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only the keys that actually changed, ignoring bookkeeping columns.
    SELECT COALESCE(jsonb_object_agg(o.key, o.value), '{}'::jsonb)
      INTO diff_old
      FROM jsonb_each(old_j) o
     WHERE o.key NOT IN ('updated_at', 'synced_at')
       AND new_j -> o.key IS DISTINCT FROM o.value;

    SELECT COALESCE(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
      INTO diff_new
      FROM jsonb_each(new_j) n
     WHERE n.key NOT IN ('updated_at', 'synced_at')
       AND old_j -> n.key IS DISTINCT FROM n.value;

    -- Touch-only update (just updated_at/synced_at) — not worth a log row.
    IF diff_new = '{}'::jsonb AND diff_old = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSE
    diff_old := old_j;
    diff_new := new_j;
  END IF;

  v_user := COALESCE((row_j ->> 'user_id')::uuid, auth.uid());

  INSERT INTO public.audit_logs (user_id, table_name, operation, row_id, old_data, new_data, actor, tx_id)
  VALUES (
    v_user,
    TG_TABLE_NAME,
    TG_OP,
    row_j ->> 'id',
    diff_old,
    diff_new,
    CASE WHEN auth.uid() IS NOT NULL THEN 'web' ELSE 'service' END,
    txid_current()
  );

  -- Retention: 30 days. Probabilistic sweep (~2% of writes) instead of a cron
  -- job — at this app's volume that's a cleanup every few dozen writes.
  IF random() < 0.02 THEN
    DELETE FROM public.audit_logs WHERE created_at < now() - interval '30 days';
  END IF;

  RETURN NULL;  -- AFTER trigger; return value is ignored
END;
$$;

-- ============================================================
-- Attach to user-authored tables (idempotent)
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tasks', 'time_blocks',
    'recipes', 'recipe_ingredients', 'recipe_ingredient_library', 'recipe_meal_plans',
    'shop_categories', 'shop_items',
    'projects', 'project_phases', 'project_items',
    'user_movie_entries', 'user_tv_entries', 'user_tv_episodes',
    'user_transit_stops', 'user_transit_routes',
    'work_notes', 'work_weekly_goals', 'work_pinned_links'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_audit()',
      t
    );
  END LOOP;
END $$;
