-- 182 · Hevy workouts are read-only for the browser (security review of #593, 31.10.2026; owner rule
-- "Security > Feature").
--
-- Since 179 every Hevy workout is an event in Apple Calendar ("Lasci · Training"): its title, notes, start and
-- end — and its key, `icloud_key`, which names the event in iCloud — are read from hevy_workouts by the
-- icloud-calendar function. 024 gave the browser (`authenticated`) INSERT, UPDATE and DELETE on the table, and
-- Supabase's default privileges hand both API roles everything else. No screen writes it: the app only reads
-- workouts (training/api/hevyApi.ts, ai/api/aiApi.ts), the assistant has the table read-only, and every writer —
-- the four Hevy syncs and icloud-calendar — uses the service role. The one database function that writes it,
-- training_workout_relink (166), is SECURITY DEFINER and runs as its owner. So a write from a browser session
-- could only be a stolen one: it could re-key a workout onto another workout's event, or rewrite what Apple
-- Calendar shows. Writes are taken back; reading stays.
--
-- Re-runnable (REVOKE and GRANT are no-ops the second time). No BEGIN/COMMIT: the deploy runs it as one
-- transaction.

revoke all on table public.hevy_workouts from anon, authenticated;
grant select on table public.hevy_workouts to authenticated;

comment on table public.hevy_workouts is
  'Completed Hevy workouts, synced from Hevy (service role only writes; the browser reads — 182). Each is an event '
  'in Apple Calendar''s Training calendar (179), named by icloud_key.';
