-- ============================================================
-- 069 — wish_items (period-scoped wishes) + tasks.start_date
-- ============================================================
-- A wish is "go to the hytte this winter" / "things to do in Polatlı": a thing
-- you want to do, carrying a *reminder period* that says when the app should
-- bring it up first — never a deadline, never a rule about when you may see it.
-- The period only changes when the app speaks first; the row is visible from
-- the day it is written, forever (the NEVER-HIDE invariant).
--
-- WHY ITS OWN TABLE, NOT `tasks`:
--   `tasks.section` (001:8-9) has exactly five values and every one of them
--   leaks a wish into a surface that treats it as work due now. Undated rows
--   match the `due_date.is.null` arm of `fetchTasksForDay` (tasksApi.ts:53-55)
--   and `fetchTasksByWeek`'s unbounded `.eq('section','this_week')` arm
--   (tasksApi.ts:85), while `section = 'today'` predicates in phone-gateway,
--   push-send, ai-proxy and the daily briefing would put "hytte this winter"
--   on the lock screen in July. The obvious repair — a `kind` discriminator
--   filtered out of those queries — is forbidden twice over: it removes rows
--   from existing queries (NEVER-HIDE), and ai-proxy's `db_query` composes
--   MODEL-supplied filters over `select('*')`, so no server-side code can
--   enforce it anyway. A separate table needs zero edge-function redeploys.
--
-- WHY NOT `shop_items`:
--   `shop_items.category_id` is `NOT NULL ... ON DELETE CASCADE` (029:16) and
--   Daily's ShopCard filters `status === 'wishlist'` with NO category filter
--   (ShopCard.tsx:14) — a place-wish would advertise itself in the Shopping
--   glance cell. Buy vs do: "buy ski gear this winter" is a shop_item;
--   "go skiing this winter" is a wish_item.
--
-- Concrete dates, not a season enum: a 5-value CHECK cannot express "*this*
-- spring, Italy", its 'anytime' default is a junk drawer, and free dates add
-- "Ramadan"/"the weekend" with no migration and no ai-proxy redeploy (a CHECK's
-- values are duplicated in that function's DB_CATALOG columns string). There is
-- deliberately no generated `is_open` column: CURRENT_DATE is STABLE, not
-- IMMUTABLE, so Postgres rejects it in a generation expression.
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW. No `section` backfill (both
-- candidate backfills are worse than nothing — one relocates rows onto an
-- unbounded date range, the other manufactures deadlines that go red tomorrow)
-- and no CHECK constraint added to `tasks` (047:65-70 writes `tasks.due_date`
-- from inside a `time_blocks` trigger and could raise it during an unrelated
-- edit).

CREATE TABLE IF NOT EXISTS public.wish_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  notes         text,
  kind          text NOT NULL DEFAULT 'thing'
                CHECK (kind IN ('thing', 'place')),
  -- Concrete dates, never MM-DD: a period is resolved to real dates when it is
  -- picked, so there is no wrap-around resolver and no 29-Feb trap.
  period_start  date,
  period_end    date,
  period_label  text,  -- the user's own word for the period, e.g. "Winter"
  -- Meaningful when kind = 'place'. No lat/lon: the CSP blocks map tiles and
  -- the only wired geocoder (EnTur) is Norway-only.
  city          text,
  country       text,
  url           text,
  priority      text NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low', 'medium', 'high')),
  status        text NOT NULL DEFAULT 'idea'
                CHECK (status IN ('idea', 'planned', 'done', 'dropped')),
  -- Set when a wish is promoted into a real scheduled task. The wish row
  -- SURVIVES promotion — it is the memory, the task is the commitment. There is
  -- no trigger syncing the two back: a second completion signal beside
  -- tasks.status is the documented user_tv_entries.current_season mistake.
  -- SET NULL rather than CASCADE because deleteTask hard-deletes the task row.
  promoted_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wish_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wish_items'
      AND policyname = 'Users manage own wish items'
  ) THEN
    CREATE POLICY "Users manage own wish items"
      ON public.wish_items
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- Sorting/grouping is by period. No (user_id, status) index: the client reads
-- the whole set under one query key and splits open/upcoming/passed/done
-- client-side, so a status index would never be probed (AGENTS.md rule 8).
CREATE INDEX IF NOT EXISTS wish_items_user_period
  ON public.wish_items (user_id, period_start);

-- Audit trigger — a user-authored table, so it gets trg_audit in the same
-- migration (AGENTS.md rule 9). 037 attached the trigger to a hardcoded list
-- built before this table existed; 052 exists solely because dev_requests was
-- missed that way and its deleted rows left no recoverable trace.
DROP TRIGGER IF EXISTS trg_audit ON public.wish_items;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.wish_items
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- update_updated_at() is defined in 002_media.sql:177 and reused corpus-wide.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wish_items_updated_at') THEN
    CREATE TRIGGER trg_wish_items_updated_at
      BEFORE UPDATE ON public.wish_items
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- tasks.start_date — due_date's opening sibling
-- ============================================================
-- A hard "between A and B" task: start_date = A, due_date = B. due_date stays
-- the SOLE deadline representation, so overdue, the brief, the push, the phone
-- gateway and workMeta.ts need no new concept. Nullable with no default and no
-- CHECK, so every existing row and every existing writer is untouched.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS start_date date;

CREATE INDEX IF NOT EXISTS tasks_user_start_date
  ON public.tasks (user_id, start_date);
