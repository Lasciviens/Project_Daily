-- Migration 154's scenarios (Hevy's whole public API), after 154 ran twice.
-- Setup and the catalogue checks run as the superuser; the Hevy functions'
-- writes run as service_role (it skips row level security, like Supabase's),
-- the app's reads as `authenticated` under row level security and the owner
-- lock. Each `ok` raises on a mismatch.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated, service_role;

-- ── 1. thumbnail_url on the exercise templates ─────────────────────────────
select t_ok(exists (select 1 from information_schema.columns where table_name = 'hevy_exercise_templates'
                     and column_name = 'thumbnail_url' and data_type = 'text' and is_nullable = 'YES'),
            'H1 hevy_exercise_templates.thumbnail_url is a nullable text column');
select t_ok((select count(*) from pg_constraint where conrelid = 'public.hevy_exercise_templates'::regclass
              and conname = 'hevy_exercise_templates_thumbnail_url_check') = 1, 'H1 one URL check after two runs');
select t_ok((select count(*) from public.hevy_exercise_templates) = 2
            and not exists (select 1 from public.hevy_exercise_templates t join public.t_before b on b.k = t.id
                             where to_jsonb(t) - 'thumbnail_url' is distinct from b.v or t.thumbnail_url is not null),
            'H1 the synced templates are untouched (no picture until the next sync)');
set role service_role;
do $$
begin
  update public.hevy_exercise_templates set thumbnail_url = 'https://d2l9nsnmtah87f.cloudfront.net/exercise-thumbnails/79D0BB3A.jpg' where id = '79D0BB3A';
  perform t_ok((select thumbnail_url from public.hevy_exercise_templates where id = '79D0BB3A') like 'https://%', 'H1 the sync stores an https picture');
  update public.hevy_exercise_templates set thumbnail_url = null where id = '79D0BB3A';
  perform t_ok((select thumbnail_url is null from public.hevy_exercise_templates where id = '79D0BB3A'), 'H1 and clears it when Hevy has none');
  begin
    update public.hevy_exercise_templates set thumbnail_url = 'javascript:alert(1)' where id = '79D0BB3A';
    perform t_ok(false, 'H1 a non-http picture is refused');
  exception when check_violation then perform t_ok(true, 'H1 a non-http picture is refused'); end;
  begin
    update public.hevy_exercise_templates set thumbnail_url = 'https://x.example/a b.png' where id = '79D0BB3A';
    perform t_ok(false, 'H1 a URL with a space is refused');
  exception when check_violation then perform t_ok(true, 'H1 a URL with a space is refused'); end;
  begin
    update public.hevy_exercise_templates set thumbnail_url = 'https://x.example/' || repeat('a', 2100) where id = '79D0BB3A';
    perform t_ok(false, 'H1 a URL over 2,048 characters is refused');
  exception when check_violation then perform t_ok(true, 'H1 a URL over 2,048 characters is refused'); end;
  -- A new custom exercise read back after POST /v1/exercise_templates.
  insert into public.hevy_exercise_templates (id, user_id, title, type, primary_muscle_group, is_custom, thumbnail_url)
  values ('c1a2b3c4-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'Landmine Press', 'weight_reps', 'shoulders', true, null)
  on conflict (id) do update set title = excluded.title, thumbnail_url = excluded.thumbnail_url;
  perform t_ok((select is_custom and thumbnail_url is null from public.hevy_exercise_templates where id = 'c1a2b3c4-0000-4000-8000-000000000002'),
               'H1 a custom exercise without a picture is stored with NULL');
end $$;
reset role;

-- ── 2. hevy_account follows the table rules ────────────────────────────────
select t_ok((select relrowsecurity from pg_class where oid = 'public.hevy_account'::regclass), 'H2 row level security is on');
select t_ok(exists (select 1 from pg_policies where tablename = 'hevy_account' and policyname = 'Users read own hevy account'
                     and cmd = 'SELECT' and qual ilike '%( SELECT auth.uid()%'),
            'H2 a select-own policy with (select auth.uid())');
select t_ok(exists (select 1 from pg_policies where tablename = 'hevy_account' and policyname = 'app_owner_lock' and permissive = 'RESTRICTIVE'),
            'H2 the owner lock is applied');
select t_ok((select count(*) from pg_policies where tablename = 'hevy_account') = 2, 'H2 no write policy, and a second run added none');
select t_ok((select column_default from information_schema.columns where table_name = 'hevy_account' and column_name = 'user_id') = 'auth.uid()',
            'H2 user_id defaults to auth.uid()');
select t_ok((select count(*) from information_schema.columns where table_name = 'hevy_account'
              and column_name in ('created_at', 'updated_at', 'synced_at') and is_nullable = 'NO') = 3, 'H2 created_at, updated_at and synced_at, not null');
select t_ok(has_table_privilege('authenticated', 'public.hevy_account', 'SELECT'), 'H2 the app may read');
select t_ok(not has_table_privilege('authenticated', 'public.hevy_account', 'INSERT')
            and not has_table_privilege('authenticated', 'public.hevy_account', 'UPDATE')
            and not has_table_privilege('authenticated', 'public.hevy_account', 'DELETE'),
            'H2 the app may not insert, update or delete (Supabase''s default grant taken back)');
select t_ok(not has_table_privilege('anon', 'public.hevy_account', 'SELECT') and not has_table_privilege('anon', 'public.hevy_account', 'INSERT'),
            'H2 a signed-out caller gets nothing');
select t_ok(has_table_privilege('service_role', 'public.hevy_account', 'INSERT') and has_table_privilege('service_role', 'public.hevy_account', 'UPDATE'),
            'H2 the service role (the Hevy functions) writes');
select t_ok((select count(*) from pg_trigger where tgrelid = 'public.hevy_account'::regclass and not tgisinternal) = 1
            and exists (select 1 from pg_trigger where tgrelid = 'public.hevy_account'::regclass and tgname = 'trg_hevy_account_updated_at'),
            'H2 only the updated_at trigger, once (no trg_audit: bulk-synced)');

-- ── 3. The Hevy functions write it ─────────────────────────────────────────
set role service_role;
do $$
begin
  insert into public.hevy_account (user_id, username, weight_unit, distance_unit, is_pro, synced_at)
  values ('00000000-0000-0000-0000-000000000001', 'lasci', 'kg', 'kilometers', true, now())
  on conflict (user_id) do update set username = excluded.username, weight_unit = excluded.weight_unit,
    distance_unit = excluded.distance_unit, is_pro = excluded.is_pro, synced_at = excluded.synced_at;
  perform t_ok((select username = 'lasci' and is_pro and hevy_workout_count is null from public.hevy_account
                 where user_id = '00000000-0000-0000-0000-000000000001'), 'H3 user info lands; the count waits for its own call');
  insert into public.hevy_account (user_id, username, weight_unit, distance_unit, is_pro, synced_at)
  values ('00000000-0000-0000-0000-000000000002', 'other', 'lbs', 'miles', false, now());
  begin
    insert into public.hevy_account (user_id, weight_unit) values ('00000000-0000-0000-0000-000000000003', 'stone');
    perform t_ok(false, 'H3 a weight unit outside Hevy''s enum is refused');
  exception when check_violation then perform t_ok(true, 'H3 a weight unit outside Hevy''s enum is refused'); end;
  begin
    insert into public.hevy_account (user_id, distance_unit) values ('00000000-0000-0000-0000-000000000003', 'km');
    perform t_ok(false, 'H3 a distance unit outside Hevy''s enum is refused');
  exception when check_violation then perform t_ok(true, 'H3 a distance unit outside Hevy''s enum is refused'); end;
  begin
    insert into public.hevy_account (user_id, hevy_workout_count) values ('00000000-0000-0000-0000-000000000003', -1);
    perform t_ok(false, 'H3 a negative workout count is refused');
  exception when check_violation then perform t_ok(true, 'H3 a negative workout count is refused'); end;
  begin
    insert into public.hevy_account (user_id, username) values ('00000000-0000-0000-0000-000000000003', '');
    perform t_ok(false, 'H3 an empty username is refused (unknown is NULL)');
  exception when check_violation then perform t_ok(true, 'H3 an empty username is refused (unknown is NULL)'); end;
  insert into public.hevy_account (user_id) values ('00000000-0000-0000-0000-000000000003');
  perform t_ok((select username is null and weight_unit is null and is_pro is null from public.hevy_account
                 where user_id = '00000000-0000-0000-0000-000000000003'), 'H3 every Hevy field may be unknown (NULL)');
end $$;
reset role;
-- The count check, in its own transaction (now() is the transaction's time).
set role service_role;
update public.hevy_account set hevy_workout_count = 312, count_checked_at = now() where user_id = '00000000-0000-0000-0000-000000000001';
reset role;
select t_ok((select hevy_workout_count = 312 and count_checked_at is not null and updated_at > created_at and username = 'lasci'
               from public.hevy_account where user_id = '00000000-0000-0000-0000-000000000001'),
            'H3 the count lands beside the user info and moves updated_at');
-- A failed read stores why; the facts already stored stay.
set role service_role;
do $$
begin
  update public.hevy_account set last_error = 'user info: Hevy answered 404', last_error_at = now()
   where user_id = '00000000-0000-0000-0000-000000000001';
  perform t_ok((select last_error = 'user info: Hevy answered 404' and last_error_at is not null and username = 'lasci' and hevy_workout_count = 312
                  from public.hevy_account where user_id = '00000000-0000-0000-0000-000000000001'),
               'H3 a failed read stores its reason beside the facts it keeps');
  begin
    update public.hevy_account set last_error = '' where user_id = '00000000-0000-0000-0000-000000000001';
    perform t_ok(false, 'H3 an empty reason is refused (none is NULL)');
  exception when check_violation then perform t_ok(true, 'H3 an empty reason is refused (none is NULL)'); end;
  begin
    update public.hevy_account set last_error = repeat('x', 501) where user_id = '00000000-0000-0000-0000-000000000001';
    perform t_ok(false, 'H3 a reason over 500 characters is refused');
  exception when check_violation then perform t_ok(true, 'H3 a reason over 500 characters is refused'); end;
end $$;
reset role;

-- ── 4. The app reads only its own row ──────────────────────────────────────
set role authenticated;
do $$
declare v_msg text;
begin
  perform t_ok((select count(*) from public.hevy_account) = 1, 'H4 account 1 sees only its own row');
  perform t_ok((select username from public.hevy_account) = 'lasci', 'H4 and it is account 1''s');
  perform t_ok((select last_error from public.hevy_account) = 'user info: Hevy answered 404', 'H4 the app reads the stored reason');
  begin
    insert into public.hevy_account (username) values ('me');
    perform t_ok(false, 'H4 the app cannot insert');
  exception when insufficient_privilege then perform t_ok(true, 'H4 the app cannot insert'); end;
  begin
    update public.hevy_account set is_pro = false;
    perform t_ok(false, 'H4 the app cannot update');
  exception when insufficient_privilege then perform t_ok(true, 'H4 the app cannot update'); end;
  begin
    delete from public.hevy_account;
    perform t_ok(false, 'H4 the app cannot delete');
  exception when insufficient_privilege then perform t_ok(true, 'H4 the app cannot delete'); end;
end $$;
set test.uid = '00000000-0000-0000-0000-000000000003';
select t_ok((select count(*) from public.hevy_account) = 0, 'H4 an account outside the allow-list sees nothing, not even its own row');
reset test.uid;
reset role;

-- ── 5. Deleting an account takes its row ──────────────────────────────────
delete from auth.users where id = '00000000-0000-0000-0000-000000000002';
select t_ok(not exists (select 1 from public.hevy_account where user_id = '00000000-0000-0000-0000-000000000002'), 'H5 a deleted account''s row goes with it');
