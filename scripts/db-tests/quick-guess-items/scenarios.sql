-- Migration 152's scenarios (quick_guess_items), after 152 ran twice.
-- Setup and the catalogue checks run as the superuser; every read and write
-- of the presets runs as `authenticated`, under row level security and the
-- owner lock, like the app. Each `ok` raises on a mismatch.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_snap (k text primary key, v jsonb);
grant all on public.t_snap to authenticated;

-- ── 1. The table follows the table rules ────────────────────────────────────
select t_ok((select relrowsecurity from pg_class where oid = 'public.quick_guess_items'::regclass), 'Q1 row level security is on');
select t_ok(exists (select 1 from pg_policies where tablename = 'quick_guess_items' and policyname = 'Users manage own quick guess items'
                     and qual ilike '%( SELECT auth.uid()%' and with_check ilike '%( SELECT auth.uid()%'),
            'Q1 the owner policy uses (select auth.uid()) in USING and WITH CHECK');
select t_ok(exists (select 1 from pg_policies where tablename = 'quick_guess_items' and policyname = 'app_owner_lock' and permissive = 'RESTRICTIVE'),
            'Q1 the owner lock is applied');
select t_ok((select count(*) from pg_policies where tablename = 'quick_guess_items') = 2, 'Q1 a second run added no policy');
select t_ok((select column_default from information_schema.columns where table_name = 'quick_guess_items' and column_name = 'user_id') = 'auth.uid()',
            'Q1 user_id defaults to auth.uid()');
select t_ok((select count(*) from information_schema.columns where table_name = 'quick_guess_items'
              and column_name in ('created_at', 'updated_at') and is_nullable = 'NO') = 2, 'Q1 created_at and updated_at, not null');
select t_ok(exists (select 1 from pg_indexes where tablename = 'quick_guess_items' and indexdef ilike '%(user_id, sort_order)%'),
            'Q1 an index on (user_id, sort_order)');
select t_ok((select count(*) from pg_trigger where tgrelid = 'public.quick_guess_items'::regclass and not tgisinternal
              and tgname in ('trg_audit', 'trg_quick_guess_items_updated_at')) = 2, 'Q1 trg_audit and the updated_at trigger, once each');
select t_ok(public.app_pk_column('public.quick_guess_items') = 'id', 'Q1 a single id key (Undo this save and the delete flow need one)');

-- ── 2. The seed ─────────────────────────────────────────────────────────────
select t_ok((select count(*) from quick_guess_items where user_id = '00000000-0000-0000-0000-000000000001') = 9,
            'Q2 an allowed account got the nine defaults once (152 ran twice)');
select t_ok((select count(*) from quick_guess_items where user_id = '00000000-0000-0000-0000-000000000002') = 9, 'Q2 so did the second allowed account');
select t_ok((select count(*) from quick_guess_items where user_id = '00000000-0000-0000-0000-000000000003') = 0, 'Q2 an account outside the allow-list got none');
select t_ok((select string_agg(name, ',' order by sort_order) from quick_guess_items where user_id = '00000000-0000-0000-0000-000000000001')
              = 'Protein,Sweet,Soft drink,Juice,Beer,Wine,Latte,Small snack,Big snack', 'Q2 renamed and in order: Protein, Sweet, … Big snack');
select t_ok((select icon || ' ' || calories || '/' || protein_g || '/' || carbs_g || '/' || fat_g || '/' || sugar_g || ' · ' || portion
               from quick_guess_items where user_id = '00000000-0000-0000-0000-000000000001' and name = 'Sweet')
              = '🍬 220/2/38/7/30 · a handful (about 50 g)', 'Q2 Sweet keeps Candy''s values and its emoji');
select t_ok(not exists (select 1 from audit_logs where table_name = 'quick_guess_items'), 'Q2 the seed did not fill the activity log');

-- ── 3. Writes as the app makes them ─────────────────────────────────────────
set role authenticated;
do $$
declare v_id uuid;
begin
  insert into public.quick_guess_items (name, icon, portion, calories, protein_g, carbs_g, fat_g, sugar_g, sort_order)
  values ('Kebab', '🥙', 'a whole one', 700, 35, 60, 35, 5, 9) returning id into v_id;
  perform t_ok((select user_id from public.quick_guess_items where id = v_id) = '00000000-0000-0000-0000-000000000001',
               'Q3 an insert without user_id belongs to the caller');
  perform t_ok((select count(*) from public.quick_guess_items) = 10, 'Q3 the caller sees only its own ten presets');
  insert into public.t_snap values ('kebab', to_jsonb(v_id::text));
