-- Migration 182's scenarios (Hevy workouts are read-only for the browser), after 182 ran twice on the real 024
-- and 026 (scripts/verify-db-hevy-read-only.mjs). Setup and the catalogue checks run as the superuser; the
-- Hevy syncs write as service_role; the app as `authenticated` under row level security. Each `ok` raises on a
-- mismatch.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated, service_role, anon;

-- A synced workout of account 1 and one of account 2.
insert into public.hevy_workouts (id, user_id, title, description, start_time, end_time, hevy_updated_at, hevy_created_at) values
  ('w-1', '00000000-0000-0000-0000-000000000001', 'Lower B', 'Felt strong', '2026-10-30 16:00+00', '2026-10-30 17:05+00', now(), now()),
  ('w-2', '00000000-0000-0000-0000-000000000002', 'Upper A', null, '2026-10-30 08:00+00', '2026-10-30 09:00+00', now(), now());

-- 166's training_workout_relink in small: a SECURITY DEFINER function owned by the migrations' owner.
create or replace function public.t_definer_touch(p_id text) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.hevy_workouts set routine_id = routine_id where id = p_id;
end $$;
revoke all on function public.t_definer_touch(text) from public;
grant execute on function public.t_definer_touch(text) to authenticated;

-- ── 1. What each role may do ───────────────────────────────────────────────
select t_ok(has_table_privilege('authenticated', 'public.hevy_workouts', 'SELECT'), 'R1 the browser still reads workouts');
select t_ok(not has_table_privilege('authenticated', 'public.hevy_workouts', 'INSERT')
        and not has_table_privilege('authenticated', 'public.hevy_workouts', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.hevy_workouts', 'DELETE')
        and not has_table_privilege('authenticated', 'public.hevy_workouts', 'TRUNCATE')
        and not has_table_privilege('authenticated', 'public.hevy_workouts', 'REFERENCES')
        and not has_table_privilege('authenticated', 'public.hevy_workouts', 'TRIGGER'),
       'R1 the browser can no longer add, change, delete, empty or hang anything on workouts (Supabase''s default grants too)');
select t_ok(not has_table_privilege('anon', 'public.hevy_workouts', 'SELECT')
        and not has_table_privilege('anon', 'public.hevy_workouts', 'INSERT')
        and not has_table_privilege('anon', 'public.hevy_workouts', 'UPDATE')
        and not has_table_privilege('anon', 'public.hevy_workouts', 'DELETE'),
       'R1 a visitor without an account has nothing on workouts');
select t_ok(has_table_privilege('service_role', 'public.hevy_workouts', 'INSERT')
        and has_table_privilege('service_role', 'public.hevy_workouts', 'UPDATE')
        and has_table_privilege('service_role', 'public.hevy_workouts', 'DELETE'),
       'R1 the Hevy syncs and icloud-calendar (service role) still write workouts');
select t_ok((select count(*) from pg_policies where tablename = 'hevy_workouts') >= 1, 'R1 the row policies are left as they were');

-- ── 2. The browser as account 1 ─────────────────────────────────────────────
set test.uid = '00000000-0000-0000-0000-000000000001';
set role authenticated;
select t_ok((select count(*) from public.hevy_workouts) = 1 and (select id from public.hevy_workouts) = 'w-1',
            'R2 the browser reads its own workout only');
do $$
begin
  begin
    update public.hevy_workouts set title = 'Renamed from a browser' where id = 'w-1';
    perform t_ok(false, 'R2 a browser rename of a workout is refused');
  exception when insufficient_privilege then perform t_ok(true, 'R2 a browser rename of a workout is refused'); end;
  begin
    update public.hevy_workouts set start_time = start_time + interval '3 days' where id = 'w-1';
    perform t_ok(false, 'R2 a browser move of a workout is refused');
  exception when insufficient_privilege then perform t_ok(true, 'R2 a browser move of a workout is refused'); end;
  begin
    insert into public.hevy_workouts (id, user_id, title, hevy_updated_at, hevy_created_at)
      values ('w-forged', '00000000-0000-0000-0000-000000000001', 'Forged', now(), now());
    perform t_ok(false, 'R2 a browser can''t add a workout');
  exception when insufficient_privilege then perform t_ok(true, 'R2 a browser can''t add a workout'); end;
  begin
    delete from public.hevy_workouts where id = 'w-1';
    perform t_ok(false, 'R2 a browser can''t delete a workout');
  exception when insufficient_privilege then perform t_ok(true, 'R2 a browser can''t delete a workout'); end;
  -- 166's relink path: a definer function the browser's own writes set off still works.
  perform public.t_definer_touch('w-1');
  perform t_ok(true, 'R2 a SECURITY DEFINER rule (166''s relink) still updates a workout from a browser session');
end $$;
reset role;
select t_ok((select title from public.hevy_workouts where id = 'w-1') = 'Lower B'
        and (select start_time from public.hevy_workouts where id = 'w-1') = '2026-10-30 16:00+00'
        and (select count(*) from public.hevy_workouts) = 2,
       'R2 nothing the browser tried changed a row');

-- ── 3. The Hevy syncs (service role) ────────────────────────────────────────
set role service_role;
do $$
begin
  insert into public.hevy_workouts (id, user_id, title, start_time, hevy_updated_at, hevy_created_at)
    values ('w-3', '00000000-0000-0000-0000-000000000001', 'Push', '2026-10-31 16:00+00', now(), now());
  update public.hevy_workouts set title = 'Push (edited in Hevy)' where id = 'w-3';
  delete from public.hevy_workouts where id = 'w-3';
  perform t_ok(not exists (select 1 from public.hevy_workouts where id = 'w-3'), 'R3 a sync still adds, renames and deletes a workout');
end $$;
reset role;
