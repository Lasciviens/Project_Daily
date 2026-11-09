-- Migration 187 (Shop's rules) on the real Shop chain (029–138, 144, 150, 151 — built by
-- scripts/verify-db-shop-rules.mjs) after 187 ran twice and bugs.sql ran. Setup and checks run as the
-- superuser; every app write runs as `authenticated` (the owner, unless test.uid names another account),
-- under row level security and the owner lock, like the app. Names are made up.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
-- Runs a write and its end-of-transaction checks: 'done', or the refusal's SQLSTATE and message (nothing
-- of a refused write is kept).
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  set constraints all immediate;
  return 'done';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function public.t_err(text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;
create or replace function public.t_tx(p_k text) returns bigint language sql stable as $$ select (v ->> 'tx')::bigint from public.t_keep where k = p_k $$;
grant execute on function public.t_tx(text) to authenticated;
insert into public.fx_rates_nok (day, currency, nok_per_unit, rate_day) values
  ('2026-10-02', 'EUR', 11.52, '2026-10-02'), ('2026-10-06', 'USD', 10.80, '2026-10-06')
on conflict do nothing;

-- ═══ S0. The migration ════════════════════════════════════════════════════════
select t_ok((select count(*) = 1 from pg_trigger where tgrelid = 'public.shop_items'::regclass and tgname = 'trg_shop_items_rules')
        and (select count(*) = 3 from pg_trigger where tgrelid = 'public.shop_items'::regclass and tgdeferrable and tginitdeferred
               and tgname in ('trg_shop_items_links_recheck', 'trg_shop_items_sale_group_left', 'trg_shop_items_sale_group_deleted')),
  'S0 after two runs: one rules trigger and three checks that run when the transaction ends');
select t_ok((select data_type = 'jsonb' from information_schema.columns where table_name = 'shop_items' and column_name = 'sale_undo')
        and (select column_default = 'auth.uid()' from information_schema.columns where table_name = 'shop_items' and column_name = 'user_id')
        and (select column_default = 'auth.uid()' from information_schema.columns where table_name = 'shop_categories' and column_name = 'user_id'),
  'S0 shop_items.sale_undo is jsonb; user_id takes auth.uid() by default on shop_items and shop_categories');
select t_ok((select pg_get_indexdef(indexrelid) like '%(user_id, checked_at)' from pg_index where indexrelid = 'public.idx_shop_price_points_user_checked'::regclass)
        and (select pg_get_indexdef(indexrelid) like '%(user_id, created_at DESC, id)' from pg_index where indexrelid = 'public.idx_shop_items_user_created'::regclass)
        and to_regclass('public.idx_shop_items_user') is null and to_regclass('public.idx_shop_items_user_list') is not null,
  'S0 the two indexes are there, 029''s duplicate (user_id) index is gone, 134''s (user_id, list, status) stays');
select t_ok((select count(*) = 2 from pg_constraint where conrelid = 'public.shop_items'::regclass and convalidated
               and conname in ('shop_items_url_web_check', 'shop_items_image_url_web_check')),
  'S0 both web-link checks exist and were validated (no row broke them)');
select t_ok((select bool_and(p.prosecdef = (p.proname in ('shop_restore_price_history', 'shop_items_links_recheck', 'shop_items_sale_group_whole'))
                     and p.proconfig = array['search_path=""'])
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
               'shop_web_link', 'shop_items_rules', 'shop_item_costs_rules', 'shop_link_problem', 'shop_money_reaches', 'shop_item_links_check',
               'shop_items_links_recheck', 'shop_items_sale_group_whole', 'shop_record_sale', 'shop_undo_sale', 'shop_named_columns',
               'shop_delete_items', 'shop_restore_price_history', 'shop_restore_items')),
  'S0 every function 187 writes has search_path ''''; only the price-history helper and the two end checks are SECURITY DEFINER');
select t_ok(has_function_privilege('authenticated', 'public.shop_restore_price_history(jsonb, jsonb)', 'execute')
        and not has_function_privilege('anon', 'public.shop_restore_price_history(jsonb, jsonb)', 'execute')
        and not has_function_privilege('service_role', 'public.shop_restore_price_history(jsonb, jsonb)', 'execute')
        and not has_function_privilege('anon', 'public.shop_restore_items(jsonb)', 'execute')
        and not has_function_privilege('authenticated', 'public.shop_items_sale_group_whole()', 'execute'),
  'S0 the definer helper is for signed-in callers only (not anon, not the service role); the trigger checks for nobody');
select t_ok((select pg_get_function_identity_arguments('public.shop_record_sale'::regproc) = 'p_rows jsonb, p_disposal text, p_on date, p_currency text, p_sold_to text, p_keep jsonb, p_to uuid, p_to_amount numeric')
        and (select prorettype = 'uuid'::regtype from pg_proc where oid = 'public.shop_record_sale'::regproc)
        and (select prorettype = 'integer'::regtype from pg_proc where oid = 'public.shop_undo_sale'::regproc)
        and (select prorettype = 'jsonb'::regtype from pg_proc where oid = 'public.shop_delete_items'::regproc)
        and (select prorettype = 'void'::regtype from pg_proc where oid = 'public.shop_restore_items'::regproc),
  'S0 the four RPCs keep their arguments and answers (the app and an open Undo toast call them as before)');

-- ═══ S1. Rates ═══════════════════════════════════════════════════════════════
set role authenticated;
do $$
declare v record;
begin
  insert into public.shop_items (id, title, price, currency, status) values ('c1000000-0000-0000-0000-000000000001', 'Headphones', 200, 'EUR', 'wishlist');
  update public.shop_items set status = 'bought', bought_at = '2026-10-01 12:00+02' where id = 'c1000000-0000-0000-0000-000000000001';
  select fx_nok, fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000001';
  perform t_ok(v.fx_nok = 11.50 and v.fx_source = 'norges_bank', 'S1 bought: Norges Bank''s rate of the purchase day');
  update public.shop_items set fx_nok = 11, fx_source = 'manual' where id = 'c1000000-0000-0000-0000-000000000001';
  select fx_nok, fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000001';
  perform t_ok(v.fx_nok = 11 and v.fx_source = 'manual', 'S1 a typed rate is kept as typed');
  update public.shop_items set fx_source = 'norges_bank' where id = 'c1000000-0000-0000-0000-000000000001';
  select fx_nok, fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000001';
  perform t_ok(v.fx_nok = 11 and v.fx_source = 'manual', 'S1 relabelling a typed rate "norges_bank" keeps it typed');
  update public.shop_items set fx_nok = 11.50, fx_source = 'norges_bank' where id = 'c1000000-0000-0000-0000-000000000001';
  select fx_nok, fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000001';
  perform t_ok(v.fx_nok = 11.50 and v.fx_source = 'norges_bank', 'S1 Norges Bank''s own rate of that day, sent as such, is Norges Bank''s (a save undone)');
  update public.shop_items set fx_nok = 11.50, fx_source = 'manual' where id = 'c1000000-0000-0000-0000-000000000001';
  select fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000001';
  perform t_ok(v.fx_source = 'manual', 'S1 the same number typed by hand stays typed');
  update public.shop_items set fx_nok = 10.9 where id = 'c1000000-0000-0000-0000-000000000001';
  select fx_nok, fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000001';
  perform t_ok(v.fx_nok = 10.9 and v.fx_source = 'manual', 'S1 a rate sent without a label is typed');
  update public.shop_items set fx_nok = null, fx_source = null where id = 'c1000000-0000-0000-0000-000000000001';
  select fx_nok, fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000001';
  perform t_ok(v.fx_nok = 11.50 and v.fx_source = 'norges_bank', 'S1 a typed rate cleared: Norges Bank''s rate at once (137 left it pending)');
  update public.shop_items set bought_at = '2026-10-02 12:00+02' where id = 'c1000000-0000-0000-0000-000000000001';
  select fx_nok into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000001';
  perform t_ok(v.fx_nok = 11.52, 'S1 another purchase day: that day''s rate');
  update public.shop_items set bought_at = '2026-10-03 12:00+02' where id = 'c1000000-0000-0000-0000-000000000001';
  select fx_nok, fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000001';
  perform t_ok(v.fx_nok is null and v.fx_source is null, 'S1 a day with no cached rate: pending, never another day''s');
  update public.shop_items set currency = 'NOK' where id = 'c1000000-0000-0000-0000-000000000001';
  select fx_nok, fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000001';
  perform t_ok(v.fx_nok = 1 and v.fx_source = 'fixed', 'S1 NOK: 1, fixed');
end $$;
reset role;
-- The nightly sweep caches the day's rate and touches the waiting rows as the service role.
insert into public.shop_items (id, user_id, title, price, currency, status, bought_at)
  values ('c1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Charger', 30, 'EUR', 'bought', '2026-10-04 12:00+02');
insert into public.fx_rates_nok (day, currency, nok_per_unit, rate_day) values ('2026-10-04', 'EUR', 11.53, '2026-10-02');
set test.uid = 'none';
set role service_role;
update public.shop_items set fx_nok = null where id = 'c1000000-0000-0000-0000-000000000002' and fx_nok is null;
reset role;
reset test.uid;
select t_ok((select fx_nok = 11.53 and fx_source = 'norges_bank' from public.shop_items where id = 'c1000000-0000-0000-0000-000000000002'),
  'S1 the sweep''s touch (fx_nok = null as the service role) fills a waiting rate');
set role authenticated;
do $$
declare v record; s jsonb;
begin
  -- money back and extra costs: the same rule
  perform public.shop_record_sale('[{"id": "c1000000-0000-0000-0000-000000000002", "sale_price": "20"}]', 'sold', '2026-10-05', 'EUR', null);
  select sale_fx_nok, sale_fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000002';
  perform t_ok(v.sale_fx_nok = 11.55 and v.sale_fx_source = 'norges_bank', 'S1 money back: Norges Bank''s rate of the day it left');
  update public.shop_items set sale_fx_nok = 12, sale_fx_source = 'manual' where id = 'c1000000-0000-0000-0000-000000000002';
  update public.shop_items set sale_fx_nok = 11.55, sale_fx_source = 'norges_bank' where id = 'c1000000-0000-0000-0000-000000000002';
  select sale_fx_nok, sale_fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000002';
  perform t_ok(v.sale_fx_nok = 11.55 and v.sale_fx_source = 'norges_bank', 'S1 money back: a typed rate, then Norges Bank''s own again');
  insert into public.shop_item_costs (id, item_id, label, amount, currency, spent_on) values
    ('c1000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-000000000002', 'Shipping', 5, 'USD', '2026-10-06');
  select fx_nok, fx_source into v from public.shop_item_costs where id = 'c1000000-0000-0000-0000-0000000000c1';
  perform t_ok(v.fx_nok = 10.80 and v.fx_source = 'norges_bank', 'S1 a cost: Norges Bank''s rate of its day');
  update public.shop_item_costs set fx_nok = 10, fx_source = 'manual' where id = 'c1000000-0000-0000-0000-0000000000c1';
  update public.shop_item_costs set fx_nok = null where id = 'c1000000-0000-0000-0000-0000000000c1';
  select fx_nok, fx_source into v from public.shop_item_costs where id = 'c1000000-0000-0000-0000-0000000000c1';
  perform t_ok(v.fx_nok = 10.80 and v.fx_source = 'norges_bank', 'S1 a cost''s typed rate cleared: Norges Bank''s again at once');
  update public.shop_item_costs set fx_nok = 9 where id = 'c1000000-0000-0000-0000-0000000000c1';
  -- Delete + Undo keeps each rate and its label: Norges Bank's (checked against the cache) and typed ones.
  update public.shop_items set fx_nok = 11.4, fx_source = 'manual' where id = 'c1000000-0000-0000-0000-000000000002';
  s := public.shop_delete_items(array['c1000000-0000-0000-0000-000000000002']::uuid[]);
  perform public.shop_restore_items(s);
  select fx_nok, fx_source, sale_fx_nok, sale_fx_source into v from public.shop_items where id = 'c1000000-0000-0000-0000-000000000002';
  perform t_ok(v.fx_nok = 11.4 and v.fx_source = 'manual' and v.sale_fx_nok = 11.55 and v.sale_fx_source = 'norges_bank',
    'S1 Undo of a delete: a typed purchase rate stays typed, Norges Bank''s sale rate stays Norges Bank''s');
  perform t_ok((select fx_nok = 9 and fx_source = 'manual' from public.shop_item_costs where id = 'c1000000-0000-0000-0000-0000000000c1'),
    'S1 …and the cost comes back with its typed rate');
end $$;

-- ═══ S2. The purchase day ════════════════════════════════════════════════════
do $$
declare v record;
begin
  insert into public.shop_items (id, title, price, status) values ('c2000000-0000-0000-0000-000000000001', 'Tent', 1500, 'bought');
  perform t_ok((select bought_at is not null from public.shop_items where id = 'c2000000-0000-0000-0000-000000000001'), 'S2 bought without a day: stamped now');
  update public.shop_items set bought_at = '2026-05-01 12:00+02' where id = 'c2000000-0000-0000-0000-000000000001';
  update public.shop_items set bought_at = null, notes = 'Two-person' where id = 'c2000000-0000-0000-0000-000000000001';
  select bought_at, notes into v from public.shop_items where id = 'c2000000-0000-0000-0000-000000000001';
  perform t_ok(v.bought_at = '2026-05-01 12:00+02' and v.notes = 'Two-person', 'S2 a day typed later is kept; clearing it keeps it and the rest of the write goes through');
  update public.shop_items set status = 'wishlist' where id = 'c2000000-0000-0000-0000-000000000001';
  perform t_ok((select bought_at is null from public.shop_items where id = 'c2000000-0000-0000-0000-000000000001'), 'S2 not bought any more (never sold, no links): no day');
end $$;

-- ═══ S3. General wishes, models and kinds ═══════════════════════════════════
do $$
declare e text;
begin
  insert into public.shop_items (id, title, kind, status) values ('c3000000-0000-0000-0000-00000000000a', 'Any tablet', 'general', 'wishlist');
  insert into public.shop_items (id, title, price, status, option_for) values
    ('c3000000-0000-0000-0000-00000000000b', 'Tablet A', 4000, 'wishlist', 'c3000000-0000-0000-0000-00000000000a'),
    ('c3000000-0000-0000-0000-00000000000c', 'Tablet B', 5000, 'wishlist', 'c3000000-0000-0000-0000-00000000000a');
  update public.shop_items set status = 'bought' where id = 'c3000000-0000-0000-0000-00000000000b';
  perform t_ok((select status = 'fulfilled' from public.shop_items where id = 'c3000000-0000-0000-0000-00000000000a'), 'S3 buying a model fulfils its wish');
  e := t_err($q$update public.shop_items set kind = 'item' where id = 'c3000000-0000-0000-0000-00000000000a'$q$);
  perform t_ok(e like '23514 A general wish with models stays a general wish%', 'S3 a fulfilled wish with models stays general (' || e || ')');
  update public.shop_items set disposal = 'returned' where id = 'c3000000-0000-0000-0000-00000000000b';
  perform t_ok((select status = 'wishlist' from public.shop_items where id = 'c3000000-0000-0000-0000-00000000000a'), 'S3 a returned model reopens its wish');
  insert into public.shop_items (id, title, kind, status) values ('c3000000-0000-0000-0000-00000000000d', 'Any watch', 'general', 'wishlist');
  e := t_err($q$update public.shop_items set kind = 'item' where id = 'c3000000-0000-0000-0000-00000000000d'$q$);
  perform t_ok(e = 'done', 'S3 a general wish without models can become an item (' || e || ')');
  insert into public.shop_items (id, title, price, status, bought_at) values ('c3000000-0000-0000-0000-00000000000e', 'Bike', 6000, 'bought', '2026-04-01 12:00+02');
  insert into public.shop_items (id, title, price, status, accessory_of) values ('c3000000-0000-0000-0000-00000000000f', 'Bike lock', 300, 'wishlist', 'c3000000-0000-0000-0000-00000000000e');
  insert into public.shop_items (id, title, status) values ('c3000000-0000-0000-0000-000000000010', 'Kayak', 'wishlist');
  insert into public.shop_items (id, title, status, accessory_of) values ('c3000000-0000-0000-0000-000000000011', 'Paddle', 'wishlist', 'c3000000-0000-0000-0000-000000000010');
  e := t_err($q$update public.shop_items set kind = 'general' where id = 'c3000000-0000-0000-0000-000000000010'$q$);
  perform t_ok(e like '23514 A thing with accessories stays a thing%', 'S3 a thing with accessories stays an item (' || e || ')');
end $$;

-- ═══ S4. Money links ═════════════════════════════════════════════════════════
do $$
declare e text;
begin
  insert into public.shop_items (id, title, price, status, bought_at) values
    ('c4000000-0000-0000-0000-00000000000a', 'Phone 1', 3000, 'bought', '2026-01-01 12:00+01'),
    ('c4000000-0000-0000-0000-00000000000b', 'Phone 2', 4000, 'bought', '2026-02-01 12:00+01'),
    ('c4000000-0000-0000-0000-00000000000c', 'Phone 3', 5000, 'bought', '2026-03-01 12:00+01');
  insert into public.shop_items (id, title, price, status, accessory_of) values
    ('c4000000-0000-0000-0000-0000000000ac', 'Phone 1 case', 100, 'bought', 'c4000000-0000-0000-0000-00000000000a');
  insert into public.shop_items (id, title, list, status) values ('c4000000-0000-0000-0000-0000000000e1', 'Milk', 'quick', 'bought');
  insert into public.shop_items (id, title, status) values ('c4000000-0000-0000-0000-0000000000d9', 'Phone 4', 'wishlist');
  insert into public.shop_item_links (from_id, to_id) values ('c4000000-0000-0000-0000-00000000000a', 'c4000000-0000-0000-0000-00000000000b');
  insert into public.shop_item_links (from_id, to_id) values ('c4000000-0000-0000-0000-00000000000b', 'c4000000-0000-0000-0000-00000000000c');
  e := t_err($q$insert into public.shop_item_links (from_id, to_id) values ('c4000000-0000-0000-0000-00000000000c', 'c4000000-0000-0000-0000-00000000000a')$q$);
  perform t_ok(e = '23514 That link would make a loop', 'S4 a loop of three is refused (' || e || ')');
  e := t_err($q$insert into public.shop_item_links (from_id, to_id) values ('c4000000-0000-0000-0000-0000000000ac', 'c4000000-0000-0000-0000-0000000000d9')$q$);
  perform t_ok(e like '23514 A money link goes from one of your things%', 'S4 a link from an accessory is refused');
  e := t_err($q$insert into public.shop_item_links (from_id, to_id) values ('c4000000-0000-0000-0000-0000000000e1', 'c4000000-0000-0000-0000-0000000000d9')$q$);
  perform t_ok(e like '23514 A money link goes from one of your things%', 'S4 a link from an errand is refused');
  e := t_err($q$insert into public.shop_item_links (from_id, to_id) values ('c4000000-0000-0000-0000-0000000000d9', 'c4000000-0000-0000-0000-00000000000a')$q$);
  perform t_ok(e like '23514 A money link goes from one of your things%', 'S4 a link from a thing not bought yet is refused');
  e := t_err($q$insert into public.shop_item_links (from_id, to_id) values ('c4000000-0000-0000-0000-00000000000c', 'c4000000-0000-0000-0000-0000000000ac')$q$);
  perform t_ok(e like '23514 A money link goes from one of your things%', 'S4 a link to an accessory is refused');
  -- re-checked when the receiving thing changes
  e := t_err($q$update public.shop_items set accessory_of = 'c4000000-0000-0000-0000-00000000000a' where id = 'c4000000-0000-0000-0000-00000000000c'$q$);
  perform t_ok(e like '23514 "Phone 3" is in a money chain%', 'S4 a thing paid for with another''s money can''t become an accessory (' || e || ')');
  e := t_err($q$update public.shop_items set list = 'quick', status = 'wishlist' where id = 'c4000000-0000-0000-0000-00000000000c'$q$);
  perform t_ok(e like '23514 "Phone 3" is in a money chain%', 'S4 …nor move to the quick list');
  e := t_err($q$update public.shop_items set notes = 'Blue', disposal = 'returned' where id = 'c4000000-0000-0000-0000-00000000000a'$q$);
  perform t_ok(e = 'done', 'S4 a linked thing returned for its money back keeps its link; other edits are untouched (' || e || ')');
end $$;
-- A loop that a model's move makes: Kobo → Tablet T, Tablet T → "Any e-reader" (open), then the bought
-- Kobo becomes a model of that wish: the wish is fulfilled, so the money would go round.
do $$
declare e text;
begin
  insert into public.shop_items (id, title, kind, status) values
    ('c4100000-0000-0000-0000-0000000000a1', 'Any reader', 'general', 'wishlist'),
    ('c4100000-0000-0000-0000-0000000000a2', 'Any e-reader', 'general', 'wishlist');
  insert into public.shop_items (id, title, price, status, bought_at, option_for) values
    ('c4100000-0000-0000-0000-0000000000b1', 'Kobo', 2000, 'bought', '2026-02-01 12:00+01', 'c4100000-0000-0000-0000-0000000000a1');
  insert into public.shop_items (id, title, price, status, bought_at) values
    ('c4100000-0000-0000-0000-0000000000c1', 'Tablet T', 4000, 'bought', '2026-01-01 12:00+01');
  insert into public.shop_item_links (from_id, to_id) values ('c4100000-0000-0000-0000-0000000000b1', 'c4100000-0000-0000-0000-0000000000c1');
  insert into public.shop_item_links (from_id, to_id) values ('c4100000-0000-0000-0000-0000000000c1', 'c4100000-0000-0000-0000-0000000000a2');
  e := t_err($q$update public.shop_items set option_for = 'c4100000-0000-0000-0000-0000000000a2' where id = 'c4100000-0000-0000-0000-0000000000b1'$q$);
  perform t_ok(e like '23514 %loop%', 'S4 a bought model moved under a wish its own money pays for is refused (' || e || ')');
  perform t_ok((select option_for = 'c4100000-0000-0000-0000-0000000000a1' from public.shop_items where id = 'c4100000-0000-0000-0000-0000000000b1')
               and (select status = 'wishlist' from public.shop_items where id = 'c4100000-0000-0000-0000-0000000000a2'),
    'S4 …and nothing of it is kept');
end $$;
-- 144's delete with Undo of a link still works under the new triggers.
do $$
declare s jsonb; n jsonb;
begin
  s := public.app_delete_rows('shop_item_links', array[(select id::text from public.shop_item_links where from_id = 'c4000000-0000-0000-0000-00000000000b')]);
  n := public.app_restore_rows(s);
  perform t_ok((n ->> 'restored')::int = 1 and exists (select 1 from public.shop_item_links where from_id = 'c4000000-0000-0000-0000-00000000000b'),
    'S4 a money link deleted with Undo (144) comes back');
end $$;

-- ═══ S5. Selling and its Undo ════════════════════════════════════════════════
do $$
declare v record; e text;
begin
  insert into public.shop_items (id, title, price, status, bought_at) values
    ('c5000000-0000-0000-0000-00000000000a', 'Console', 5000, 'bought', '2026-01-01 12:00+01'),
    ('c5000000-0000-0000-0000-00000000000b', 'Pad 1', 600, 'bought', '2026-01-01 12:00+01'),
    ('c5000000-0000-0000-0000-00000000000c', 'Pad 2', 600, 'bought', '2026-01-01 12:00+01'),
    ('c5000000-0000-0000-0000-00000000000d', 'Headset', 900, 'bought', '2026-01-01 12:00+01'),
    ('c5000000-0000-0000-0000-00000000000e', 'Cable', 100, 'bought', '2026-01-01 12:00+01'),
    ('c5000000-0000-0000-0000-00000000000f', 'TV', 9000, 'bought', '2026-01-01 12:00+01');
  update public.shop_items set accessory_of = 'c5000000-0000-0000-0000-00000000000a'
   where id in ('c5000000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-00000000000c', 'c5000000-0000-0000-0000-00000000000d', 'c5000000-0000-0000-0000-00000000000e');
  insert into public.shop_items (id, title, price, status) values ('c5000000-0000-0000-0000-000000000010', 'New console', 7000, 'wishlist');
  e := t_err($q$select public.shop_record_sale('[{"id": "c5000000-0000-0000-0000-00000000000a", "sale_price": "4000"}]', 'sold', '2026-10-01', 'NOK', null,
    '[{"id": "c5000000-0000-0000-0000-00000000000f", "move_to": null}]')$q$);
  perform t_ok(e like 'P0001 Not one of its accessories%', 'S5 a kept row must be an accessory of the thing sold (' || e || ')');
  -- console + two pads sold; the headset kept and moved onto the TV, the cable kept on its own; the money to a new console
  perform public.shop_record_sale(
    '[{"id": "c5000000-0000-0000-0000-00000000000a", "sale_price": "4000"}, {"id": "c5000000-0000-0000-0000-00000000000b", "sale_price": "200"}, {"id": "c5000000-0000-0000-0000-00000000000c", "sale_price": "200"}]',
    'sold', '2026-10-01', 'NOK', 'Ola Nordmann',
    '[{"id": "c5000000-0000-0000-0000-00000000000d", "move_to": "c5000000-0000-0000-0000-00000000000f"}, {"id": "c5000000-0000-0000-0000-00000000000e", "move_to": null}]',
    'c5000000-0000-0000-0000-000000000010', null);
  select sale_undo into v from public.shop_items where id = 'c5000000-0000-0000-0000-00000000000a';
  perform t_ok(jsonb_array_length(v.sale_undo -> 'kept') = 2 and (v.sale_undo -> 'link' ->> 'made')::boolean
               and (select count(*) = 3 from public.shop_items where sale_group is not null and sale_group = (select sale_group from public.shop_items where id = 'c5000000-0000-0000-0000-00000000000a')),
    'S5 the sale: three rows in one sale group; what its Undo needs is on the console (two kept, a link made)');
  e := t_err($q$update public.shop_items set disposal = null where id = 'c5000000-0000-0000-0000-00000000000b'$q$);
  perform t_ok(e like '23514 Things sold together are taken back together%', 'S5 one pad''s sale alone can''t be undone (' || e || ')');
  e := t_err($q$delete from public.shop_items where id = 'c5000000-0000-0000-0000-00000000000c'$q$);
  perform t_ok(e like '23514 "Pad 2" was sold together with other things%', 'S5 one pad sold with the console can''t be deleted alone (' || e || ')');
  e := t_err($q$update public.shop_items set status = 'dropped' where id = 'c5000000-0000-0000-0000-00000000000a'$q$);
  perform t_ok(e like '23514 Undo the sale first%', 'S5 a sold thing never leaves "bought" (dropped) (' || e || ')');
  -- Undo from a pad's record: the whole sale, the headset back from the TV, the cable back, the link it made gone
  perform t_ok(public.shop_undo_sale('c5000000-0000-0000-0000-00000000000c') = 3, 'S5 Undo from a pad''s own record takes the whole sale back (3 rows)');
  perform t_ok((select count(*) = 4 from public.shop_items where accessory_of = 'c5000000-0000-0000-0000-00000000000a'
                                                         and id in ('c5000000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-00000000000c', 'c5000000-0000-0000-0000-00000000000d', 'c5000000-0000-0000-0000-00000000000e')),
    'S5 …all four accessories are on the console again');
  perform t_ok(not exists (select 1 from public.shop_item_links where from_id = 'c5000000-0000-0000-0000-00000000000a')
               and (select sale_undo is null and sale_group is null from public.shop_items where id = 'c5000000-0000-0000-0000-00000000000a'),
    'S5 …the money link the sale made is gone, and so is its Undo note');
end $$;
do $$
declare e text;
begin
  -- a later change wins over Undo: the headset moved again, the link's amount edited
  insert into public.shop_item_links (from_id, to_id, amount) values ('c5000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000010', 1000);
  perform public.shop_record_sale('[{"id": "c5000000-0000-0000-0000-00000000000a", "sale_price": "4000"}]', 'sold', '2026-10-01', 'NOK', null,
    '[{"id": "c5000000-0000-0000-0000-00000000000d", "move_to": "c5000000-0000-0000-0000-00000000000f"}]', 'c5000000-0000-0000-0000-000000000010', 2500);
  perform t_ok((select amount = 2500 from public.shop_item_links where from_id = 'c5000000-0000-0000-0000-00000000000a'), 'S5 a sale over an existing link sets its amount');
  update public.shop_items set accessory_of = null where id = 'c5000000-0000-0000-0000-00000000000d';
  update public.shop_item_links set amount = 3000 where from_id = 'c5000000-0000-0000-0000-00000000000a';
  perform public.shop_undo_sale('c5000000-0000-0000-0000-00000000000a');
  perform t_ok((select accessory_of is null from public.shop_items where id = 'c5000000-0000-0000-0000-00000000000d')
               and (select amount = 3000 from public.shop_item_links where from_id = 'c5000000-0000-0000-0000-00000000000a'),
    'S5 Undo leaves what was changed after the sale (the headset''s new place, the amount typed since)');
  -- the assistant's way: one update for the whole group by its sale_group
  perform public.shop_record_sale('[{"id": "c5000000-0000-0000-0000-00000000000a", "sale_price": "4000"}, {"id": "c5000000-0000-0000-0000-00000000000b", "sale_price": "100"}]',
    'sold', '2026-10-02', 'NOK', null);
  e := t_err(format('update public.shop_items set disposal = null where sale_group = %L',
                    (select sale_group from public.shop_items where id = 'c5000000-0000-0000-0000-00000000000a')));
  perform t_ok(e = 'done' and (select count(*) = 0 from public.shop_items where id in ('c5000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-00000000000b') and disposal is not null),
    'S5 a whole sale group taken back in one write is fine (' || e || ')');
  -- delete with Undo of a sold thing and the accessories sold with it
  perform public.shop_record_sale('[{"id": "c5000000-0000-0000-0000-00000000000a", "sale_price": "4000"}, {"id": "c5000000-0000-0000-0000-00000000000b", "sale_price": "100"}]',
    'sold', '2026-10-03', 'NOK', null);
  insert into public.t_keep values ('sold_console', public.shop_delete_items(array['c5000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-00000000000c']::uuid[]));
  perform t_ok(not exists (select 1 from public.shop_items where id = 'c5000000-0000-0000-0000-00000000000a'), 'S5 a sold thing deleted with the things sold with it');
  perform public.shop_restore_items((select v from public.t_keep where k = 'sold_console'));
  perform t_ok((select count(*) = 2 from public.shop_items where sale_group is not null and disposal = 'sold' and id in ('c5000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-00000000000b')),
    'S5 …and back with its sale group whole');
end $$;

-- ═══ S6. Delete with Undo ════════════════════════════════════════════════════
reset role;
insert into public.shop_items (id, user_id, title, price, status, bought_at, url) values
  ('c6000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Camera', 8000, 'bought', '2026-02-01 12:00+01', 'https://www.prisjakt.no/product.php?p=9'),
  ('c6000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'Lens', 3000, 'bought', '2026-02-01 12:00+01', null);
insert into public.shop_price_watch (item_id, user_id, url, status, low, source, image)
  values ('c6000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://www.prisjakt.no/product.php?p=9', 'ok', 7490, 'prisjakt', 'https://img.example.com/c.jpg');
insert into public.shop_price_points (user_id, item_id, checked_at, low)
  select '00000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-00000000000a', now() - g * interval '1 day', 7000 + g from generate_series(1, 30) g;
-- the stranger's (account 2) item, for the helper's checks
insert into public.shop_items (id, user_id, title, status) values ('c6000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000002', 'Their thing', 'wishlist');
set role authenticated;
do $$
declare s jsonb;
begin
  update public.shop_items set accessory_of = 'c6000000-0000-0000-0000-00000000000a' where id = 'c6000000-0000-0000-0000-00000000000b';
  insert into public.shop_items (id, title, status) values ('c6000000-0000-0000-0000-00000000000c', 'Better camera', 'wishlist');
  insert into public.shop_item_links (from_id, to_id, amount) values ('c6000000-0000-0000-0000-00000000000a', 'c6000000-0000-0000-0000-00000000000c', 500);
  insert into public.shop_item_costs (item_id, label, amount, spent_on) values ('c6000000-0000-0000-0000-00000000000a', 'Strap', 250, '2026-03-01');
  s := public.shop_delete_items(array['c6000000-0000-0000-0000-00000000000a', 'c6000000-0000-0000-0000-00000000000b']::uuid[]);
  perform t_ok((s ->> 'v') = '2' and jsonb_array_length(s -> 'items') = 2 and jsonb_array_length(s -> 'watches') = 1 and jsonb_array_length(s -> 'points') = 30
               and jsonb_array_length(s -> 'links') = 1 and jsonb_array_length(s -> 'costs') = 1 and s -> 'more' = '[]' and s -> 'hidden' = '[]',
    'S6 the snapshot holds the rows, the link, the cost, the watch and 30 points');
  perform t_ok(not exists (select 1 from public.shop_price_watch where item_id = 'c6000000-0000-0000-0000-00000000000a'), 'S6 …and the delete took the watch');
  perform public.shop_restore_items(s);
  perform t_ok((select count(*) = 2 from public.shop_items where id in ('c6000000-0000-0000-0000-00000000000a', 'c6000000-0000-0000-0000-00000000000b'))
               and (select accessory_of = 'c6000000-0000-0000-0000-00000000000a' from public.shop_items where id = 'c6000000-0000-0000-0000-00000000000b')
               and (select amount = 500 from public.shop_item_links where from_id = 'c6000000-0000-0000-0000-00000000000a')
               and (select count(*) = 1 from public.shop_item_costs where item_id = 'c6000000-0000-0000-0000-00000000000a')
               and (select low = 7490 and image = 'https://img.example.com/c.jpg' from public.shop_price_watch where item_id = 'c6000000-0000-0000-0000-00000000000a')
               and (select count(*) = 30 from public.shop_price_points where item_id = 'c6000000-0000-0000-0000-00000000000a' and user_id = auth.uid()),
    'S6 Undo: the camera, its lens on it, the link, the cost, the watch and its history');
  -- a snapshot from before 187 (no watches, points or more) still goes back
  s := public.shop_delete_items(array['c6000000-0000-0000-0000-00000000000b']::uuid[]);
  perform public.shop_restore_items(s - 'watches' - 'points' - 'more' - 'hidden' - 'v');
  perform t_ok((select accessory_of = 'c6000000-0000-0000-0000-00000000000a' from public.shop_items where id = 'c6000000-0000-0000-0000-00000000000b'),
    'S6 a snapshot from before 187 is put back as far as it goes');
  -- a parent deleted since: the row comes back on its own instead of not at all
  s := public.shop_delete_items(array['c6000000-0000-0000-0000-00000000000b']::uuid[]);
  insert into public.t_keep values ('lens', s);
end $$;
do $$
declare n int; e text;
begin
  -- the helper: own items only, the caller's account on each row, web links only, no future, a newer watch kept
  n := public.shop_restore_price_history(jsonb_build_array(
         jsonb_build_object('item_id', 'c6000000-0000-0000-0000-00000000000a', 'status', 'ok', 'low', 1),
         jsonb_build_object('item_id', 'c6000000-0000-0000-0000-0000000000f2', 'status', 'ok', 'low', 1)),
       jsonb_build_array(
         jsonb_build_object('item_id', 'c6000000-0000-0000-0000-0000000000f2', 'checked_at', now(), 'low', 1),
         jsonb_build_object('item_id', 'c6000000-0000-0000-0000-00000000000a', 'checked_at', now() + interval '3 days', 'low', 2,
                            'user_id', '00000000-0000-0000-0000-000000000002', 'source', 'evil', 'currency', 'nok<script>')));
  perform t_ok(n = 1 and (select low = 7490 from public.shop_price_watch where item_id = 'c6000000-0000-0000-0000-00000000000a'),
    'S6 helper: the camera''s watch written since is kept; the stranger''s item gets nothing (1 point added)');
  perform t_ok((select user_id = auth.uid() and checked_at <= now() and source is null and currency is null
                from public.shop_price_points where item_id = 'c6000000-0000-0000-0000-00000000000a' and low = 2),
    'S6 helper: the point is the caller''s own, never in the future, with no unknown source or odd currency');
  delete from public.shop_price_watch where item_id = 'c6000000-0000-0000-0000-00000000000a';
  perform public.shop_restore_price_history(jsonb_build_array(jsonb_build_object('item_id', 'c6000000-0000-0000-0000-00000000000a', 'status', 'ok',
    'low', 1, 'image', 'javascript:alert(1)', 'url', 'data:text/html,x', 'name', repeat('n', 400))), '[]');
  perform t_ok((select image is null and url is null and char_length(name) = 300 from public.shop_price_watch where item_id = 'c6000000-0000-0000-0000-00000000000a'),
    'S6 helper: a picture or link that is no web address is not kept; a long name is cut');
  e := t_err($q$select public.shop_restore_price_history('{}', '[]')$q$);
  perform t_ok(e like '22023 %', 'S6 helper: not a list, refused (' || e || ')');
end $$;
reset role;
set test.uid = '00000000-0000-0000-0000-000000000003';
set role authenticated;
select t_ok(t_err($q$select public.shop_restore_price_history('[]', '[]')$q$) like '42501 %', 'S6 helper: an account outside the owner lock is refused');
reset role;
reset test.uid;
set role anon;
select t_ok(t_err($q$select public.shop_restore_price_history('[]', '[]')$q$) like '42501 %', 'S6 helper: anon may not run it');
reset role;
-- the lens's camera is deleted for good; its Undo then brings the lens back on its own
set role authenticated;
do $$
begin
  perform public.shop_delete_items(array['c6000000-0000-0000-0000-00000000000a']::uuid[]);
  perform public.shop_restore_items((select v from public.t_keep where k = 'lens'));
  perform t_ok((select accessory_of is null from public.shop_items where id = 'c6000000-0000-0000-0000-00000000000b'),
    'S6 a row whose parent was deleted since comes back on its own');
end $$;
reset role;
-- A table added later that points at shop_items: its rows go with a delete and come back with Undo.
create table public.t_shop_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references public.shop_items(id) on delete cascade,
  note text
);
create table public.t_shop_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid references public.shop_items(id) on delete set null,
  note text
);
create table public.t_shop_secret (id uuid primary key default gen_random_uuid(), item_id uuid references public.shop_items(id) on delete cascade);
alter table public.t_shop_receipts enable row level security;
alter table public.t_shop_notes enable row level security;
create policy own on public.t_shop_receipts for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own on public.t_shop_notes for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.t_shop_receipts, public.t_shop_notes to authenticated;
revoke all on public.t_shop_secret from authenticated;
set role authenticated;
do $$
declare s jsonb;
begin
  insert into public.shop_items (id, title, price, status, bought_at) values ('c6100000-0000-0000-0000-00000000000a', 'Fridge', 9000, 'bought', '2026-04-01 12:00+02');
  insert into public.t_shop_receipts (item_id, note) values ('c6100000-0000-0000-0000-00000000000a', 'Receipt');
  insert into public.t_shop_notes (item_id, note) values ('c6100000-0000-0000-0000-00000000000a', 'Note');
  s := public.shop_delete_items(array['c6100000-0000-0000-0000-00000000000a']::uuid[]);
  perform t_ok(jsonb_array_length(s -> 'more') = 2 and s -> 'hidden' = '["t_shop_secret"]'
               and (select bool_and(x ->> 'action' = case x ->> 'table' when 't_shop_receipts' then 'deleted' else 'emptied' end) from jsonb_array_elements(s -> 'more') x),
    'S6 a later table''s rows are in the snapshot (deleted / emptied), one the caller can''t read is named');
  perform public.shop_restore_items(s);
  perform t_ok((select count(*) = 1 from public.t_shop_receipts where item_id = 'c6100000-0000-0000-0000-00000000000a')
               and (select count(*) = 1 from public.t_shop_notes where item_id = 'c6100000-0000-0000-0000-00000000000a'),
    'S6 …and Undo puts them back: the receipt again, the note pointing at it again');
  perform public.shop_restore_items(jsonb_build_object('items', '[]'::jsonb, 'more', jsonb_build_array(jsonb_build_object('table', 'tasks', 'col', 'id',
    'action', 'deleted', 'rows', jsonb_build_array(jsonb_build_object('title', 'Smuggled'))))));
  perform t_ok(not exists (select 1 from public.tasks where title = 'Smuggled'), 'S6 a snapshot naming a table that doesn''t point at shop_items writes nothing there');
end $$;
reset role;
drop table public.t_shop_receipts, public.t_shop_notes, public.t_shop_secret;
-- Why Shop keeps its own restore: 144's generic app_restore_rows puts a group back in one statement in
-- the order it read the rows, and a case read before its phone can't find it (the rules refuse it).
-- app_delete_rows reads in no set order (the plan and where the rows sit decide; a run once got the
-- phone first), so the snapshot is put in key order here, as an index scan reads it: the case's id is
-- lower, so it comes first.
set role authenticated;
do $$
declare s jsonb; e text;
begin
  insert into public.shop_items (id, title, price, status, bought_at) values ('c6200000-0000-0000-0000-00000000000a', 'Old case', 100, 'bought', '2026-01-01 12:00+01');
  insert into public.shop_items (id, title, price, status, bought_at) values ('c6200000-0000-0000-0000-00000000000b', 'New phone', 9000, 'bought', '2026-03-01 12:00+01');
  update public.shop_items set accessory_of = 'c6200000-0000-0000-0000-00000000000b' where id = 'c6200000-0000-0000-0000-00000000000a';
  update public.shop_items set notes = 'Black' where id = 'c6200000-0000-0000-0000-00000000000b';
  s := public.app_delete_rows('shop_items', array['c6200000-0000-0000-0000-00000000000b', 'c6200000-0000-0000-0000-00000000000a']);
  s := jsonb_set(s, '{groups,0,rows}', (select jsonb_agg(r order by r ->> 'id') from jsonb_array_elements(s -> 'groups' -> 0 -> 'rows') r));
  perform t_ok(s -> 'groups' -> 0 ->> 'table' = 'shop_items' and s -> 'groups' -> 0 -> 'rows' -> 0 ->> 'title' = 'Old case',
    'S6 (144''s snapshot in key order: the case first)');
  e := t_err(format('select public.app_restore_rows(%L::jsonb)', s));
  perform t_ok(e like '23514 An accessory belongs to an item%', 'S6 144''s generic restore can''t put a phone and its older case back (' || e || ')');
  perform public.shop_restore_items(jsonb_build_object('items', (select jsonb_agg(r) from jsonb_array_elements(s -> 'groups' -> 0 -> 'rows') r)));
  perform t_ok((select accessory_of = 'c6200000-0000-0000-0000-00000000000b' from public.shop_items where id = 'c6200000-0000-0000-0000-00000000000a'),
    'S6 Shop''s own restore puts the same rows back');
end $$;

-- ═══ S7. The chain builder's save (draftRows → shop_restore_items) ══════════
do $$
declare d jsonb; e text;
begin
  -- RP5 bought in EUR, sold with its grip (one sale group, money split), its money to the RP6 (bought in NOK),
  -- the RP6 still mine with a "Could sell for"; a typed sale rate.
  d := jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('id', 'c7000000-0000-0000-0000-00000000000a', 'user_id', auth.uid(), 'title', 'RP5', 'price', 150, 'currency', 'EUR', 'status', 'bought',
      'bought_at', '2026-03-02T11:00:00Z', 'disposal', 'sold', 'disposed_on', '2026-10-05', 'sale_price', 120, 'sale_currency', 'EUR', 'sale_fx_nok', 11.2,
      'sale_fx_source', 'manual', 'sale_group', 'c7000000-0000-0000-0000-0000000000f1', 'list', 'wishlist', 'kind', 'item', 'url', 'www.example.com/rp5',
      'created_at', '2026-11-09T10:00:00Z', 'updated_at', '2026-11-09T10:00:00Z'),
    jsonb_build_object('id', 'c7000000-0000-0000-0000-00000000000b', 'user_id', auth.uid(), 'title', 'RP5 grip', 'price', 20, 'currency', 'EUR', 'status', 'bought',
      'bought_at', '2026-03-02T11:00:00Z', 'disposal', 'sold', 'disposed_on', '2026-10-05', 'sale_price', 15, 'sale_currency', 'EUR', 'sale_fx_nok', 11.2,
      'sale_fx_source', 'manual', 'sale_group', 'c7000000-0000-0000-0000-0000000000f1', 'accessory_of', 'c7000000-0000-0000-0000-00000000000a',
      'created_at', '2026-11-09T10:00:01Z', 'updated_at', '2026-11-09T10:00:01Z'),
    jsonb_build_object('id', 'c7000000-0000-0000-0000-00000000000c', 'user_id', auth.uid(), 'title', 'RP6', 'price', 2500, 'currency', 'NOK', 'status', 'bought',
      'bought_at', '2026-10-06T10:00:00Z', 'value_now', 2000, 'value_currency', 'NOK', 'value_on', '2026-11-09', 'notes', 'from the chain builder',
      'url', 'our club''s page', 'created_at', '2026-11-09T10:00:02Z', 'updated_at', '2026-11-09T10:00:02Z')),
    'links', jsonb_build_array(jsonb_build_object('id', 'c7000000-0000-0000-0000-0000000000d1', 'user_id', auth.uid(),
      'from_id', 'c7000000-0000-0000-0000-00000000000a', 'to_id', 'c7000000-0000-0000-0000-00000000000c', 'amount', null)),
    'costs', '[]'::jsonb, 'children', '[]'::jsonb);
  perform public.shop_restore_items(d);
  perform t_ok((select fx_nok = 11.60 and fx_source = 'norges_bank' and sale_fx_nok = 11.2 and sale_fx_source = 'manual'
                from public.shop_items where id = 'c7000000-0000-0000-0000-00000000000a'),
    'S7 the chain saves: its purchase at Norges Bank''s rate of the day, its typed sale rate typed');
  perform t_ok((select accessory_of = 'c7000000-0000-0000-0000-00000000000a' and sale_group = 'c7000000-0000-0000-0000-0000000000f1'
                from public.shop_items where id = 'c7000000-0000-0000-0000-00000000000b')
               and exists (select 1 from public.shop_item_links where id = 'c7000000-0000-0000-0000-0000000000d1'),
    'S7 …the grip on the RP5 in their sale group, the money link to the RP6');
  perform t_ok((select url = 'https://www.example.com/rp5' from public.shop_items where id = 'c7000000-0000-0000-0000-00000000000a')
               and (select url is null and notes = E'from the chain builder\nLink: our club''s page' from public.shop_items where id = 'c7000000-0000-0000-0000-00000000000c')
               and (select kept and not errand and priority = 'medium' from public.shop_items where id = 'c7000000-0000-0000-0000-00000000000c'),
    'S7 a link without its scheme gets https://, one that is no web address goes into the notes; missing keys take their defaults');
  -- a draft whose link would make a loop: nothing of it is saved
  d := jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('id', 'c7000000-0000-0000-0000-00000000001a', 'title', 'Step A', 'price', 100, 'status', 'bought', 'bought_at', '2026-01-01T12:00:00Z'),
    jsonb_build_object('id', 'c7000000-0000-0000-0000-00000000001b', 'title', 'Step B', 'price', 100, 'status', 'bought', 'bought_at', '2026-02-01T12:00:00Z')),
    'links', jsonb_build_array(
      jsonb_build_object('from_id', 'c7000000-0000-0000-0000-00000000001a', 'to_id', 'c7000000-0000-0000-0000-00000000001b'),
      jsonb_build_object('from_id', 'c7000000-0000-0000-0000-00000000001b', 'to_id', 'c7000000-0000-0000-0000-00000000001a')));
  e := t_err(format('select public.shop_restore_items(%L::jsonb)', d));
  perform t_ok(e = '23514 That link would make a loop' and not exists (select 1 from public.shop_items where id in ('c7000000-0000-0000-0000-00000000001a', 'c7000000-0000-0000-0000-00000000001b')),
    'S7 a chain with a refused link leaves nothing behind (' || e || ')');
  e := t_err(format('select public.shop_restore_items(%L::jsonb)', jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('id', 'c7000000-0000-0000-0000-00000000002a', 'user_id', '00000000-0000-0000-0000-000000000002', 'title', 'Not mine')))));
  perform t_ok(e like '42501 %', 'S7 a row for another account is refused (row level security)');
end $$;

-- ═══ S8. Links are web addresses ═════════════════════════════════════════════
do $$
declare e text;
begin
  insert into public.shop_items (id, title, url, image_url) values
    ('c8000000-0000-0000-0000-00000000000a', 'Lamp', '  www.elkjop.no/lampe?x=1 ', '//cdn.example.com/lampe.jpg');
  perform t_ok((select url = 'https://www.elkjop.no/lampe?x=1' and image_url = 'https://cdn.example.com/lampe.jpg' from public.shop_items where id = 'c8000000-0000-0000-0000-00000000000a'),
    'S8 a link without its scheme gets https://, spaces around it go');
  update public.shop_items set url = 'www.blåbær.no/kurv' where id = 'c8000000-0000-0000-0000-00000000000a';
  perform t_ok((select url = 'https://www.blåbær.no/kurv' from public.shop_items where id = 'c8000000-0000-0000-0000-00000000000a'),
    'S8 …a Norwegian address too (æ, ø, å kept)');
  e := t_err($q$update public.shop_items set url = 'javascript:alert(document.cookie)' where id = 'c8000000-0000-0000-0000-00000000000a'$q$);
  perform t_ok(e like '23514 A link is one web address%', 'S8 a javascript: link is refused (' || e || ')');
  e := t_err($q$insert into public.shop_items (title, url) values ('Rug', 'Ola''s shop')$q$);
  perform t_ok(e like '23514 A link is one web address%', 'S8 text that is no web address is refused as a link');
  e := t_err($q$insert into public.shop_items (title, url) values ('Rug', E'https://example.com/a\nX-Injected: 1')$q$);
  perform t_ok(e like '23514 A link is one web address%', 'S8 a link with a line break in it is refused');
  update public.shop_items set image_url = 'data:image/png;base64,AAAA' where id = 'c8000000-0000-0000-0000-00000000000a';
  perform t_ok((select image_url is null from public.shop_items where id = 'c8000000-0000-0000-0000-00000000000a'), 'S8 a picture that is no web address is not kept');
  update public.shop_items set image_url = '/img/lampe.jpg' where id = 'c8000000-0000-0000-0000-00000000000a';
  perform t_ok((select image_url is null from public.shop_items where id = 'c8000000-0000-0000-0000-00000000000a'), 'S8 …nor a path without its site');
  update public.shop_items set url = null where id = 'c8000000-0000-0000-0000-00000000000a';
  perform t_ok((select url is null from public.shop_items where id = 'c8000000-0000-0000-0000-00000000000a'), 'S8 a link can be taken off');
end $$;
reset role;
-- Rows from before 187 (written past the trigger, as 137 allowed): their next write is never refused.
alter table public.shop_items drop constraint shop_items_url_web_check, drop constraint shop_items_image_url_web_check;
set session_replication_role = replica;
insert into public.shop_items (id, user_id, title, status, url, image_url, notes) values
  ('c8100000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Old A', 'wishlist', 'www.prisjakt.no/p=1', 'img/a.jpg', null),
  ('c8100000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'Old B', 'wishlist', 'ask at the store', null, 'Gift idea');
set session_replication_role = origin;
alter table public.shop_items add constraint shop_items_url_web_check check (url is null or url ~* '^https?://') not valid,
  add constraint shop_items_image_url_web_check check (image_url is null or image_url ~* '^https?://') not valid;
set role authenticated;
do $$
begin
  update public.shop_items set status = 'bought' where id in ('c8100000-0000-0000-0000-00000000000a', 'c8100000-0000-0000-0000-00000000000b');
  perform t_ok((select url = 'https://www.prisjakt.no/p=1' and image_url is null and status = 'bought' from public.shop_items where id = 'c8100000-0000-0000-0000-00000000000a'),
    'S8 an old link without its scheme is completed when the row is next written (the write goes through)');
  perform t_ok((select url is null and notes = E'Gift idea\nLink: ask at the store' and status = 'bought' from public.shop_items where id = 'c8100000-0000-0000-0000-00000000000b'),
    'S8 an old "link" that is no web address moves into the notes, never blocks the row');
end $$;
reset role;
select t_ok(t_err('alter table public.shop_items validate constraint shop_items_url_web_check') = 'done'
        and t_err('alter table public.shop_items validate constraint shop_items_image_url_web_check') = 'done',
  'S8 after that both checks validate');

-- ═══ S9. Undo this save (Developer → Activity, 150/151) ══════════════════════
set role authenticated;
do $$
begin
  insert into public.shop_items (id, title, price, currency, status, bought_at) values ('c9000000-0000-0000-0000-00000000000a', 'Monitor', 300, 'EUR', 'bought', '2026-10-01 12:00+02');
end $$;
do $$
begin
  update public.shop_items set fx_nok = 11, fx_source = 'manual' where id = 'c9000000-0000-0000-0000-00000000000a';
  insert into public.t_keep values ('typed', jsonb_build_object('tx', txid_current()));
end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('typed'));
  perform t_ok(not (p ->> 'needs_confirm')::boolean and p -> 'drift' = '[]', 'S9 the undo of a typed rate needs no confirming (no rule changes it again)');
  p := public.app_undo_transaction(public.t_tx('typed'), true);
  perform t_ok((select fx_nok = 11.50 and fx_source = 'norges_bank' from public.shop_items where id = 'c9000000-0000-0000-0000-00000000000a'),
    'S9 …and puts Norges Bank''s rate back, labelled as Norges Bank''s');
end $$;
do $$
begin
  insert into public.shop_items (id, title, price, status, bought_at) values
    ('c9000000-0000-0000-0000-00000000000b', 'Drone', 4000, 'bought', '2026-01-01 12:00+01'),
    ('c9000000-0000-0000-0000-00000000000c', 'Spare battery', 500, 'bought', '2026-01-01 12:00+01');
  update public.shop_items set accessory_of = 'c9000000-0000-0000-0000-00000000000b' where id = 'c9000000-0000-0000-0000-00000000000c';
  insert into public.shop_items (id, title, status) values ('c9000000-0000-0000-0000-00000000000d', 'Better drone', 'wishlist');
end $$;
do $$
begin
  perform public.shop_record_sale('[{"id": "c9000000-0000-0000-0000-00000000000b", "sale_price": "3000"}]', 'sold', '2026-10-01', 'NOK', null,
    '[{"id": "c9000000-0000-0000-0000-00000000000c", "move_to": null}]', 'c9000000-0000-0000-0000-00000000000d', null);
  insert into public.t_keep values ('sale', jsonb_build_object('tx', txid_current()));
end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('sale'));
  perform t_ok((p ->> 'can_apply')::boolean, 'S9 a recorded sale can be undone from Activity');
  p := public.app_undo_transaction(public.t_tx('sale'), true, p ->> 'confirm');
  perform t_ok((select disposal is null and sale_undo is null from public.shop_items where id = 'c9000000-0000-0000-0000-00000000000b')
               and (select accessory_of = 'c9000000-0000-0000-0000-00000000000b' from public.shop_items where id = 'c9000000-0000-0000-0000-00000000000c')
               and not exists (select 1 from public.shop_item_links where from_id = 'c9000000-0000-0000-0000-00000000000b'),
    'S9 …the battery back on the drone, the link the sale made gone');
end $$;
reset role;

-- ═══ S10. Deleting an account ════════════════════════════════════════════════
-- Supabase Auth deletes a user as its own role, which can't read these tables; the checks that run when
-- that transaction ends (SECURITY DEFINER) must still let it through.
do $$ begin create role t_auth_admin nologin; exception when duplicate_object then null; end $$;
grant usage on schema auth to t_auth_admin;
grant select, delete on auth.users to t_auth_admin;
set test.uid = '00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$
begin
  insert into public.shop_items (id, title, price, status, bought_at) values
    ('ca000000-0000-0000-0000-00000000000a', 'Their bike', 5000, 'bought', '2026-01-01 12:00+01'),
    ('ca000000-0000-0000-0000-00000000000b', 'Their lock', 300, 'bought', '2026-01-01 12:00+01'),
    ('ca000000-0000-0000-0000-00000000000c', 'Their car', 90000, 'bought', '2026-01-01 12:00+01');
  update public.shop_items set accessory_of = 'ca000000-0000-0000-0000-00000000000a' where id = 'ca000000-0000-0000-0000-00000000000b';
  insert into public.shop_item_links (from_id, to_id) values ('ca000000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-00000000000c');
  perform public.shop_record_sale('[{"id": "ca000000-0000-0000-0000-00000000000a", "sale_price": "3000"}, {"id": "ca000000-0000-0000-0000-00000000000b", "sale_price": "100"}]',
    'sold', '2026-10-01', 'NOK', null);
end $$;
reset role;
reset test.uid;
set role t_auth_admin;
delete from auth.users where id = '00000000-0000-0000-0000-000000000002';
reset role;
select t_ok(not exists (select 1 from public.shop_items where user_id = '00000000-0000-0000-0000-000000000002'),
  'S10 an account with a sale group and a money link deletes cleanly (as Supabase Auth would)');
