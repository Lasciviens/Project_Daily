-- ═══════════════════════════════════════════════════════════════════════════
-- RLS performance: wrap auth.uid() in a scalar subquery so Postgres evaluates
-- it ONCE per statement (as an InitPlan) instead of re-running the STABLE
-- function for every row. This is Supabase's own documented fix for the
-- `auth_rls_initplan` linter warning; the access semantics are byte-for-byte
-- identical (still "your own rows only"), so there is NO behavior change and
-- NO client-code impact — policy names are unchanged and clients never
-- reference policy internals. Biggest win on the high-row tables
-- (health_metrics, hevy_sets, audit_logs, time_blocks).
--
-- Each policy is DROP IF EXISTS + CREATE with the SAME name/command/clauses,
-- only auth.uid() -> (select auth.uid()). Recreating a policy fails CLOSED
-- (no policy = RLS denies), never open, so this is a safe direction.
--
-- Deliberately NOT touched: the dead/drop-candidate tables (train_programs,
-- train_exercises/exercises, train_session_exercises, train_program_workouts,
-- train_program_exercises, health_daily_stats) — optimizing RLS on tables
-- slated for removal is wasted; they'll clear the linter when dropped.
-- movies/tv_series (policy is `using (true)`) and link_rules (auth.role(), a
-- 4-row config table) have nothing per-row-user to optimize.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Daily / To-Do / Work ───────────────────────────────────────────────────
DROP POLICY IF EXISTS tasks_owner ON public.tasks;
CREATE POLICY tasks_owner ON public.tasks
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "user owns schedule_blocks" ON public.schedule_blocks;
CREATE POLICY "user owns schedule_blocks" ON public.schedule_blocks
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "user owns time_blocks" ON public.time_blocks;
CREATE POLICY "user owns time_blocks" ON public.time_blocks
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own work_notes" ON public.work_notes;
CREATE POLICY "Users manage own work_notes" ON public.work_notes
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own work_pinned_links" ON public.work_pinned_links;
CREATE POLICY "Users manage own work_pinned_links" ON public.work_pinned_links
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own work_weekly_goals" ON public.work_weekly_goals;
CREATE POLICY "Users manage own work_weekly_goals" ON public.work_weekly_goals
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── Media ──────────────────────────────────────────────────────────────────
-- (movies/tv_series left as-is: `using (true)` shared catalog, no user check.)
DROP POLICY IF EXISTS "user_movie_entries_select" ON public.user_movie_entries;
CREATE POLICY "user_movie_entries_select" ON public.user_movie_entries
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "user_movie_entries_insert" ON public.user_movie_entries;
CREATE POLICY "user_movie_entries_insert" ON public.user_movie_entries
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "user_movie_entries_update" ON public.user_movie_entries;
CREATE POLICY "user_movie_entries_update" ON public.user_movie_entries
  FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "user_movie_entries_delete" ON public.user_movie_entries;
CREATE POLICY "user_movie_entries_delete" ON public.user_movie_entries
  FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_tv_entries_select" ON public.user_tv_entries;
CREATE POLICY "user_tv_entries_select" ON public.user_tv_entries
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "user_tv_entries_insert" ON public.user_tv_entries;
CREATE POLICY "user_tv_entries_insert" ON public.user_tv_entries
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "user_tv_entries_update" ON public.user_tv_entries;
CREATE POLICY "user_tv_entries_update" ON public.user_tv_entries
  FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "user_tv_entries_delete" ON public.user_tv_entries;
CREATE POLICY "user_tv_entries_delete" ON public.user_tv_entries
  FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS user_tv_episodes_owner ON public.user_tv_episodes;
CREATE POLICY user_tv_episodes_owner ON public.user_tv_episodes
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── Shop ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "own shop_categories" ON public.shop_categories;
CREATE POLICY "own shop_categories" ON public.shop_categories
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "own shop_items" ON public.shop_items;
CREATE POLICY "own shop_items" ON public.shop_items
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── Recipes ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "own recipes" ON public.recipes;
CREATE POLICY "own recipes" ON public.recipes
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "own recipe_ingredients" ON public.recipe_ingredients;
CREATE POLICY "own recipe_ingredients" ON public.recipe_ingredients
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "own recipe_meal_plans" ON public.recipe_meal_plans;
CREATE POLICY "own recipe_meal_plans" ON public.recipe_meal_plans
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "own recipe_ingredient_library" ON public.recipe_ingredient_library;
CREATE POLICY "own recipe_ingredient_library" ON public.recipe_ingredient_library
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── Projects ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS projects_owner ON public.projects;
CREATE POLICY projects_owner ON public.projects
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS project_phases_owner ON public.project_phases;
CREATE POLICY project_phases_owner ON public.project_phases
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS project_items_owner ON public.project_items;
CREATE POLICY project_items_owner ON public.project_items
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── Transit ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS transit_stops_owner ON public.user_transit_stops;
CREATE POLICY transit_stops_owner ON public.user_transit_stops
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS transit_routes_owner ON public.user_transit_routes;
CREATE POLICY transit_routes_owner ON public.user_transit_routes
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- transit_recent_searches: original had USING only (WITH CHECK defaults to it
-- for a FOR ALL policy) — preserved exactly.
DROP POLICY IF EXISTS "Users manage own transit recent searches" ON public.transit_recent_searches;
CREATE POLICY "Users manage own transit recent searches" ON public.transit_recent_searches
  FOR ALL USING ((select auth.uid()) = user_id);

