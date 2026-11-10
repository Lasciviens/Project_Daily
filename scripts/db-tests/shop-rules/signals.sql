-- Migration 190 (what Needs a look remembers, deal days, stock in the price history, price figures in one call) on
-- the Shop chain after 187, 188 and 190 each ran twice (scripts/verify-db-shop-rules.mjs), after scenarios.sql and
-- site-policies.sql (whose t_ok, t_err, t_keep and t_auth_admin this uses). scenarios.sql's S10 deleted account 2,
-- so account 4 is the second app user here; account 3 is outside the owner lock. Setup and checks run as the
-- superuser; app reads and writes as `authenticated`, shop-price's as `service_role`. Names are made up.
insert into auth.users values ('00000000-0000-0000-0000-000000000004') on conflict do nothing;
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000004') on conflict do nothing;
-- A state compared field by field (updated_at moves with every write).
create or replace function public.t_state(j jsonb) returns jsonb language sql immutable as $$ select j - 'updated_at' $$;
grant execute on function public.t_state(jsonb) to authenticated;

insert into public.shop_items (id, user_id, title, status, url) values
  ('cc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Headphones', 'wishlist', 'https://shop.example/headphones'),
  ('cc000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Coffee grinder', 'wishlist', null),
  ('cc000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Desk lamp', 'wishlist', null),
  ('cc000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Speaker', 'wishlist', null),
  ('cc000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'Kettle', 'wishlist', null),
  ('cc000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', 'Camera', 'wishlist', 'https://shop.example/camera'),
  ('cc000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Monitor', 'wishlist', 'https://shop.example/monitor'),
  ('cc000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Blender', 'wishlist', 'https://shop.example/blender'),
  ('cc000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'Phone', 'wishlist', 'https://www.prisjakt.no/product.php?p=1'),
  ('cc000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', 'Toaster', 'wishlist', 'https://shop.example/toaster'),
  ('cc000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000001', 'Router', 'wishlist', 'https://shop.example/router'),
  ('cc000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000004', 'Their bike', 'wishlist', 'https://shop.example/bike');

-- ═══ Q0. The migration ═══════════════════════════════════════════════════════
select t_ok((select relrowsecurity from pg_class where oid = 'public.shop_signal_states'::regclass)
        and (select relrowsecurity from pg_class where oid = 'public.shop_deal_days'::regclass)
        and exists (select 1 from pg_policies where tablename = 'shop_signal_states' and policyname = 'app_owner_lock')
        and exists (select 1 from pg_policies where tablename = 'shop_deal_days' and policyname = 'app_owner_lock')
        and exists (select 1 from pg_policies where tablename = 'shop_signal_states' and policyname = 'Users manage own shop_signal_states'
                      and cmd = 'ALL' and qual like '%auth.uid()%' and with_check like '%auth.uid()%')
        and (select count(*) = 1 from pg_policies where tablename = 'shop_deal_days' and policyname <> 'app_owner_lock' and cmd = 'SELECT'),
  'Q0 after two runs: row level security and the owner lock on both tables, the owner policy on signal states, deal days read-only');
select t_ok((select count(*) = 1 from pg_trigger where tgrelid = 'public.shop_signal_states'::regclass and tgname = 'trg_audit')
        and (select count(*) = 1 from pg_trigger where tgrelid = 'public.shop_signal_states'::regclass and tgname = 'trg_shop_signal_states_rules')
        and (select count(*) = 1 from pg_trigger where tgrelid = 'public.shop_signal_states'::regclass and tgname = 'trg_shop_signal_states_updated_at')
        and not exists (select 1 from pg_trigger where tgrelid = 'public.shop_deal_days'::regclass and tgname = 'trg_audit')
        and exists (select 1 from pg_trigger where tgrelid = 'public.shop_deal_days'::regclass and tgname = 'trg_shop_deal_days_updated_at'),
  'Q0 signal states are audited and kept by their rules trigger; deal days have no audit (migrations write them), updated_at kept');
select t_ok(bool_and(has_table_privilege('authenticated', 'public.shop_signal_states', p) and has_table_privilege('service_role', 'public.shop_signal_states', p)
                     and not has_table_privilege('anon', 'public.shop_signal_states', p)
                     and has_table_privilege('service_role', 'public.shop_deal_days', p) and not has_table_privilege('anon', 'public.shop_deal_days', p)
                     and has_table_privilege('authenticated', 'public.shop_deal_days', p) = (p = 'select')),
  'Q0 grants: the app reads and writes its signal states and only reads deal days; signed out nothing; the service role both')
  from unnest(array['select', 'insert', 'update', 'delete']) p;
select t_ok((select count(*) = 6 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
               'shop_signal_states_rules', 'shop_signal_snooze', 'shop_signal_dismiss', 'shop_signal_put', 'shop_restore_price_history', 'shop_price_stats'))
        and (select bool_and(p.proconfig = array['search_path=""'] and p.prosecdef = (p.proname = 'shop_restore_price_history'))
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
               'shop_signal_states_rules', 'shop_signal_snooze', 'shop_signal_dismiss', 'shop_signal_put', 'shop_restore_price_history', 'shop_price_stats')),
  'Q0 every function 190 writes has search_path ''''; only the price-history helper is SECURITY DEFINER');
select t_ok(bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
            and not has_function_privilege('service_role', 'public.shop_restore_price_history(jsonb, jsonb)', 'execute')
            and not has_function_privilege('anon', 'public.shop_restore_price_history(jsonb, jsonb)', 'execute'),
  'Q0 the functions are for signed-in callers (never anon); the definer helper not even for the service role')
  from unnest(array['public.shop_signal_snooze(uuid, text, date)', 'public.shop_signal_dismiss(uuid, text, text)',
                    'public.shop_signal_put(uuid, text, jsonb)', 'public.shop_price_stats(uuid[])', 'public.shop_restore_price_history(jsonb, jsonb)']) f;
select t_ok((select data_type = 'boolean' from information_schema.columns where table_name = 'shop_price_points' and column_name = 'in_stock')
        and (select count(*) = 2 and bool_and(convalidated) from pg_constraint
              where conrelid = 'public.shop_price_points'::regclass and conname in ('shop_price_points_low_finite_check', 'shop_price_points_high_finite_check')),
  'Q0 a price point has in_stock; its low and high must be finite (both checks validated: no old row broke them)');
select t_ok((select string_agg(slug || ':' || rule_kind || ':' || month || ':' || coalesce(day::text, '-') || ':' || coalesce(weekday::text, '-') || ':'
                               || coalesce(nth::text, '-') || ':' || offset_days || ':' || length_days, ',' order by slug) from public.shop_deal_days)
          = 'black_friday:nth_weekday:11:-:4:4:1:1,cyber_monday:nth_weekday:11:-:4:4:4:1,mellomdagssalg:fixed:12:27:-:-:0:5,singles_day:fixed:11:11:-:-:0:1'
        and (select bool_and(checked_on = '2026-11-10' and source_url is null and name <> '') from public.shop_deal_days),
  'Q0 four deal days as rules (the 4th Thursday of November + 1 and + 4, 11.11, 27.12 for 5 days), checked 10.11.2026');

-- ═══ Q1. Snooze, Got it and an exact Undo ════════════════════════════════════
set role authenticated;
do $$
declare
  r jsonb; s1 jsonb; s2 jsonb; s3 jsonb; s4 jsonb;
  w constant uuid := 'cc000000-0000-0000-0000-000000000001';
begin
  r := public.shop_signal_snooze(w, 'at_target', '2026-11-17');
  s1 := r -> 'after';
  perform t_ok(r -> 'before' = 'null'::jsonb and s1 ->> 'snoozed_until' = '2026-11-17' and s1 ->> 'signature' is null and s1 ->> 'dismissed_at' is null
               and s1 ->> 'user_id' = '00000000-0000-0000-0000-000000000001' and s1 ->> 'item_id' = w::text
               and (select count(*) = 1 from public.shop_signal_states),
    'Q1 Snooze: a new row until the day, the answer says there was none before');
  r := public.shop_signal_snooze(w, 'at_target', '2026-11-20');
  s2 := r -> 'after';
  perform t_ok(r -> 'before' = s1 and s2 ->> 'id' = s1 ->> 'id' and s2 ->> 'snoozed_until' = '2026-11-20'
               and (select count(*) = 1 from public.shop_signal_states),
    'Q1 Snooze again: the same row, a new day, the answer''s before is the row as it was');
  r := public.shop_signal_dismiss(w, 'at_target', 'at_target|NOK|6990');
  s3 := r -> 'after';
  perform t_ok(r -> 'before' = s2 and s3 ->> 'signature' = 'at_target|NOK|6990' and (s3 ->> 'dismissed_at')::timestamptz = now()
               and s3 ->> 'snoozed_until' is null and s3 ->> 'id' = s1 ->> 'id',
    'Q1 Got it stores the signature and the database''s time, and ends the snooze');
  r := public.shop_signal_snooze(w, 'at_target', '2026-11-25');
  s4 := r -> 'after';
  perform t_ok(r -> 'before' = s3 and s4 ->> 'signature' = 'at_target|NOK|6990' and s4 ->> 'dismissed_at' = s3 ->> 'dismissed_at'
               and s4 ->> 'snoozed_until' = '2026-11-25',
    'Q1 a snooze keeps an earlier Got it');
  r := public.shop_signal_put(w, 'at_target', r -> 'before');
  perform t_ok(t_state(r -> 'after') = t_state(s3) and r -> 'before' = s4,
    'Q1 the snooze''s Undo puts the Got it back exactly (its signature, its time, no snooze)');
  r := public.shop_signal_put(w, 'at_target', s2);
  perform t_ok(t_state(r -> 'after') = t_state(s2),
    'Q1 the Got it''s Undo puts the snooze back exactly (20.11.2026, no signature)');
  r := public.shop_signal_put(w, 'at_target', null);
  perform t_ok(r -> 'after' = 'null'::jsonb and t_state(r -> 'before') = t_state(s2)
               and not exists (select 1 from public.shop_signal_states where item_id = w),
    'Q1 Show again deletes the row and answers what it was');
  r := public.shop_signal_put(w, 'at_target', s2);
  perform t_ok(t_state(r -> 'after') = t_state(s2) and r -> 'before' = 'null'::jsonb,
    'Q1 …and its Undo makes it again with its own id and first time');
  perform public.shop_signal_snooze(null, 'tidy_up', '2026-11-12');
  r := public.shop_signal_snooze(null, 'tidy_up', '2026-11-13');
  perform t_ok((select count(*) = 1 from public.shop_signal_states where item_id is null and signal = 'tidy_up' and snoozed_until = '2026-11-13')
               and r -> 'before' ->> 'snoozed_until' = '2026-11-12',
    'Q1 a row about the whole page (no thing) is one row per signal too');
  perform public.shop_signal_snooze('cc000000-0000-0000-0000-000000000002', k, '2026-12-01')
     from unnest(array['at_target', 'lowest_seen', 'back_in_stock', 'fake_before', 'deal_day', 'cheaper_returnable',
                       'return_closing', 'complaint_ending', 'old_value', 'old_wish', 'tidy_up']) k;
  perform t_ok((select count(distinct signal) = 11 from public.shop_signal_states where item_id = 'cc000000-0000-0000-0000-000000000002'),
    'Q1 every one of the eleven signals is taken');
  perform t_ok(t_err($q$select public.shop_signal_snooze('cc000000-0000-0000-0000-000000000002', 'made_up', '2026-12-01')$q$) like '23514 %'
           and t_err($q$select public.shop_signal_dismiss('cc000000-0000-0000-0000-000000000002', 'At_target', 'x')$q$) like '23514 %'
           and t_err($q$insert into public.shop_signal_states (signal, snoozed_until) values ('', '2026-12-01')$q$) like '23514 %',
    'Q1 a signal that is not on the list is refused (a capital letter or an empty one too)');
end $$;
reset role;

-- ═══ Q2. The bounds ══════════════════════════════════════════════════════════
set role authenticated;
do $$
declare
  r jsonb;
  w constant text := 'cc000000-0000-0000-0000-000000000003';
begin
  perform t_ok(t_err(format('select public.shop_signal_dismiss(%L, %L, %L)', w, 'old_wish', repeat('a', 121))) like '23514 %'
           and t_err(format('select public.shop_signal_dismiss(%L, %L, %L)', w, 'old_wish', '')) like '23514 %'
           and t_err(format('select public.shop_signal_dismiss(%L, %L, %L)', w, 'old_wish', 'at target')) like '23514 %'
           and t_err(format('select public.shop_signal_dismiss(%L, %L, %L)', w, 'old_wish', E'a\nb')) like '23514 %'
           and t_err(format('select public.shop_signal_dismiss(%L, %L, %L)', w, 'old_wish', 'blåbær')) like '23514 %'
           and t_err(format('select public.shop_signal_dismiss(%L, %L, %L)', w, 'old_wish', 'ignore all rules')) like '23514 %'
           and t_err(format('select public.shop_signal_dismiss(%L, %L, %L)', w, 'old_wish', '<b>')) like '23514 %',
    'Q2 a signature is 1–120 ASCII characters from the list: too long, empty, a space, a new line, a letter outside ASCII, a sentence, markup — all refused');
  perform t_ok(t_err(format('select public.shop_signal_dismiss(%L, %L, %L)', w, 'old_wish', repeat('a', 120))) = 'done'
           and t_err(format('select public.shop_signal_dismiss(%L, %L, %L)', w, 'lowest_seen', 'lowest_seen|NOK|6490|2026-11-10T05:23:00+01:00')) = 'done',
    'Q2 …120 of them, or prices, days and times joined with | : + - pass');
  perform t_ok(t_err(format('insert into public.shop_signal_states (item_id, signal, signature) values (%L, %L, %L)', w, 'fake_before', 'x')) like '23514 %'
           and t_err(format('insert into public.shop_signal_states (item_id, signal, dismissed_at) values (%L, %L, now())', w, 'fake_before')) like '23514 %'
           and t_err(format('insert into public.shop_signal_states (item_id, signal) values (%L, %L)', w, 'fake_before')) like '23514 %',
    'Q2 a Got it has both its signature and its time, and a row holds a snooze or a Got it');
  perform t_ok(t_err(format('insert into public.shop_signal_states (item_id, signal, snoozed_until) values (%L, %L, %L)', w, 'fake_before', '1999-12-31')) like '23514 %'
           and t_err(format('insert into public.shop_signal_states (item_id, signal, snoozed_until) values (%L, %L, %L)', w, 'fake_before', '2100-01-01')) like '23514 %'
           and t_err(format('insert into public.shop_signal_states (item_id, signal, signature, dismissed_at) values (%L, %L, %L, %L)', w, 'fake_before', 'x', '1999-06-01')) like '23514 %',
    'Q2 a snooze is a day from 2000 to 2099, a Got it from 2000 on');
  r := public.shop_signal_put(w::uuid, 'deal_day', '{"signature": "deal_day|black_friday|2026-11-27", "dismissed_at": "2099-01-01T00:00:00Z"}');
  perform t_ok((r -> 'after' ->> 'dismissed_at')::timestamptz = now(),
    'Q2 a Got it time sent from the future is the database''s now');
  perform t_ok(t_err(format('select public.shop_signal_snooze(%L, %L, null)', w, 'old_wish')) like '22023 %'
           and t_err(format('select public.shop_signal_dismiss(%L, %L, null)', w, 'old_wish')) like '22023 %'
           and t_err(format('select public.shop_signal_put(%L, %L, %L::jsonb)', w, 'old_wish', '[1]')) like '22023 %'
           and t_err(format('select public.shop_signal_put(%L, %L, %L::jsonb)', w, 'old_wish', '{"snoozed_until": "soon"}')) like '22007 %',
    'Q2 a snooze without a day, a Got it without a signature, a state that is not one: refused');
end $$;
reset role;

-- ═══ Q3. Each account its own rows ══════════════════════════════════════════
insert into public.t_keep values ('q3_owner', (select jsonb_agg(to_jsonb(s) order by s.id) from public.shop_signal_states s));
set test.uid = '00000000-0000-0000-0000-000000000004';
set role authenticated;
do $$
declare
  r jsonb; n_up int; n_del int;
begin
  perform t_ok((select count(*) = 0 from public.shop_signal_states), 'Q3 another app user reads none of the owner''s rows');
  update public.shop_signal_states set snoozed_until = '2030-01-01' where item_id = 'cc000000-0000-0000-0000-000000000001';
  get diagnostics n_up = row_count;
  delete from public.shop_signal_states where item_id is null or item_id is not null;
  get diagnostics n_del = row_count;
  perform t_ok(n_up = 0 and n_del = 0, 'Q3 …and changes or deletes none of them');
  perform t_ok(t_err($q$insert into public.shop_signal_states (user_id, signal, snoozed_until) values ('00000000-0000-0000-0000-000000000001', 'tidy_up', '2026-12-01')$q$) like '42501 %'
           and t_err($q$insert into public.shop_signal_states (item_id, signal, snoozed_until) values ('cc000000-0000-0000-0000-000000000001', 'old_wish', '2026-12-01')$q$) like '23514 %'
           and t_err($q$select public.shop_signal_snooze('cc000000-0000-0000-0000-000000000001', 'old_wish', '2026-12-01')$q$) like '23514 %'
           and t_err($q$select public.shop_signal_dismiss('cc000000-0000-0000-0000-000000000006', 'old_wish', 'x')$q$) like '23514 %',
    'Q3 …can''t write a row as the owner, nor one about the owner''s thing (directly or through the functions)');
  r := public.shop_signal_put('cc000000-0000-0000-0000-000000000001', 'at_target', null);
  perform t_ok(r -> 'before' = 'null'::jsonb and public.shop_signal_put(null, 'tidy_up', null) -> 'before' = 'null'::jsonb,
    'Q3 …and their Show again finds only their own rows (none)');
  r := public.shop_signal_snooze('cc000000-0000-0000-0000-0000000000f1', 'old_wish', '2026-12-01');
  perform t_ok(r -> 'after' ->> 'user_id' = '00000000-0000-0000-0000-000000000004' and (select count(*) = 1 from public.shop_signal_states),
    'Q3 their own thing: their own row');
end $$;
reset role;
reset test.uid;
select t_ok((select jsonb_agg(to_jsonb(s) order by s.id) from public.shop_signal_states s where s.user_id = '00000000-0000-0000-0000-000000000001')
            = (select v from public.t_keep where k = 'q3_owner'),
  'Q3 the owner''s rows are exactly as they were');
set test.uid = '00000000-0000-0000-0000-000000000003';
set role authenticated;
select t_ok((select count(*) = 0 from public.shop_signal_states)
        and t_err($q$select public.shop_signal_snooze(null, 'tidy_up', '2026-12-01')$q$) like '42501 %'
        and t_err($q$select public.shop_signal_put(null, 'tidy_up', null)$q$) like '42501 %'
        and t_err($q$insert into public.shop_signal_states (signal, snoozed_until) values ('tidy_up', '2026-12-01')$q$) like '42501 %'
        and t_err($q$select * from public.shop_price_stats(array['cc000000-0000-0000-0000-000000000011']::uuid[])$q$) like '42501 %',
  'Q3 an account outside the owner lock reads nothing, writes nothing and gets no price figures');
reset role;
reset test.uid;
set role anon;
select t_ok(t_err('select count(*) from public.shop_signal_states') like '42501 %'
        and t_err('select count(*) from public.shop_deal_days') like '42501 %'
        and t_err($q$select public.shop_signal_snooze(null, 'tidy_up', '2026-12-01')$q$) like '42501 %'
        and t_err($q$select public.shop_signal_put(null, 'tidy_up', null)$q$) like '42501 %'
        and t_err('select * from public.shop_price_stats(null)') like '42501 %',
  'Q3 signed out: no access to either table or any of the functions');
reset role;

-- ═══ Q4. Delete with Undo and Undo this save ═════════════════════════════════
set role authenticated;
do $$
declare s jsonb; was jsonb;
begin
  perform public.shop_signal_dismiss('cc000000-0000-0000-0000-000000000006', 'old_wish', 'old_wish|2026-05-01');
  perform public.shop_signal_snooze('cc000000-0000-0000-0000-000000000006', 'at_target', '2026-11-30');
  select jsonb_agg(to_jsonb(x) order by x.signal) into was from public.shop_signal_states x where x.item_id = 'cc000000-0000-0000-0000-000000000006';
  s := public.shop_delete_items(array['cc000000-0000-0000-0000-000000000006']::uuid[]);
  perform t_ok(not exists (select 1 from public.shop_signal_states where item_id = 'cc000000-0000-0000-0000-000000000006')
               and (select count(*) = 1 from jsonb_array_elements(s -> 'more') m
                     where m ->> 'table' = 'shop_signal_states' and m ->> 'col' = 'item_id' and m ->> 'action' = 'deleted' and jsonb_array_length(m -> 'rows') = 2)
               and s -> 'hidden' = '[]',
    'Q4 Delete takes a thing''s Needs-a-look rows with it and keeps them in its snapshot');
  perform public.shop_restore_items(s);
  perform t_ok((select jsonb_agg(to_jsonb(x) order by x.signal) from public.shop_signal_states x where x.item_id = 'cc000000-0000-0000-0000-000000000006') = was,
    'Q4 …and its Undo puts them back exactly (the same ids, snooze and Got it)');
end $$;
do $$
begin
  perform public.shop_signal_snooze('cc000000-0000-0000-0000-000000000007', 'lowest_seen', '2026-11-25');
  insert into public.t_keep values ('q4_snooze', jsonb_build_object('tx', txid_current()));
end $$;
do $$
begin
  perform public.shop_signal_snooze('cc000000-0000-0000-0000-000000000007', 'lowest_seen', '2026-11-28');
  insert into public.t_keep values ('q4_again', jsonb_build_object('tx', txid_current()));
end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('q4_again'));
  p := public.app_undo_transaction(public.t_tx('q4_again'), true, p ->> 'confirm');
  perform t_ok((select snoozed_until = '2026-11-25' from public.shop_signal_states
                 where item_id = 'cc000000-0000-0000-0000-000000000007' and signal = 'lowest_seen'),
    'Q4 Developer → Activity undoes a snooze over an earlier one: the earlier day is back');
  p := public.app_undo_transaction(public.t_tx('q4_snooze'));
  p := public.app_undo_transaction(public.t_tx('q4_snooze'), true, p ->> 'confirm');
  perform t_ok(not exists (select 1 from public.shop_signal_states where item_id = 'cc000000-0000-0000-0000-000000000007' and signal = 'lowest_seen'),
    'Q4 …and the first snooze: the row is gone');
end $$;
reset role;

-- ═══ Q5. Stock in the price history ═════════════════════════════════════════
set test.uid = 'none';
set role service_role;
do $$
begin
  insert into public.shop_price_points (user_id, item_id, checked_at, low, currency, source, condition, in_stock) values
    ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000008', now() - interval '3 days', 5490, 'NOK', 'store', 'unknown', false),
    ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000008', now() - interval '2 days', 5290, 'NOK', 'store', 'unknown', true),
    ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000008', now() - interval '1 day', 5190, 'NOK', 'store', 'unknown', null);
  perform t_ok((select string_agg(coalesce(in_stock::text, 'null'), ',' order by checked_at) = 'false,true,null'
                from public.shop_price_points where item_id = 'cc000000-0000-0000-0000-000000000008'),
    'Q5 shop-price writes each point''s stock: out, in, not said');
  perform t_ok(t_err($q$insert into public.shop_price_points (user_id, item_id, low) values ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000008', 'NaN')$q$) like '23514 %'
           and t_err($q$insert into public.shop_price_points (user_id, item_id, low) values ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000008', 'Infinity')$q$) like '23514 %'
           and t_err($q$insert into public.shop_price_points (user_id, item_id, low, high) values ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000008', 1, 'Infinity')$q$) like '23514 %'
           and t_err($q$insert into public.shop_price_points (user_id, item_id, low, high) values ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000008', 1, 'NaN')$q$) like '23514 %',
    'Q5 a NaN or infinite low or high is refused on a new point');
end $$;
reset role;
reset test.uid;
set role authenticated;
do $$
declare s jsonb;
begin
  s := public.shop_delete_items(array['cc000000-0000-0000-0000-000000000008']::uuid[]);
  perform public.shop_restore_items(s);
  perform t_ok((select string_agg(coalesce(in_stock::text, 'null'), ',' order by checked_at) = 'false,true,null'
                from public.shop_price_points where item_id = 'cc000000-0000-0000-0000-000000000008'),
    'Q5 Delete''s Undo puts the price history back with its stock (the helper carries in_stock)');
end $$;
reset role;

-- ═══ Q6. Price figures for many things in one call ═══════════════════════════
-- Monitor (…11): a long history — a mixed and an unread-kind price, one in another currency, out of stock 40 and
-- 20 days ago, back in stock 10 days ago. Blender (…12): out of stock at the last read. Phone (…13): only mixed and
-- unread-kind prices. Toaster (…14): out of stock only 40 days ago. Their bike (…f1): account 4's.
insert into public.shop_price_points (user_id, item_id, checked_at, low, high, currency, source, condition, in_stock) values
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', now() - interval '200 days', 9000, null, 'NOK', 'store', 'unknown', true),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', now() - interval '90 days', 12000, 12500, 'NOK', 'prisjakt', 'new', null),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', now() - interval '50 days', 7000, null, 'NOK', 'prisjakt', 'mixed', null),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', now() - interval '45 days', 6500, null, 'NOK', 'prisjakt', null, null),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', now() - interval '40 days', 10000, null, 'NOK', 'store', 'unknown', false),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', now() - interval '20 days', 8000, null, 'NOK', 'store', 'unknown', false),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', now() - interval '10 days', 8500, null, 'NOK', 'store', 'unknown', true),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', now() - interval '3 days', 8200, null, 'NOK', 'store', 'unknown', true),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', now() - interval '2 days', 99999, null, 'EUR', 'store', 'unknown', null),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', now() - interval '1 day', 8900, null, 'NOK', 'store', 'unknown', true),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000012', now() - interval '15 days', 5000, null, 'NOK', 'store', 'unknown', true),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000012', now() - interval '5 days', 5200, null, 'NOK', 'store', 'unknown', false),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000013', now() - interval '3 days', 3000, null, 'NOK', 'prisjakt', 'mixed', null),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000013', now() - interval '2 days', 2900, null, 'NOK', 'prisjakt', null, null),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000014', now() - interval '40 days', 700, null, 'NOK', 'store', 'unknown', false),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000014', now() - interval '35 days', 690, null, 'NOK', 'store', 'unknown', true),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000014', now() - interval '1 day', 680, null, 'NOK', 'store', 'unknown', true),
  ('00000000-0000-0000-0000-000000000004', 'cc000000-0000-0000-0000-0000000000f1', now() - interval '2 days', 15000, null, 'NOK', 'store', 'unknown', true);
set role authenticated;
do $$
declare
  r record;
  ids constant uuid[] := array['cc000000-0000-0000-0000-000000000011', 'cc000000-0000-0000-0000-000000000012', 'cc000000-0000-0000-0000-000000000013',
                               'cc000000-0000-0000-0000-000000000014', 'cc000000-0000-0000-0000-0000000000f1']::uuid[];
begin
  select * into r from public.shop_price_stats(ids) x where x.item_id = 'cc000000-0000-0000-0000-000000000011';
  perform t_ok(r.currency = 'NOK' and r.points = 7 and r.low_all = 8000 and r.high_all = 12000,
    'Q6 all the history kept: the lowest and highest clean price (a mixed and an unread-kind price left out, so is one in another currency)');
  perform t_ok(r.points_60d = 5 and r.low_60d = 8000 and r.high_60d = 10000,
    'Q6 …and the last 60 days (the highest is the one a "before" price is checked against)');
  perform t_ok(r.last_price = 8900 and r.last_in_stock and abs(extract(epoch from (r.last_at - (now() - interval '1 day')))) < 60,
    'Q6 the last clean read: its price, its stock, its time');
  perform t_ok(r.back_in_stock and abs(extract(epoch from (r.restocked_at - (now() - interval '10 days')))) < 60,
    'Q6 back in stock: out of stock 20 days ago, in stock since 10 days ago');
  perform t_ok(r.spark = array[null, null, null, 10000, null, null, null, 8000, null, 8500, null, 8200]::numeric[],
    'Q6 the sparkline: 12 steps of 5 days, oldest first, each step''s lowest, nothing where nothing was read');
  select * into r from public.shop_price_stats(ids) x where x.item_id = 'cc000000-0000-0000-0000-000000000012';
  perform t_ok(r.last_price = 5200 and r.last_in_stock = false and not r.back_in_stock and r.restocked_at is null,
    'Q6 out of stock at the last read: not back in stock');
  select * into r from public.shop_price_stats(ids) x where x.item_id = 'cc000000-0000-0000-0000-000000000014';
  perform t_ok(r.last_in_stock and not r.back_in_stock,
    'Q6 out of stock only 40 days ago: not "back in stock" now');
  perform t_ok(not exists (select 1 from public.shop_price_stats(ids) x where x.item_id = 'cc000000-0000-0000-0000-000000000013'),
    'Q6 a thing with only mixed or unread-kind prices has no clean figures');
  perform t_ok(not exists (select 1 from public.shop_price_stats(ids) x where x.item_id = 'cc000000-0000-0000-0000-0000000000f1')
               and (select count(*) = 3 from public.shop_price_stats(ids)),
    'Q6 another account''s thing in the list gives nothing');
  perform t_ok((select count(*) = 1 from public.shop_price_stats(array['cc000000-0000-0000-0000-000000000011', 'cc000000-0000-0000-0000-000000000011']::uuid[]))
           and not exists (select 1 from public.shop_price_stats(null))
           and not exists (select 1 from public.shop_price_stats('{}'::uuid[])),
    'Q6 an id twice is one answer; no ids, no answer');
  perform t_ok((select count(*) = 1 from public.shop_price_stats(array['cc000000-0000-0000-0000-000000000011']::uuid[]
                                                                 || array(select gen_random_uuid() from generate_series(1, 499))))
           and t_err('select count(*) from public.shop_price_stats(array(select gen_random_uuid() from generate_series(1, 501)))') like '22023 %',
    'Q6 500 ids at most in one call (501 is refused)');
end $$;
reset role;
set test.uid = '00000000-0000-0000-0000-000000000004';
set role authenticated;
select t_ok((select count(*) = 1 from public.shop_price_stats(array['cc000000-0000-0000-0000-000000000011', 'cc000000-0000-0000-0000-0000000000f1']::uuid[]))
        and (select last_price = 15000 from public.shop_price_stats(array['cc000000-0000-0000-0000-0000000000f1']::uuid[]))
        and not exists (select 1 from public.shop_price_stats(array['cc000000-0000-0000-0000-000000000011', 'cc000000-0000-0000-0000-000000000012']::uuid[])),
  'Q6 the other account gets its own figures only: the owner''s ids answer nothing');
reset role;
reset test.uid;

-- NaN and infinity from before 190 (the checks only hold new writes): made here by taking the checks off, then
-- 190 runs again over them — the checks stay not valid, and the figures leave those prices out.
alter table public.shop_price_points drop constraint shop_price_points_low_finite_check;
alter table public.shop_price_points drop constraint shop_price_points_high_finite_check;
insert into public.shop_price_points (user_id, item_id, checked_at, low, high, currency, source, condition, in_stock) values
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000015', now() - interval '4 days', 4500, null, 'NOK', 'store', 'unknown', true),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000015', now() - interval '3 days', 'NaN', null, 'NOK', 'store', 'unknown', true),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000015', now() - interval '2 days', 'Infinity', null, 'NOK', 'store', 'unknown', true),
  ('00000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000015', now() - interval '1 day', 4000, 'Infinity', 'NOK', 'store', 'unknown', true);
\ir ../../../supabase/migrations/190_shop_needs_a_look.sql
select t_ok((select count(*) = 2 and not bool_or(convalidated) from pg_constraint
              where conrelid = 'public.shop_price_points'::regclass and conname in ('shop_price_points_low_finite_check', 'shop_price_points_high_finite_check')),
  'Q6 190 runs again over old NaN and infinite prices: its checks stay not valid (they still hold new writes)');
set role authenticated;
select t_ok((select points = 2 and low_all = 4000 and high_all = 4500 and last_price = 4000
                    and spark = array[null, null, null, null, null, null, null, null, null, null, null, 4000]::numeric[]
                    and (to_jsonb(x)::text) !~* 'nan|infinity'
               from public.shop_price_stats(array['cc000000-0000-0000-0000-000000000015']::uuid[]) x),
  'Q6 a NaN or infinite price is no price: left out of every figure and of the sparkline');
reset role;
delete from public.shop_price_points where not (low >= 0 and low < 'Infinity') or (high is not null and not (high >= 0 and high < 'Infinity'));
alter table public.shop_price_points validate constraint shop_price_points_low_finite_check;
alter table public.shop_price_points validate constraint shop_price_points_high_finite_check;

-- ═══ Q7. Deal days: who reads and writes them ═══════════════════════════════
set role authenticated;
select t_ok((select count(*) = 4 from public.shop_deal_days), 'Q7 the owner reads the four deal days');
select t_ok(t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, checked_on) values ('made_up', 'Made up', 'fixed', 1, 1, '2026-11-10')$q$) like '42501 %'
        and t_err($q$update public.shop_deal_days set length_days = 30 where slug = 'black_friday'$q$) like '42501 %'
        and t_err($q$delete from public.shop_deal_days where slug = 'black_friday'$q$) like '42501 %',
  'Q7 …and can''t add, change or remove one (only migrations and the service role write them)');
reset role;
set test.uid = '00000000-0000-0000-0000-000000000003';
set role authenticated;
select t_ok((select count(*) = 0 from public.shop_deal_days), 'Q7 an account outside the owner lock reads none');
reset role;
reset test.uid;
set test.uid = 'none';
set role service_role;
do $$
begin
  insert into public.shop_deal_days (slug, name, rule_kind, month, weekday, nth, offset_days, length_days, source_url, checked_on)
    values ('lindy_day', 'A made-up day', 'nth_weekday', 3, 2, -1, -1, 2, 'https://days.example/lindy', '2026-11-10');
  perform t_ok((select rule_kind = 'nth_weekday' and nth = -1 and offset_days = -1 from public.shop_deal_days where slug = 'lindy_day'),
    'Q7 the service role adds a rule (the last Tuesday of March − 1 day, for 2 days, with its source)');
  perform t_ok(t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, weekday, checked_on) values ('a1', 'x', 'fixed', 5, 1, 3, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, checked_on) values ('a2', 'x', 'fixed', 2, 29, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, checked_on) values ('a3', 'x', 'fixed', 4, 31, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, checked_on) values ('a4', 'x', 'fixed', 13, 1, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, weekday, nth, checked_on) values ('a5', 'x', 'nth_weekday', 11, 4, 5, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, weekday, checked_on) values ('a6', 'x', 'nth_weekday', 11, 4, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, weekday, nth, checked_on) values ('a7', 'x', 'nth_weekday', 11, 0, 1, '2026-11-10')$q$) like '23514 %',
    'Q7 a rule must be whole: a fixed day without a weekday, every year (no 29.02 or 31.04), a real month, the 1st–4th or last real weekday');
  perform t_ok(t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, length_days, checked_on) values ('b1', 'x', 'fixed', 1, 1, 0, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, length_days, checked_on) values ('b2', 'x', 'fixed', 1, 1, 32, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, offset_days, checked_on) values ('b3', 'x', 'fixed', 1, 1, 40, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, checked_on) values ('Black Friday', 'x', 'fixed', 1, 1, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, source_url, checked_on) values ('b5', 'x', 'fixed', 1, 1, 'http://days.example/x', '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, checked_on) values ('b6', '  ', 'fixed', 1, 1, '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_deal_days (slug, name, rule_kind, month, day, checked_on) values ('black_friday', 'x', 'fixed', 1, 1, '2026-11-10')$q$) like '23505 %',
    'Q7 …1 to 31 days long, an offset within a month, a lower-case slug (one per day), an https source, a name');
  delete from public.shop_deal_days where slug = 'lindy_day';
end $$;
reset role;
reset test.uid;

-- ═══ Q8. Deleting an account ════════════════════════════════════════════════
set test.uid = '00000000-0000-0000-0000-000000000004';
set role authenticated;
select public.shop_signal_dismiss(null, 'tidy_up', 'tidy_up|3');
reset role;
reset test.uid;
set role t_auth_admin;
delete from auth.users where id = '00000000-0000-0000-0000-000000000004';
reset role;
select t_ok(not exists (select 1 from public.shop_signal_states where user_id = '00000000-0000-0000-0000-000000000004')
        and not exists (select 1 from public.shop_items where user_id = '00000000-0000-0000-0000-000000000004'),
  'Q8 an account with Needs-a-look rows deletes cleanly (as Supabase Auth would)');
