-- What a live database has before migration 154: account 1's synced exercise
-- templates (one built-in, one custom), written the way the syncs wrote them
-- before 154. scenarios.sql checks 154 left them untouched.
insert into public.hevy_exercise_templates (id, user_id, title, type, primary_muscle_group, is_custom, synced_at) values
  ('79D0BB3A', '00000000-0000-0000-0000-000000000001', 'Bench Press (Barbell)', 'weight_reps', 'chest', false, timestamptz '2026-10-01 08:00:00+00'),
  ('c1a2b3c4-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'Cable Y Raise', 'weight_reps', 'shoulders', true, timestamptz '2026-10-01 08:00:00+00');
insert into public.hevy_exercise_template_muscles (user_id, exercise_template_id, muscle_group) values
  ('00000000-0000-0000-0000-000000000001', '79D0BB3A', 'triceps');
create table public.t_before as
  select id as k, to_jsonb(t) as v from public.hevy_exercise_templates t;
