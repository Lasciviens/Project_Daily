-- Migration 153's scenarios (carb and fat goals on day_targets and on each
-- phase's saved targets), after 153 ran twice over seed.sql's rows. Setup and
-- the catalogue checks run as the superuser; the app's writes run as
-- `authenticated`, under row level security, like the app. Each `ok` raises on
-- a mismatch.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;

-- ── 1. The columns ──────────────────────────────────────────────────────────
select t_ok((select count(*) from information_schema.columns
              where table_schema = 'public' and table_name in ('day_targets', 'day_target_profiles')
                and column_name in ('carbs_g', 'fat_g') and data_type = 'integer' and is_nullable = 'YES' and column_default is null) = 4,
            'M1 carbs_g and fat_g: nullable integers with no default, on day_targets and day_target_profiles');
select t_ok((select count(*) from pg_constraint where conname in
              ('day_targets_carbs_range', 'day_targets_fat_range', 'day_target_profiles_carbs_range', 'day_target_profiles_fat_range')) = 4,
            'M1 one range CHECK per column — the second run added none');
select t_ok((select count(*) from information_schema.columns where table_name = 'day_targets') = 13,
            'M1 day_targets gained exactly two columns (086: 7, 113: 4, 153: 2)');

-- ── 2. No data change ───────────────────────────────────────────────────────
select t_ok((select to_jsonb(d) - 'carbs_g' - 'fat_g' from public.day_targets d)
              = (select v from public.t_before where k = 'targets'), 'M2 the goal row reads exactly as before (updated_at too)');
select t_ok((select bool_and(to_jsonb(p) - 'carbs_g' - 'fat_g' = b.v) from public.day_target_profiles p
              join public.t_before b on b.k = 'profile:' || p.goal), 'M2 every phase''s saved targets read exactly as before');
select t_ok((select count(*) from public.day_targets where carbs_g is not null or fat_g is not null) = 0
              and (select count(*) from public.day_target_profiles where carbs_g is not null or fat_g is not null) = 0,
            'M2 old rows have no carb or fat goal: worked out, like before');
select t_ok((select count(*) from public.audit_logs) = (select n from public.t_audit_before),
            'M2 the migration wrote nothing to the activity log');

-- ── 3. The range guard ──────────────────────────────────────────────────────
do $$
begin
  begin
    update public.day_targets set carbs_g = -1;
    perform t_ok(false, 'M3 a negative carb goal is refused');
  exception when check_violation then perform t_ok(true, 'M3 a negative carb goal is refused');
  end;
  begin
    update public.day_targets set fat_g = 1001;
    perform t_ok(false, 'M3 a fat goal over 1000 g is refused');
  exception when check_violation then perform t_ok(true, 'M3 a fat goal over 1000 g is refused');
  end;
  begin
    update public.day_target_profiles set carbs_g = 1001 where goal = 'cut';
    perform t_ok(false, 'M3 the profile''s carb goal has the same guard');
  exception when check_violation then perform t_ok(true, 'M3 the profile''s carb goal has the same guard');
  end;
  begin
    update public.day_target_profiles set fat_g = -5 where goal = 'cut';
    perform t_ok(false, 'M3 the profile''s fat goal has the same guard');
  exception when check_violation then perform t_ok(true, 'M3 the profile''s fat goal has the same guard');
  end;
end $$;

-- ── 4. Saves as the app makes them (dayTargetsApi.upsertDayTargets) ────────
set role authenticated;
insert into public.day_targets (user_id, calories, protein_g, water_ml, goal, carbs_g, fat_g)
values ('00000000-0000-0000-0000-000000000001', 2100, 180, 2500, 'cut', 180, 60)
on conflict (user_id) do update set calories = excluded.calories, protein_g = excluded.protein_g, water_ml = excluded.water_ml,
  goal = excluded.goal, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g;
insert into public.day_target_profiles (user_id, goal, calories, protein_g, water_ml, carbs_g, fat_g)
values ('00000000-0000-0000-0000-000000000001', 'cut', 2100, 180, 2500, 180, 60)
on conflict (user_id, goal) do update set calories = excluded.calories, protein_g = excluded.protein_g, water_ml = excluded.water_ml,
  carbs_g = excluded.carbs_g, fat_g = excluded.fat_g;
select t_ok((select carbs_g = 180 and fat_g = 60 from public.day_targets), 'M4 the goal row stores the owner''s carb and fat goals');
select t_ok((select carbs_g = 180 and fat_g = 60 from public.day_target_profiles where goal = 'cut'), 'M4 so does the cut''s saved targets');
select t_ok((select carbs_g is null and fat_g is null from public.day_target_profiles where goal = 'maintain'),
            'M4 maintain keeps its own: still worked out');
-- Switch to gain with only a fat goal, then back to cut: each phase keeps its own.
update public.day_targets set goal = 'gain', calories = 2900, carbs_g = null, fat_g = 90;
insert into public.day_target_profiles (user_id, goal, calories, protein_g, water_ml, carbs_g, fat_g)
values ('00000000-0000-0000-0000-000000000001', 'gain', 2900, 160, 3000, null, 90)
on conflict (user_id, goal) do update set calories = excluded.calories, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g;
select t_ok((select string_agg(goal || ':' || coalesce(carbs_g::text, '-') || '/' || coalesce(fat_g::text, '-'), ',' order by goal)
               from public.day_target_profiles) = 'cut:180/60,gain:-/90,maintain:-/-',
            'M4 cut, maintain and gain each keep their own carb and fat goals (a set one and an empty one side by side)');
update public.day_targets set carbs_g = 0, fat_g = 1000;
select t_ok((select carbs_g = 0 and fat_g = 1000 from public.day_targets), 'M4 0 and 1000 g are allowed');
update public.day_targets set carbs_g = null, fat_g = null;
select t_ok((select carbs_g is null and fat_g is null from public.day_targets), 'M4 emptying a goal stores NULL (worked out again)');

-- ── 5. Row level security ───────────────────────────────────────────────────
set test.uid = '00000000-0000-0000-0000-000000000002';
select t_ok((select count(*) from public.day_targets) = 0 and (select count(*) from public.day_target_profiles) = 0,
            'M5 another account sees none of these goals');
update public.day_targets set carbs_g = 1;
reset test.uid;
select t_ok((select carbs_g is null from public.day_targets), 'M5 and can''t change them');
reset role;

-- ── 6. The activity log records the change (Undo reads it) ──────────────────
select t_ok(exists (select 1 from public.audit_logs where table_name = 'day_targets' and operation = 'UPDATE'
                      and new_data ? 'carbs_g' and (old_data ->> 'carbs_g')::int = 180),
            'M6 changing the carb goal is in the activity log with its old value');