end $$;
-- the edit in its own transaction (now() is the transaction's time)
update public.quick_guess_items set name = 'Kebab plate', calories = 900 where name = 'Kebab';
select t_ok((select updated_at > created_at from public.quick_guess_items where name = 'Kebab plate'), 'Q3 an edit moves updated_at');
do $$
begin
  -- reorder: two rows swap places
  update public.quick_guess_items set sort_order = case name when 'Protein' then 1 when 'Sweet' then 0 end where name in ('Protein', 'Sweet');
  perform t_ok((select string_agg(name, ',' order by sort_order) from public.quick_guess_items where sort_order < 2) = 'Sweet,Protein', 'Q3 a reorder swaps two rows');
  -- no preset without an icon is fine; the icon is content
  insert into public.quick_guess_items (name, calories) values ('Plain', 100);
  perform t_ok((select icon is null and protein_g = 0 and sugar_g = 0 from public.quick_guess_items where name = 'Plain'), 'Q3 icon and macros are optional (macros 0)');
end $$;
reset role;
select t_ok((select count(*) from audit_logs where table_name = 'quick_guess_items' and operation = 'INSERT' and actor = 'web') = 2,
            'Q3 the app''s inserts are in the activity log');
select t_ok(exists (select 1 from audit_logs where table_name = 'quick_guess_items' and operation = 'UPDATE'
                     and new_data ->> 'name' = 'Kebab plate' and old_data ->> 'name' = 'Kebab'), 'Q3 so is the rename, with its old value');

-- ── 4. What the table refuses ──────────────────────────────────────────────
set role authenticated;
do $$
declare v_msg text;
begin
  begin insert into public.quick_guess_items (name, calories) values ('   ', 100); perform t_ok(false, 'Q4 a blank name is refused');
  exception when check_violation then perform t_ok(true, 'Q4 a blank name is refused'); end;
  begin insert into public.quick_guess_items (name, calories) values ('Nothing', 0); perform t_ok(false, 'Q4 0 kcal is refused');
  exception when check_violation then perform t_ok(true, 'Q4 0 kcal is refused'); end;
  begin insert into public.quick_guess_items (name, calories, fat_g) values ('Odd', 100, -1); perform t_ok(false, 'Q4 a negative macro is refused');
  exception when check_violation then perform t_ok(true, 'Q4 a negative macro is refused'); end;
  begin insert into public.quick_guess_items (name, calories) values (repeat('x', 61), 100); perform t_ok(false, 'Q4 a 61-character name is refused');
  exception when check_violation then perform t_ok(true, 'Q4 a 61-character name is refused'); end;
  begin insert into public.quick_guess_items (name, calories) values ('Huge', 5001); perform t_ok(false, 'Q4 over 5000 kcal is refused');
  exception when check_violation then perform t_ok(true, 'Q4 over 5000 kcal is refused'); end;
  begin
    insert into public.quick_guess_items (user_id, name, calories) values ('00000000-0000-0000-0000-000000000002', 'Planted', 100);
    perform t_ok(false, 'Q4 a row for another account is refused');
  exception when insufficient_privilege then perform t_ok(true, 'Q4 a row for another account is refused');
  end;
end $$;
reset role;

-- ── 5. Accounts stay apart ─────────────────────────────────────────────────
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
do $$
declare n int;
begin
  perform t_ok((select count(*) from public.quick_guess_items) = 9, 'Q5 account 2 sees only its own nine');
  update public.quick_guess_items set calories = 1 where id = (select (v #>> '{}')::uuid from public.t_snap where k = 'kebab');
  get diagnostics n = row_count;
  perform t_ok(n = 0, 'Q5 account 2 cannot change account 1''s preset');
  delete from public.quick_guess_items where user_id = '00000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  perform t_ok(n = 0, 'Q5 nor delete them');
end $$;
-- account 3 is signed in but not on the allow-list: the owner lock shuts it out
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
do $$
begin
  perform t_ok((select count(*) from public.quick_guess_items) = 0, 'Q5 an account off the allow-list reads nothing');
  begin
    insert into public.quick_guess_items (name, calories) values ('Sneaky', 100);
    perform t_ok(false, 'Q5 an account off the allow-list cannot add a preset');
  exception when insufficient_privilege then perform t_ok(true, 'Q5 an account off the allow-list cannot add a preset');
  end;
end $$;
select set_config('test.uid', '', false);
reset role;

-- ── 6. Delete with Undo (144), as the editor's delete does ─────────────────
set role authenticated;
do $$
declare s jsonb; r jsonb; v_id uuid := (select (v #>> '{}')::uuid from public.t_snap where k = 'kebab');
begin
  s := public.app_delete_rows('quick_guess_items', array[v_id::text]);
  perform t_ok((s ->> 'deleted')::int = 1, 'Q6 a preset delete reports one row');
  perform t_ok(not exists (select 1 from public.quick_guess_items where id = v_id), 'Q6 the preset is gone');
  r := public.app_restore_rows(s, '{}'::jsonb);
  perform t_ok((r ->> 'restored')::int = 1, 'Q6 Undo puts it back');
  perform t_ok((select name || ' ' || calories || ' ' || sort_order from public.quick_guess_items where id = v_id) = 'Kebab plate 900 9',
               'Q6 with the same id, name, values and place');
end $$;
reset role;

-- ── 7. Deleting the account takes its presets with it ──────────────────────
delete from auth.users where id = '00000000-0000-0000-0000-000000000002';
select t_ok((select count(*) from quick_guess_items where user_id = '00000000-0000-0000-0000-000000000002') = 0, 'Q7 a deleted account''s presets go with it');
