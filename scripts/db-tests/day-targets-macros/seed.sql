-- The data a live database has before migration 153: account 1's goal row and
-- its three phases' saved targets, written the way the app wrote them (086,
-- 088, 113 columns only). scenarios.sql checks 153 left every one untouched.
insert into public.day_targets (user_id, calories, protein_g, water_ml, goal, last_calorie_adjust, phase_start_date, goal_weight_kg, updated_at)
values ('00000000-0000-0000-0000-000000000001', 2100, 180, 2500, 'cut', date '2026-10-01', date '2026-09-15', 78.0, timestamptz '2026-10-10 08:00:00+00');
insert into public.day_target_profiles (user_id, goal, calories, protein_g, water_ml, updated_at) values
  ('00000000-0000-0000-0000-000000000001', 'cut',      2100, 180, 2500, timestamptz '2026-10-10 08:00:00+00'),
  ('00000000-0000-0000-0000-000000000001', 'maintain', 2600, 160, 2500, timestamptz '2026-09-01 08:00:00+00'),
  ('00000000-0000-0000-0000-000000000001', 'gain',     2900, 160, 3000, timestamptz '2026-08-01 08:00:00+00');
-- What the rows looked like, for the "no data change" checks.
create table public.t_before as
  select 'targets' as k, to_jsonb(d) as v from public.day_targets d
  union all
  select 'profile:' || p.goal, to_jsonb(p) from public.day_target_profiles p;
create table public.t_audit_before as select count(*) as n from public.audit_logs;