-- ── Calendar / token tables (edge-function/service-role in practice; policy
--    kept consistent regardless) ───────────────────────────────────────────
DROP POLICY IF EXISTS "user owns their calendar token" ON public.user_calendar_tokens;
CREATE POLICY "user owns their calendar token" ON public.user_calendar_tokens
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS strava_tokens_owner ON public.strava_tokens;
CREATE POLICY strava_tokens_owner ON public.strava_tokens
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── Hevy (all owner-scoped, FOR ALL + WITH CHECK) ──────────────────────────
DROP POLICY IF EXISTS "Users manage own hevy exercise templates" ON public.hevy_exercise_templates;
CREATE POLICY "Users manage own hevy exercise templates" ON public.hevy_exercise_templates
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own hevy template muscles" ON public.hevy_exercise_template_muscles;
CREATE POLICY "Users manage own hevy template muscles" ON public.hevy_exercise_template_muscles
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own hevy events cursor" ON public.hevy_workout_events_cursor;
CREATE POLICY "Users manage own hevy events cursor" ON public.hevy_workout_events_cursor
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own hevy workouts" ON public.hevy_workouts;
CREATE POLICY "Users manage own hevy workouts" ON public.hevy_workouts
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own hevy workout exercises" ON public.hevy_workout_exercises;
CREATE POLICY "Users manage own hevy workout exercises" ON public.hevy_workout_exercises
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own hevy sets" ON public.hevy_sets;
CREATE POLICY "Users manage own hevy sets" ON public.hevy_sets
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own hevy routine folders" ON public.hevy_routine_folders;
CREATE POLICY "Users manage own hevy routine folders" ON public.hevy_routine_folders
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own hevy routines" ON public.hevy_routines;
CREATE POLICY "Users manage own hevy routines" ON public.hevy_routines
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own hevy routine exercises" ON public.hevy_routine_exercises;
CREATE POLICY "Users manage own hevy routine exercises" ON public.hevy_routine_exercises
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own hevy routine sets" ON public.hevy_routine_sets;
CREATE POLICY "Users manage own hevy routine sets" ON public.hevy_routine_sets
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own hevy body measurements" ON public.hevy_body_measurements;
CREATE POLICY "Users manage own hevy body measurements" ON public.hevy_body_measurements
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── Strava activities ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own strava activities" ON public.strava_activities;
CREATE POLICY "Users manage own strava activities" ON public.strava_activities
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── Health (point-grain, high row count — biggest win here) ────────────────
DROP POLICY IF EXISTS "Users manage own health workouts" ON public.health_workouts;
CREATE POLICY "Users manage own health workouts" ON public.health_workouts
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own health metrics" ON public.health_metrics;
CREATE POLICY "Users manage own health metrics" ON public.health_metrics
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── Dev Requests ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own dev requests" ON public.dev_requests;
CREATE POLICY "Users manage own dev requests" ON public.dev_requests
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── Logs (split-command policies preserved exactly) ────────────────────────
DROP POLICY IF EXISTS "Users read own audit logs" ON public.audit_logs;
CREATE POLICY "Users read own audit logs" ON public.audit_logs
  FOR SELECT USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users delete own audit logs" ON public.audit_logs;
CREATE POLICY "Users delete own audit logs" ON public.audit_logs
  FOR DELETE USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users see own error logs" ON public.app_error_logs;
CREATE POLICY "Users see own error logs" ON public.app_error_logs
  FOR SELECT USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users insert own error logs" ON public.app_error_logs;
CREATE POLICY "Users insert own error logs" ON public.app_error_logs
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users delete own error logs" ON public.app_error_logs;
CREATE POLICY "Users delete own error logs" ON public.app_error_logs
  FOR DELETE USING ((select auth.uid()) = user_id);
