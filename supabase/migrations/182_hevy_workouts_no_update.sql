-- 182 · Stored Hevy workouts can't be changed from the browser (security review of #593, 31.10.2026; owner go
-- 02.11.2026, "Security > Feature").
--
-- Since 179 every Hevy workout is an event in Apple Calendar ("Lasci · Training"): its title, notes, start and end
-- are read from hevy_workouts by the icloud-calendar function. 024 gave the browser (`authenticated`) UPDATE, and
-- Supabase's default privileges hand both API roles everything else, so a stolen session could rewrite what Apple
-- Calendar shows for a workout. No screen changes a stored workout — the four Hevy syncs and icloud-calendar write
-- with the service role, and 166's training_workout_relink is SECURITY DEFINER — so UPDATE (and the table-level
-- TRUNCATE, REFERENCES, TRIGGER) are taken back.
--
-- Kept on purpose: SELECT (the app reads workouts), and DELETE + INSERT for Developer → Connections → "Check
-- workouts with Hevy", which deletes the workouts Hevy no longer has through app_delete_rows (144, as the caller)
-- and puts them back on Undo. An insert can't aim at another workout's event: its key (`icloud_key`) is generated
-- from the row's own id (179) and unique per account. The visitor role (anon) gets nothing.
--
-- Re-runnable (REVOKE is a no-op the second time). No BEGIN/COMMIT: the deploy runs it as one transaction.

revoke update, truncate, references, trigger on table public.hevy_workouts from authenticated;
revoke all on table public.hevy_workouts from anon;

comment on table public.hevy_workouts is
  'Completed Hevy workouts, synced from Hevy (the service role writes; the browser reads, and deletes and restores '
  'through Check workouts with Hevy — never updates, 182). Each is an event in Apple Calendar''s Training calendar '
  '(179), named by icloud_key.';
