-- Migration 203 (a receipt's discount stored on the thing; the picture memory in ai_source_stats) on the Shop chain after 187,
-- 188, 190, 191 and 192, with 203 applied twice (scripts/verify-db-shop-rules.mjs), after scenarios.sql (whose t_ok, t_err and
-- t_keep this uses). The owner is account 1 (auth.uid() of base.sql); `test.uid = none` plays the service role (the shop-price
-- function). Setup and checks run as the superuser; the app as `authenticated`. Names and amounts are made up.
insert into auth.users values ('00000000-0000-0000-0000-000000000007') on conflict do nothing;
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000007') on conflict do nothing;

-- ═══ M0. The migration ═══════════════════════════════════════════════════════
select t_ok((select relrowsecurity from pg_class where oid = 'public.ai_source_stats'::regclass)
        and exists (select 1 from pg_policies where tablename = 'ai_source_stats' and policyname = 'app_owner_lock')
        and exists (select 1 from pg_policies where tablename = 'ai_source_stats' and policyname = 'Users read own ai_source_stats' and cmd = 'SELECT' and qual like '%auth.uid()%')
        and exists (select 1 from pg_policies where tablename = 'ai_source_stats' and policyname = 'Users change own ai_source_stats' and cmd = 'UPDATE' and qual like '%auth.uid()%' and with_check like '%auth.uid()%')
        and (select count(*) = 1 from pg_policies where tablename = 'ai_source_stats' and cmd = 'SELECT' and policyname <> 'app_owner_lock'),
  'M0 ai_source_stats: row level security, the owner lock, the owner reads and updates only its own rows');
select t_ok(has_table_privilege('service_role', 'public.ai_source_stats', 'insert') and has_table_privilege('service_role', 'public.ai_source_stats', 'update')
        and has_table_privilege('authenticated', 'public.ai_source_stats', 'select')
        and not has_table_privilege('authenticated', 'public.ai_source_stats', 'insert') and not has_table_privilege('authenticated', 'public.ai_source_stats', 'delete')
        and not has_column_privilege('authenticated', 'public.ai_source_stats', 'ok_count', 'update') and not has_column_privilege('authenticated', 'public.ai_source_stats', 'host', 'update')
        and has_column_privilege('authenticated', 'public.ai_source_stats', 'state', 'update')
        and not has_table_privilege('anon', 'public.ai_source_stats', 'select'),
  'M0 grants: the service role writes the counts; the app reads them and may change state, nothing else; signed out, nothing');
select t_ok(not has_function_privilege('authenticated', 'public.ai_source_note(uuid, text, text, boolean, text)', 'execute')
        and not has_function_privilege('anon', 'public.ai_source_note(uuid, text, text, boolean, text)', 'execute')
        and has_function_privilege('service_role', 'public.ai_source_note(uuid, text, text, boolean, text)', 'execute')
        and (select not prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.ai_source_note(uuid, text, text, boolean, text)'::regprocedure),
  'M0 ai_source_note: only the service role may run it, as the caller, with search_path ''''');
select t_ok(exists (select 1 from pg_constraint where conname = 'shop_items_discount_ok' and convalidated)
        and exists (select 1 from pg_trigger where tgrelid = 'public.shop_items'::regclass and tgname = 'trg_shop_items_discount')
        and (select count(*) = 1 from pg_trigger where tgrelid = 'public.shop_items'::regclass and tgname = 'trg_audit'),
  'M0 shop_items: the discount CHECK (validated) and its trigger are there once after two runs; the audit trigger covers the new columns');

-- ═══ M1. A discount is stored beside the paid price and changes no sum ════════
set role authenticated;
insert into public.shop_items (id, user_id, title, price, currency, status, bought_at, market_price, market_currency, discount_amount, discount_reason) values
  ('d3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Demo Headphones X1', 3290, 'NOK', 'bought', '2026-11-20 12:00+01', 3790, 'NOK', 500, 'member');
select t_ok((select price = 3290 and market_price = 3790 and discount_amount = 500 and discount_reason = 'member' from public.shop_items where id = 'd3000000-0000-0000-0000-000000000001'),
  'M1 a thing keeps what was paid (3290), the printed normal price (3790) and the discount with its reason (500, member) apart');
select t_ok((select sum(price) from public.shop_items where id = 'd3000000-0000-0000-0000-000000000001') = 3290,
  'M1 the paid total is the price alone: the discount is never subtracted (a sum over price reads 3290)');
select t_ok(public.t_err($q$insert into public.shop_items (title, price, status, bought_at, discount_amount, discount_reason) values ('Only a coupon', 100, 'bought', now(), 20, 'coupon')$q$) = 'done'
        and public.t_err($q$insert into public.shop_items (title, price, status, bought_at, discount_amount, discount_reason) values ('Staff', 100, 'bought', now(), 20, 'staff')$q$) = 'done'
        and public.t_err($q$insert into public.shop_items (title, price, status, bought_at, discount_amount, discount_reason) values ('Points', 100, 'bought', now(), 20, 'points')$q$) = 'done'
        and public.t_err($q$insert into public.shop_items (title, price, status, bought_at, discount_amount, discount_reason) values ('Campaign', 100, 'bought', now(), 20, 'campaign')$q$) = 'done'
        and public.t_err($q$insert into public.shop_items (title, price, status, bought_at, discount_amount, discount_reason) values ('Other', 100, 'bought', now(), 20, 'other')$q$) = 'done',
  'M1 each of the six reasons is accepted');
select t_ok(bool_and(public.t_err(format($q$insert into public.shop_items (title, price, status, bought_at, discount_amount, discount_reason) values ('Bad', 100, 'bought', now(), %s, %s)$q$, a, r)) like '23514%'),
  'M2 refused (23514): no amount without a reason, no reason without an amount, zero, negative, a billion, an unknown reason')
  from (values ('20', 'null'), ('null', '''coupon'''), ('0', '''coupon'''), ('-5', '''coupon'''), ('1000000000', '''coupon'''), ('20', '''because'''), ('20', '''''')) v(a, r);

-- A thing that is not bought has no purchase to have had a discount.
do $$
declare r text;
begin
  r := public.t_err($q$insert into public.shop_items (id, title, price, status, discount_amount, discount_reason) values ('d3000000-0000-0000-0000-000000000002', 'A wish', 100, 'wishlist', 20, 'coupon')$q$);
  perform t_ok(r = 'done' and (select discount_amount is null and discount_reason is null from public.shop_items where id = 'd3000000-0000-0000-0000-000000000002'),
    'M3 a wish carries no discount (the way it carries no normal price): ' || r);
end $$;
reset role;

-- ═══ M4. Delete's Undo brings the discount back ══════════════════════════════
set role authenticated;
do $$
declare s jsonb;
begin
  s := public.shop_delete_items(array['d3000000-0000-0000-0000-000000000001']::uuid[]);
  perform t_ok(not exists (select 1 from public.shop_items where id = 'd3000000-0000-0000-0000-000000000001'), 'M4 Delete takes the thing');
  perform public.shop_restore_items(s);
  perform t_ok((select price = 3290 and market_price = 3790 and discount_amount = 500 and discount_reason = 'member' from public.shop_items where id = 'd3000000-0000-0000-0000-000000000001'),
    'M4 Delete''s Undo puts the discount, its reason, the paid price and the normal price back exactly');
end $$;
reset role;

-- ═══ M5. The picture memory: written only by the service role ═════════════════
set role service_role;
set test.uid = 'none';
select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'shop_picture', 'Maker.Example.NET', true, 'ok');
select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'shop_picture', 'maker.example.net', true, 'ok');
select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'shop_picture', 'shop.example.com', false, 'not_allowed');
select public.ai_source_note('00000000-0000-0000-0000-000000000007', 'shop_picture', 'maker.example.net', false, 'blocked');
reset test.uid;
reset role;
select t_ok((select ok_count = 2 and fail_count = 0 and last_ok_at is not null and last_reason = 'ok' and state = 'on' from public.ai_source_stats
              where user_id = '00000000-0000-0000-0000-000000000001' and job = 'shop_picture' and host = 'maker.example.net'),
  'M5 two good reads of one host (a capital letter folded) are one row with ok_count 2');
select t_ok((select fail_count = 1 and ok_count = 0 and last_reason = 'not_allowed' from public.ai_source_stats where user_id = '00000000-0000-0000-0000-000000000001' and host = 'shop.example.com')
        and (select ok_count = 0 and fail_count = 1 from public.ai_source_stats where user_id = '00000000-0000-0000-0000-000000000007'),
  'M5 a refusal is counted as a failure with its reason, and each account has its own counts');
select t_ok(public.t_err($q$set local role authenticated; select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'shop_picture', 'a.example.com', true, 'ok')$q$) like '42501%'
        or public.t_err($q$set local role authenticated; select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'shop_picture', 'a.example.com', true, 'ok')$q$) like '%permission denied%',
  'M5 the signed-in app cannot note a host (the function is the service role''s alone)');
set test.uid = 'none';
select t_ok(bool_and(public.t_err(format($q$select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'shop_picture', %L, true, 'ok')$q$, h)) like '23514%'),
  'M5 a host is a plain name only: a path, a query, an address with a user, a space or an underscore name is refused (23514)')
  from unnest(array['maker.example.net/x', 'a.example.com?q=1', 'user' || chr(64) || 'a.example.com', 'a b.example.com', 'under_score.example.com', 'localhost', 'https://a.example.com', repeat('a', 64) || '.example.com']) h;

reset test.uid;

-- ═══ M6. The browser: reads its own, changes only the state ═══════════════════
set role authenticated;
select t_ok((select count(*) = 2 from public.ai_source_stats where job = 'shop_picture')
        and not exists (select 1 from public.ai_source_stats where user_id = '00000000-0000-0000-0000-000000000007'),
  'M6 the owner reads their own two hosts and none of another account''s');
select t_ok(public.t_err($q$update public.ai_source_stats set ok_count = 999 where host = 'shop.example.com'$q$) like '42501%'
        and public.t_err($q$insert into public.ai_source_stats (job, host) values ('shop_picture', 'forged.example.com')$q$) like '42501%'
        and public.t_err($q$delete from public.ai_source_stats where host = 'shop.example.com'$q$) like '42501%'
        and public.t_err($q$update public.ai_source_stats set user_id = '00000000-0000-0000-0000-000000000007' where host = 'shop.example.com'$q$) like '42501%',
  'M6 the app cannot forge a count, add, delete or hand a row to another account (42501)');
do $$
begin
  perform t_ok(public.t_err($q$update public.ai_source_stats set state = 'ignored' where host = 'shop.example.com'$q$) = 'done', 'M6 the owner clears a host');
  perform t_ok((select state = 'ignored' and state_changed_at is not null and ok_count = 0 and fail_count = 1 from public.ai_source_stats where host = 'shop.example.com'),
    'M6 Clear: the state becomes ignored, the day is stamped, the counts stay');
  perform t_ok(public.t_err($q$update public.ai_source_stats set state = 'on' where host = 'shop.example.com'$q$) = 'done', 'M6 Undo writes the state back');
  perform t_ok((select state = 'on' from public.ai_source_stats where host = 'shop.example.com'), 'M6 Undo of a clear puts it back on');
end $$;
select t_ok(public.t_err($q$update public.ai_source_stats set state = 'gone' where host = 'shop.example.com'$q$) like '23514%', 'M6 a state is on or ignored, nothing else');
reset role;

-- ═══ M8. A cleared host is not forgotten for good ═════════════════════════════
set role authenticated;
update public.ai_source_stats set state = 'ignored' where host = 'maker.example.net' and user_id = '00000000-0000-0000-0000-000000000001';
reset role;
set role service_role;
set test.uid = 'none';
select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'shop_picture', 'maker.example.net', false, 'blocked');
reset test.uid;
reset role;
select t_ok((select state = 'on' and ok_count = 0 and fail_count = 1 and last_ok_at is null and last_reason = 'blocked' and state_changed_at is not null
               from public.ai_source_stats where user_id = '00000000-0000-0000-0000-000000000001' and host = 'maker.example.net'),
  'M8 the next read of a cleared host puts it back on and restarts its counts from that read (the old two good reads no longer decide)');
set role service_role;
set test.uid = 'none';
select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'shop_picture', 'maker.example.net', true, 'ok');
reset test.uid;
reset role;
select t_ok((select ok_count = 1 and fail_count = 1 and last_ok_at is not null from public.ai_source_stats where user_id = '00000000-0000-0000-0000-000000000001' and host = 'maker.example.net'),
  'M8 an ordinary read of a host that is on adds to its counts as before');

-- ═══ M7. Another account cannot change this account's row; deleting an account takes its rows ═══
set role authenticated;
set test.uid = '00000000-0000-0000-0000-000000000007';
select t_ok(public.t_err($q$update public.ai_source_stats set state = 'ignored' where user_id = '00000000-0000-0000-0000-000000000001'$q$) = 'done'
        and (select count(*) = 0 from public.ai_source_stats where user_id = '00000000-0000-0000-0000-000000000001'),
  'M7 a second account sees none of the owner''s rows and changes none (row level security matches nothing)');
reset test.uid;
reset role;
delete from public.app_allowed_users where user_id = '00000000-0000-0000-0000-000000000007';
delete from auth.users where id = '00000000-0000-0000-0000-000000000007';
select t_ok(not exists (select 1 from public.ai_source_stats where user_id = '00000000-0000-0000-0000-000000000007'),
  'M7 deleting an account takes its picture memory (cascade)');
