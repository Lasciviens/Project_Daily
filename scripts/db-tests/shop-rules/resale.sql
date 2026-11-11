-- Migration 192 (resale and selling: ad notes, trade-in quotes, value history, listings, ad templates, hand-over
-- checklists) on the Shop chain after 187, 188, 190 and 192 each ran twice (scripts/verify-db-shop-rules.mjs), after
-- scenarios.sql, site-policies.sql and signals.sql (whose t_ok, t_err, t_keep, t_tx and t_auth_admin this uses).
-- 192 ran when accounts 1, 2 and 5 were app users (scenarios.sql's S10 has since deleted account 2, signals.sql's Q8
-- account 4); account 6 joins here, after it, and account 3 is outside the owner lock. Setup and checks run as the
-- superuser; app reads and writes as `authenticated`. Names, links and amounts are made up.
insert into auth.users values ('00000000-0000-0000-0000-000000000006') on conflict do nothing;
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000006') on conflict do nothing;
create or replace function public.t_today() returns date language sql stable as $$ select public.oslo_day(now()) $$;
grant execute on function public.t_today() to authenticated;

insert into public.shop_items (id, user_id, title, price, status, bought_at) values
  ('d2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Headphones', 3490, 'bought', '2026-01-10 12:00+01'),
  ('d2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Game console', 5990, 'bought', '2026-01-10 12:00+01'),
  ('d2000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Tablet', 4990, 'bought', '2026-01-10 12:00+01'),
  ('d2000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Camera', 7990, 'bought', '2026-01-10 12:00+01'),
  ('d2000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Bike', 9990, 'bought', '2026-01-10 12:00+01'),
  ('d2000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Kettle', 490, 'bought', '2026-01-10 12:00+01'),
  ('d2000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'Speaker', 1990, 'bought', '2026-01-10 12:00+01'),
  ('d2000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'A wish', 1000, 'wishlist', null),
  ('d2000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-000000000006', 'Their phone', 6990, 'bought', '2026-01-10 12:00+01');
insert into public.shop_items (id, user_id, title, status) values
  ('d2000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'Where its money goes', 'wishlist');

-- ═══ R0. The migration ═══════════════════════════════════════════════════════
select t_ok(bool_and((select relrowsecurity from pg_class where oid = ('public.' || t)::regclass)
                     and exists (select 1 from pg_policies where tablename = t and policyname = 'app_owner_lock')
                     and exists (select 1 from pg_policies where tablename = t and policyname = 'Users manage own ' || t
                                   and cmd = 'ALL' and qual like '%auth.uid()%' and with_check like '%auth.uid()%')
                     and (select count(*) = 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'trg_audit')
                     and (select count(*) = 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'trg_' || t || '_updated_at')
                     and (select column_default like '%auth.uid()%' and is_nullable = 'NO' from information_schema.columns
                           where table_name = t and column_name = 'user_id')),
  'R0 after two runs: six tables, each with row level security, the owner lock, the owner policy, the audit trigger, updated_at and user_id = auth.uid()')
  from unnest(array['shop_ad_notes', 'shop_trade_in_quotes', 'shop_value_history', 'shop_listings', 'shop_ad_templates', 'shop_handover_checklists']) t;
select t_ok(bool_and(has_table_privilege('authenticated', 'public.' || t, p) and has_table_privilege('service_role', 'public.' || t, p)
                     and not has_table_privilege('anon', 'public.' || t, p)),
  'R0 grants: the app and the service role read and write them; signed out, nothing')
  from unnest(array['shop_ad_notes', 'shop_trade_in_quotes', 'shop_value_history', 'shop_listings', 'shop_ad_templates', 'shop_handover_checklists']) t
  cross join unnest(array['select', 'insert', 'update', 'delete']) p;
select t_ok((select bool_and(p.proconfig = array['search_path=""'] and not p.prosecdef) from pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname in ('shop_link_on_host', 'shop_resale_rows_rules', 'shop_listings_rules',
                'shop_listings_thing_check', 'shop_items_resale', 'shop_resale_default_templates', 'shop_resale_default_checklists', 'shop_add_resale_defaults'))
        and (select count(*) = 8 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('shop_link_on_host', 'shop_resale_rows_rules',
                'shop_listings_rules', 'shop_listings_thing_check', 'shop_items_resale', 'shop_resale_default_templates', 'shop_resale_default_checklists', 'shop_add_resale_defaults'))
        and has_function_privilege('authenticated', 'public.shop_add_resale_defaults()', 'execute')
        and not has_function_privilege('anon', 'public.shop_add_resale_defaults()', 'execute')
        and not has_function_privilege('anon', 'public.shop_link_on_host(text, text)', 'execute'),
  'R0 eight functions, each with search_path '''' and running as the caller; signed in may add the defaults, signed out may not');
-- Same-event triggers fire in name order: the thing's own change is logged before what the resale trigger changes
-- (Activity's Undo takes them back newest first); a listing's thing is checked when the transaction ends.
select t_ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.shop_items'::regclass
              and tgname in ('trg_shop_items_resale', 'trg_audit')) = array['trg_audit', 'trg_shop_items_resale']
        and (select tgdeferrable and tginitdeferred from pg_trigger where tgrelid = 'public.shop_listings'::regclass and tgname = 'trg_shop_listings_thing'),
  'R0 shop_items'' resale trigger sorts after trg_audit; a listing''s thing is checked when the transaction ends');
select t_ok((select count(*) = 3 from public.shop_ad_templates where user_id = '00000000-0000-0000-0000-000000000001')
        and (select count(*) = 3 from public.shop_handover_checklists where user_id = '00000000-0000-0000-0000-000000000001')
        and (select count(*) = 6 from (select id from public.shop_ad_templates where user_id = '00000000-0000-0000-0000-000000000005'
                                       union all select id from public.shop_handover_checklists where user_id = '00000000-0000-0000-0000-000000000005') x)
        and not exists (select 1 from public.shop_ad_templates where user_id in ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000003'))
        and not exists (select 1 from public.shop_handover_checklists where user_id = '00000000-0000-0000-0000-000000000002'),
  'R0 every app user of the day has three ad templates and three checklists, once after two runs; a later account none; a deleted account''s went with it');
select t_ok((select string_agg(coalesce(marketplace, '-') || ':' || language, ',' order by marketplace nulls last) from public.shop_ad_templates
              where user_id = '00000000-0000-0000-0000-000000000001') = 'finn.no:nb,tise.com:nb,-:nb'
        and (select bool_and(body like '%{name}%' and body like '%{price}%' and body like '%Kjøpt {bought}%' and category is null)
             from public.shop_ad_templates where user_id = '00000000-0000-0000-0000-000000000001')
        and (select string_agg(category, ',' order by category) from public.shop_handover_checklists
              where user_id = '00000000-0000-0000-0000-000000000001') = 'Computers & Laptops,Game Consoles,Phones'
        and (select steps like '%Find My%' and steps like '%SIM card%' and steps like '%charger%' and array_length(string_to_array(steps, E'\n'), 1) = 8
             from public.shop_handover_checklists where user_id = '00000000-0000-0000-0000-000000000001' and category = 'Phones')
        and (select steps like '%PlayStation Network%' and steps like '%Factory reset%' from public.shop_handover_checklists
              where user_id = '00000000-0000-0000-0000-000000000001' and category = 'Game Consoles'),
  'R0 the templates are Norwegian, one for finn.no, tise.com and any other marketplace; the checklists for phones, game consoles and computers, a step a line');

-- ═══ R1. Ad notes ════════════════════════════════════════════════════════════
set role authenticated;
do $$
declare n record;
begin
  insert into public.shop_ad_notes (id, item_id, ad_url, price) values
    ('d2100000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'https://www.finn.no/recommerce/forsale/item/100', 2400)
  returning * into n;
  perform t_ok(n.user_id = '00000000-0000-0000-0000-000000000001' and n.currency = 'NOK' and n.asking and n.noted_on = t_today()
               and n.marketplace is null and n.condition is null,
    'R1 an ad noted with only its link and price: the owner''s, NOK, an asking price, noted today');
end $$;
select t_ok(t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, marketplace, condition, asking, noted_on)
                     values ('d2000000-0000-0000-0000-000000000001', 'https://www.finn.no/recommerce/forsale/item/101', 2200, 'finn.no', 'like_new', false, '2026-11-01')$q$) = 'done'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, marketplace) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1, 'finn.no')$q$) = 'done'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, marketplace) values ('d2000000-0000-0000-0000-000000000001', 'https://tise.com/p/1?ref=a#b', 1, 'tise.com')$q$) = 'done',
  'R1 a sold price on finn.no in like-new condition, the bare host and a subdomain of the marketplace, a query and a fragment: all saved');
select t_ok(bool_and(t_err(format($q$insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-000000000001', %L, 1)$q$, u)) like '23514 %'),
  'R1 the link is one https address: no http, javascript:, user:password@, spaces, control characters, a host without a dot, a bare host with a path of spaces, or over 2 048 characters')
  from unnest(array['http://www.finn.no/x', 'javascript:alert(1)', 'https://user:pw@finn.no/x', 'https://finn.no/a b', E'https://finn.no/a\tb',
                    E'https://finn.no/a\u0001b', 'https://localhost/x', 'ftp://finn.no/x', 'https://finn.no' || repeat('/x', 1030), ' https://finn.no/x', 'HTTPS://finn.no/x']) u;
select t_ok(t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, marketplace) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no.evil.example/x', 1, 'finn.no')$q$) like '23514 %The ad''s link is not on finn.no'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, marketplace) values ('d2000000-0000-0000-0000-000000000001', 'https://evilfinn.no/x', 1, 'finn.no')$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, marketplace) values ('d2000000-0000-0000-0000-000000000001', 'https://tise.com/x', 1, 'finn.no')$q$) like '23514 %'
        and t_err($q$update public.shop_ad_notes set marketplace = 'tise.com' where id = 'd2100000-0000-0000-0000-000000000001'$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, marketplace) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1, 'FINN.no')$q$) like '23514 %',
  'R1 a named marketplace holds its link: another host, one that only ends in its name, a host that only starts with it, an update to another marketplace and a marketplace not in host form are refused');
select t_ok(t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 'NaN')$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 'Infinity')$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', -1)$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, currency) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1, 'SEK')$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, condition) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1, 'mint')$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, noted_on) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1, public.t_today() + 2)$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, noted_on) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1, public.t_today() + 1)$q$) = 'done'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price, noted_on) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1, '1999-12-31')$q$) like '23514 %',
  'R1 a price from 0 below infinity (no NaN), NOK, TRY, EUR or USD, a known condition, a day from 2000 to tomorrow in Oslo (a phone east of Oslo is already there)');
-- Security review, 10.11.2026: every amount below a billion.
select t_ok(t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1000000000)$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1e300)$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 999999999.99)$q$) = 'done',
  'R1 an ad''s price is below a billion (a 1e300 one is refused, 999 999 999.99 is not)');
reset role;
set test.uid = '00000000-0000-0000-0000-000000000006';
set role authenticated;
select t_ok(t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1)$q$) like '23503 %own things'
        and t_err($q$insert into public.shop_ad_notes (user_id, item_id, ad_url, price) values ('00000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1)$q$) ~ '^(42501|23503) '
        and not exists (select 1 from public.shop_ad_notes)
        and t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-0000000000f6', 'https://finn.no/x', 1)$q$) = 'done',
  'R1 another app account can''t note an ad on the owner''s thing nor write as the owner, sees none of the owner''s, and notes on its own');
reset role;
set test.uid = '00000000-0000-0000-0000-000000000003';
set role authenticated;
select t_ok(t_err($q$insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-000000000001', 'https://finn.no/x', 1)$q$) ~ '^(42501|23503) '
        and t_err($q$insert into public.shop_ad_templates (title, body) values ('x', 'y')$q$) like '42501 %'
        and not exists (select 1 from public.shop_ad_notes) and not exists (select 1 from public.shop_listings) and not exists (select 1 from public.shop_ad_templates),
  'R1 an account outside the owner lock writes nothing and sees nothing');
reset role;
reset test.uid;

-- ═══ R2. Trade-in quotes ═════════════════════════════════════════════════════
set role authenticated;
insert into public.shop_trade_in_quotes (id, item_id, dealer, amount, condition, quoted_on) values
  ('d2200000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'A store', 1500, 'good', '2026-11-02');
select t_ok((select currency = 'NOK' and note is null and user_id = '00000000-0000-0000-0000-000000000001' from public.shop_trade_in_quotes where id = 'd2200000-0000-0000-0000-000000000001')
        and t_err($q$insert into public.shop_trade_in_quotes (item_id, dealer, amount) values ('d2000000-0000-0000-0000-000000000002', '  ', 1)$q$) like '23514 %'
        and t_err($q$insert into public.shop_trade_in_quotes (item_id, dealer, amount) values ('d2000000-0000-0000-0000-000000000002', 'A store', 'NaN')$q$) like '23514 %'
        and t_err($q$insert into public.shop_trade_in_quotes (item_id, dealer, amount, quoted_on) values ('d2000000-0000-0000-0000-000000000002', 'A store', 1, public.t_today() + 2)$q$) like '23514 %'
        and t_err($q$insert into public.shop_trade_in_quotes (item_id, dealer, amount, note) values ('d2000000-0000-0000-0000-000000000002', 'A store', 1, repeat('x', 501))$q$) like '23514 %'
        and t_err($q$insert into public.shop_trade_in_quotes (item_id, dealer, amount) values ('d2000000-0000-0000-0000-0000000000f6', 'A store', 1)$q$) like '23503 %own things',
  'R2 a quote: a dealer, an amount from 0 below infinity, a day up to tomorrow, a short note — and only for one of your own things');
select t_ok(t_err($q$insert into public.shop_trade_in_quotes (item_id, dealer, amount) values ('d2000000-0000-0000-0000-000000000002', repeat(' ', 200) || 'x', 1)$q$) like '23514 %'
        and t_err($q$insert into public.shop_trade_in_quotes (item_id, dealer, amount) values ('d2000000-0000-0000-0000-000000000002', repeat(' ', 1000000) || 'x', 1)$q$) like '23514 %'
        and t_err($q$insert into public.shop_trade_in_quotes (item_id, dealer, amount) values ('d2000000-0000-0000-0000-000000000002', E'\t\n ', 1)$q$) like '23514 %'
        and t_err($q$insert into public.shop_trade_in_quotes (item_id, dealer, amount) values ('d2000000-0000-0000-0000-000000000002', 'A store', 1000000000)$q$) like '23514 %',
  'R2 a dealer''s name counts every character (a megabyte of spaces and one letter is refused, so is only white space); an amount below a billion');
reset role;

-- ═══ R3. Value history ═══════════════════════════════════════════════════════
set role authenticated;
do $$
declare
  h text;
  w constant uuid := 'd2000000-0000-0000-0000-000000000003';
begin
  update public.shop_items set value_now = 3000, value_currency = 'NOK', value_on = '2026-05-01' where id = w;
  update public.shop_items set value_now = 2800, value_on = '2026-05-01' where id = w;
  select string_agg(valued_on || '=' || value || currency, ',' order by valued_on) into h from public.shop_value_history where item_id = w;
  perform t_ok(h = '2026-05-01=2800NOK', 'R3 an estimate is kept with its day; a new one on the same day replaces it (one a day)');
  update public.shop_items set value_now = 2400, value_on = '2026-11-01' where id = w;
  update public.shop_items set value_now = 2300, value_currency = 'EUR', value_on = '2026-11-05' where id = w;
  select string_agg(valued_on || '=' || value || currency, ',' order by valued_on) into h from public.shop_value_history where item_id = w;
  perform t_ok(h = '2026-05-01=2800NOK,2026-11-01=2400NOK,2026-11-05=2300EUR', 'R3 a later estimate adds its day, with its currency');
  update public.shop_items set value_now = 2400, value_currency = 'NOK', value_on = '2026-11-01' where id = w;
  select string_agg(valued_on || '=' || value || currency, ',' order by valued_on) into h from public.shop_value_history where item_id = w;
  perform t_ok(h = '2026-05-01=2800NOK,2026-11-01=2400NOK', 'R3 an estimate put back to an earlier day (an Undo) takes back the one after it');
  update public.shop_items set title = 'Tablet 10"' where id = w;
  perform t_ok((select count(*) = 2 from public.shop_value_history where item_id = w), 'R3 a write that leaves "Could sell for" as it was adds nothing');
  update public.shop_items set value_now = null, value_currency = null, value_on = null where id = w;
  select string_agg(valued_on || '=' || value || currency, ',' order by valued_on) into h from public.shop_value_history where item_id = w;
  perform t_ok(h = '2026-05-01=2800NOK', 'R3 a cleared estimate is taken back (the Undo of a first one leaves nothing); earlier ones stay');
  update public.shop_items set value_now = 2500 where id = w;
  perform t_ok((select valued_on = t_today() and value = 2500 and currency = 'NOK' from public.shop_value_history where item_id = w and valued_on > '2026-06-01'),
    'R3 an estimate without its day (the assistant may write one) is today''s, in NOK');
  insert into public.shop_items (id, title, price, status, bought_at, value_now, value_currency, value_on)
  values ('d2000000-0000-0000-0000-000000000008', 'Drone', 4000, 'bought', '2026-01-01 12:00+01', 3100, 'NOK', '2026-10-01');
  perform t_ok(not exists (select 1 from public.shop_value_history where item_id = 'd2000000-0000-0000-0000-000000000008'),
    'R3 a thing added with an estimate gets its history row when the transaction ends…');
end $$;
select t_ok((select count(*) = 1 from public.shop_value_history where item_id = 'd2000000-0000-0000-0000-000000000008' and value = 3100 and valued_on = '2026-10-01'),
  'R3 …and then has it');
reset role;
-- A NaN estimate (shop_items'' own check, value_now >= 0, lets NaN in) is never a reason to refuse the thing's write.
set role authenticated;
select t_ok(t_err($q$update public.shop_items set value_now = 'NaN', value_on = '2026-11-03' where id = 'd2000000-0000-0000-0000-000000000003'$q$) = 'done'
        and not exists (select 1 from public.shop_value_history where item_id = 'd2000000-0000-0000-0000-000000000003' and valued_on = '2026-11-03'),
  'R3 an estimate that is no number (NaN) is left out of the history, and the thing''s own write still goes through');
select t_ok(t_err($q$insert into public.shop_value_history (item_id, valued_on, value) values ('d2000000-0000-0000-0000-0000000000f6', '2026-11-01', 1)$q$) like '23503 %'
        and t_err($q$insert into public.shop_value_history (item_id, valued_on, value) values ('d2000000-0000-0000-0000-000000000006', '2026-11-01', 'Infinity')$q$) like '23514 %'
        and t_err($q$insert into public.shop_value_history (item_id, valued_on, value) values ('d2000000-0000-0000-0000-000000000006', '2100-01-01', 1)$q$) like '23514 %',
  'R3 a history row is for one of your own things, a finite value, a day before 2100');
select t_ok(t_err($q$insert into public.shop_value_history (item_id, valued_on, value) values ('d2000000-0000-0000-0000-000000000006', '2026-11-01', 1000000000)$q$) like '23514 %'
        and t_err($q$update public.shop_items set value_now = 1000000000, value_on = '2026-11-04' where id = 'd2000000-0000-0000-0000-000000000006'$q$) = 'done'
        and not exists (select 1 from public.shop_value_history where item_id = 'd2000000-0000-0000-0000-000000000006'),
  'R3 an estimate of a billion or more is left out of the history (the thing''s own write still goes through)');
-- Security review, 10.11.2026: a change takes back only what the previous estimate held — one steered write (the
-- assistant may write value_on) can't wipe the history.
do $$
declare
  h text;
  w constant uuid := 'd2000000-0000-0000-0000-000000000006';
begin
  update public.shop_items set value_now = 400, value_currency = 'NOK', value_on = '2026-05-01' where id = w;
  update public.shop_items set value_now = 350, value_on = '2026-08-01' where id = w;
  update public.shop_items set value_now = 300, value_on = '2026-11-01' where id = w;
  update public.shop_items set value_on = '2000-01-01' where id = w;
  select string_agg(valued_on || '=' || value, ',' order by valued_on) into h from public.shop_value_history where item_id = w;
  perform t_ok(h = '2000-01-01=300,2026-05-01=400,2026-08-01=350',
    'R3 an estimate moved back to 2000 takes back only its own day''s row — every earlier estimate stays');
  update public.shop_items set value_now = null, value_on = null where id = w;
  select string_agg(valued_on || '=' || value, ',' order by valued_on) into h from public.shop_value_history where item_id = w;
  perform t_ok(h = '2026-05-01=400,2026-08-01=350', 'R3 …and cleared after that: only the estimate it held goes');
  update public.shop_items set value_now = 380, value_on = '2026-06-01' where id = w;
  update public.shop_items set value_now = 370 where id = w;
  select string_agg(valued_on || '=' || value, ',' order by valued_on) into h from public.shop_value_history where item_id = w;
  perform t_ok(h = '2026-05-01=400,2026-06-01=370,2026-08-01=350', 'R3 …and a new value on the same day replaces that day''s row and leaves a later one');
end $$;
reset role;
set test.uid = '00000000-0000-0000-0000-000000000006';
set role authenticated;
select t_ok(not exists (select 1 from public.shop_value_history), 'R3 another app account sees none of the owner''s history');
reset role;
reset test.uid;

-- ═══ R4. Listings ════════════════════════════════════════════════════════════
set role authenticated;
do $$
declare l record;
begin
  insert into public.shop_listings (id, item_id, marketplace, prices, listed_on)
  values ('d2400000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004', 'finn.no', '[{"on": "2026-10-20", "price": 5000}]', '2026-10-20')
  returning * into l;
  perform t_ok(l.status = 'listed' and l.for_sale_on is null and l.ended_on is null and l.currency = 'NOK' and not l.closed_by_sale,
    'R4 a listing starts Listed (the ad written), in NOK');
  update public.shop_listings set status = 'for_sale' where id = l.id returning * into l;
  perform t_ok(l.status = 'for_sale' and l.for_sale_on = t_today() and l.ended_on is null, 'R4 For sale: up today (stamped)');
  update public.shop_listings set prices = '[{"on": "2026-10-20", "price": 5000}, {"on": "2026-11-01", "price": 4500}]',
                                  ad_url = 'https://www.finn.no/recommerce/forsale/item/200' where id = l.id returning * into l;
  perform t_ok(jsonb_array_length(l.prices) = 2 and l.prices -> -1 ->> 'price' = '4500' and l.for_sale_on = t_today(),
    'R4 a price cut is a dated price change at the end; the ad''s link on its marketplace; the day it went up kept');
  update public.shop_listings set prices = '[{"on": "2026-10-20", "price": 5000}, {"on": "2026-10-20", "price": 4800}, {"on": "2026-11-01", "price": 4500}]'
   where id = l.id returning * into l;
  perform t_ok(jsonb_array_length(l.prices) = 3 and l.prices -> 0 ->> 'price' = '5000' and l.prices -> 1 ->> 'on' = '2026-10-20',
    'R4 a price lowered on the day it was listed is a step of its own: the asking price stays first (two steps on one day)');
  update public.shop_listings set prices = '[{"on": "2026-10-20", "price": 5000}, {"on": "2026-11-01", "price": 4500}]' where id = l.id;
end $$;
select t_ok(t_err($q$insert into public.shop_listings (item_id, listed_on, prices) values ('d2000000-0000-0000-0000-000000000004', '2026-11-01', '[{"on": "2026-11-01", "price": 1}]')$q$) like '23505 %'
        and t_err($q$insert into public.shop_listings (item_id, listed_on, prices) values ('d2000000-0000-0000-0000-0000000000a1', '2026-11-01', '[{"on": "2026-11-01", "price": 1}]')$q$) like '23514 %Only a thing you have%'
        and t_err($q$insert into public.shop_listings (item_id, listed_on, prices) values ('d2000000-0000-0000-0000-0000000000f6', '2026-11-01', '[{"on": "2026-11-01", "price": 1}]')$q$) like '23503 %own things%'
        and t_err($q$update public.shop_listings set status = 'sold' where id = 'd2400000-0000-0000-0000-000000000001'$q$) like '23514 %record the sale%'
        and t_err($q$update public.shop_listings set ad_url = 'https://tise.com/x' where id = 'd2400000-0000-0000-0000-000000000001'$q$) like '23514 %'
        and t_err($q$update public.shop_listings set ad_url = 'http://www.finn.no/x', marketplace = null where id = 'd2400000-0000-0000-0000-000000000001'$q$) like '23514 %check constraint%',
  'R4 one open listing per thing; only a thing you have; only your own; Sold only through the sale; the ad''s link https and on its marketplace');
select t_ok(bool_and(t_err(format($q$update public.shop_listings set prices = %L where id = 'd2400000-0000-0000-0000-000000000001'$q$, p)) like '23514 %'),
  'R4 the price story: an array of 1–100 {on, price}, in order from the listing''s day to tomorrow, each price from 0 below a billion with at most two decimals')
  from unnest(array['[]', '{}', '"x"', '[1]', '[{"on": "2026-10-20"}]', '[{"on": "2026-10-20", "price": "5000"}]',
                    '[{"on": "2026-10-20", "price": 5000, "x": 1}]', '[{"on": "20.10.2026", "price": 5000}]', '[{"on": "2026-02-30", "price": 5000}]',
                    '[{"on": "2026-10-19", "price": 5000}]', '[{"on": "2026-11-02", "price": 5000}, {"on": "2026-11-01", "price": 4000}]',
                    '[{"on": "2026-10-20", "price": -1}]', '[{"on": "2026-10-20", "price": 1e9}]', '[{"on": "2026-10-20", "price": 4999.995}]',
                    (select jsonb_agg(jsonb_build_object('on', '2026-10-20', 'price', 1)) from generate_series(1, 101))::text,
                    jsonb_build_array(jsonb_build_object('on', (public.t_today() + 2)::text, 'price', 1))::text]) p;
do $$
declare l record;
begin
  update public.shop_listings set status = 'withdrawn' where id = 'd2400000-0000-0000-0000-000000000001' returning * into l;
  perform t_ok(l.ended_on = t_today() and l.for_sale_on = t_today() and not l.closed_by_sale, 'R4 Withdrawn: taken down today, the day it went up kept');
  update public.shop_listings set status = 'for_sale' where id = l.id returning * into l;
  perform t_ok(l.ended_on is null and l.for_sale_on = t_today(), 'R4 …and up again: no end day');
  update public.shop_listings set status = 'listed' where id = l.id returning * into l;
  perform t_ok(l.for_sale_on is null and l.ended_on is null, 'R4 …and back to Listed: not up');
end $$;
select t_ok(t_err($q$update public.shop_listings set listed_on = public.t_today() + 2, prices = jsonb_build_array(jsonb_build_object('on', (public.t_today() + 2)::text, 'price', 1)) where id = 'd2400000-0000-0000-0000-000000000001'$q$) like '23514 %'
        and t_err($q$update public.shop_listings set status = 'for_sale', for_sale_on = '2026-10-01' where id = 'd2400000-0000-0000-0000-000000000001'$q$) like '23514 %'
        and t_err($q$update public.shop_listings set closed_by_sale = true where id = 'd2400000-0000-0000-0000-000000000001'$q$) like '23514 %'
        and t_err($q$update public.shop_listings set currency = 'SEK' where id = 'd2400000-0000-0000-0000-000000000001'$q$) like '23514 %'
        and t_err($q$update public.shop_listings set ad_text = repeat('x', 6001) where id = 'd2400000-0000-0000-0000-000000000001'$q$) like '23514 %',
  'R4 no day in the future, up never before it was listed, closed by a sale only when it ended, a known currency, an ad text up to 6 000 characters');
reset role;

-- ═══ R5. A sale closes the listing; its Undo opens it again ═══════════════════
set role authenticated;
do $$
declare l record;
begin
  update public.shop_listings set status = 'for_sale' where id = 'd2400000-0000-0000-0000-000000000001';
  perform public.shop_record_sale('[{"id": "d2000000-0000-0000-0000-000000000004", "sale_price": "4300"}]', 'sold', '2026-11-08', 'NOK', null);
  select * into l from public.shop_listings where id = 'd2400000-0000-0000-0000-000000000001';
  perform t_ok(l.status = 'sold' and l.closed_by_sale and l.ended_on = t_today(),
    'R5 recording the sale closes its open listing: Sold, closed by the sale, on the sale''s day — never before the day it went up (today here)');
  perform t_ok(t_err($q$insert into public.shop_listings (item_id, listed_on, prices) values ('d2000000-0000-0000-0000-000000000004', '2026-11-01', '[{"on": "2026-11-01", "price": 1}]')$q$) like '23514 %Only a thing you have%',
    'R5 a sold thing can''t be listed again');
  perform public.shop_undo_sale('d2000000-0000-0000-0000-000000000004');
  select * into l from public.shop_listings where id = 'd2400000-0000-0000-0000-000000000001';
  perform t_ok(l.status = 'for_sale' and not l.closed_by_sale and l.ended_on is null and l.for_sale_on = t_today(),
    'R5 the sale''s Undo opens it again as it was: For sale since the day it went up');
end $$;
do $$
declare l record;
begin
  insert into public.shop_listings (id, item_id, prices, listed_on) values
    ('d2400000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000005', '[{"on": "2026-11-01", "price": 8000}]', '2026-11-01');
  perform public.shop_record_sale('[{"id": "d2000000-0000-0000-0000-000000000005", "sale_price": null}]', 'given', '2026-10-15', 'NOK', null);
  select * into l from public.shop_listings where id = 'd2400000-0000-0000-0000-000000000002';
  perform t_ok(l.status = 'withdrawn' and l.closed_by_sale and l.ended_on = '2026-11-01',
    'R5 given away while Listed: the listing is taken down, on its own day when the thing left before it (never before the listing)');
  update public.shop_items set disposal = 'sold', sale_price = 7000 where id = 'd2000000-0000-0000-0000-000000000005';
  perform t_ok((select status = 'sold' from public.shop_listings where id = 'd2400000-0000-0000-0000-000000000002'),
    'R5 …written later as sold after all: the listing says Sold');
  update public.shop_items set disposal = 'given', sale_price = null where id = 'd2000000-0000-0000-0000-000000000005';
  perform t_ok((select status = 'withdrawn' from public.shop_listings where id = 'd2400000-0000-0000-0000-000000000002'),
    'R5 …and back to given away: Withdrawn again');
  perform public.shop_undo_sale('d2000000-0000-0000-0000-000000000005');
  perform t_ok((select status = 'listed' and ended_on is null and not closed_by_sale from public.shop_listings where id = 'd2400000-0000-0000-0000-000000000002'),
    'R5 …and its Undo: Listed again, as it was');
end $$;
reset role;

-- ═══ R6. Undo this save (Developer → Activity, 150/151) ══════════════════════
set role authenticated;
do $$
begin
  update public.shop_items set value_now = 1500, value_currency = 'NOK', value_on = '2026-06-01' where id = 'd2000000-0000-0000-0000-000000000007';
end $$;
do $$
begin
  update public.shop_items set value_now = 1200, value_on = '2026-11-06' where id = 'd2000000-0000-0000-0000-000000000007';
  insert into public.t_keep values ('r6_value', jsonb_build_object('tx', txid_current()));
end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('r6_value'));
  perform t_ok((p ->> 'can_apply')::boolean and p -> 'drift' = '[]' and p -> 'blocked' = '[]', 'R6 a new "Could sell for" can be undone from Activity, nothing blocked');
  p := public.app_undo_transaction(public.t_tx('r6_value'), true, p ->> 'confirm');
  perform t_ok((select value_now = 1500 and value_on = '2026-06-01' from public.shop_items where id = 'd2000000-0000-0000-0000-000000000007')
               and (select string_agg(valued_on || '=' || value, ',') from public.shop_value_history where item_id = 'd2000000-0000-0000-0000-000000000007') = '2026-06-01=1500'
               and p -> 'drift' = '[]',
    'R6 …the estimate and its history back as before, no drift');
end $$;
do $$
begin
  insert into public.shop_listings (id, item_id, status, prices, listed_on) values
    ('d2400000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000007', 'for_sale', '[{"on": "2026-11-02", "price": 1400}]', '2026-11-02');
end $$;
do $$
begin
  perform public.shop_record_sale('[{"id": "d2000000-0000-0000-0000-000000000007", "sale_price": "1300"}]', 'sold', '2026-11-09', 'NOK', null);
  insert into public.t_keep values ('r6_sale', jsonb_build_object('tx', txid_current()));
end $$;
do $$
declare p jsonb;
begin
  perform t_ok((select status = 'sold' and closed_by_sale from public.shop_listings where id = 'd2400000-0000-0000-0000-000000000003'), 'R6 the sale closed the listing');
  p := public.app_undo_transaction(public.t_tx('r6_sale'));
  perform t_ok((p ->> 'can_apply')::boolean and p -> 'blocked' = '[]', 'R6 a sale that closed a listing can be undone from Activity');
  p := public.app_undo_transaction(public.t_tx('r6_sale'), true, p ->> 'confirm');
  perform t_ok((select disposal is null from public.shop_items where id = 'd2000000-0000-0000-0000-000000000007')
               and (select status = 'for_sale' and ended_on is null and not closed_by_sale and for_sale_on = t_today() from public.shop_listings where id = 'd2400000-0000-0000-0000-000000000003')
               and p -> 'drift' = '[]',
    'R6 …the thing is yours again and its listing for sale as before, no drift');
end $$;
do $$
begin
  perform public.shop_record_sale('[{"id": "d2000000-0000-0000-0000-000000000007", "sale_price": "1300"}]', 'sold', '2026-11-09', 'NOK', null);
end $$;
do $$
begin
  perform public.shop_undo_sale('d2000000-0000-0000-0000-000000000007');
  insert into public.t_keep values ('r6_unsale', jsonb_build_object('tx', txid_current()));
end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('r6_unsale'));
  perform t_ok((p ->> 'can_apply')::boolean and p -> 'blocked' = '[]', 'R6 the sale''s Undo can be undone from Activity too');
  p := public.app_undo_transaction(public.t_tx('r6_unsale'), true, p ->> 'confirm');
  perform t_ok((select disposal = 'sold' from public.shop_items where id = 'd2000000-0000-0000-0000-000000000007')
               and (select status = 'sold' and closed_by_sale from public.shop_listings where id = 'd2400000-0000-0000-0000-000000000003')
               and p -> 'drift' = '[]',
    'R6 …sold again, and its listing Sold again, no drift');
end $$;
reset role;

-- ═══ R7. Shop's Delete with Undo takes them and brings them back ═════════════
set role authenticated;
do $$
declare
  s jsonb;
  w constant uuid := 'd2000000-0000-0000-0000-000000000002';
  before_rows text;
  after_rows text;
begin
  update public.shop_items set value_now = 4000, value_currency = 'NOK', value_on = '2026-06-01' where id = w;
  update public.shop_items set value_now = 3500, value_on = '2026-11-01' where id = w;
  insert into public.shop_ad_notes (item_id, ad_url, price, marketplace, condition) values (w, 'https://www.finn.no/recommerce/forsale/item/300', 3900, 'finn.no', 'good');
  insert into public.shop_listings (item_id, status, prices, listed_on, marketplace, ad_text) values
    (w, 'for_sale', '[{"on": "2026-11-03", "price": 3800}, {"on": "2026-11-07", "price": 3600}]', '2026-11-03', 'finn.no', 'Selger en spillkonsoll.');
  select string_agg(x, '|' order by x) into before_rows from (
    select 'n' || (to_jsonb(n) - 'updated_at')::text as x from public.shop_ad_notes n where n.item_id = w
    union all select 'q' || (to_jsonb(q) - 'updated_at')::text from public.shop_trade_in_quotes q where q.item_id = w
    union all select 'h' || (to_jsonb(h) - 'updated_at')::text from public.shop_value_history h where h.item_id = w
    union all select 'l' || (to_jsonb(l) - 'updated_at')::text from public.shop_listings l where l.item_id = w) z;
  s := public.shop_delete_items(array[w]);
  perform t_ok((select string_agg(e ->> 'table', ',' order by e ->> 'table') from jsonb_array_elements(s -> 'more') e)
                 = 'shop_ad_notes,shop_listings,shop_trade_in_quotes,shop_value_history'
               and s -> 'hidden' = '[]'
               and not exists (select 1 from public.shop_listings where item_id = w) and not exists (select 1 from public.shop_value_history where item_id = w),
    'R7 deleting the thing takes its ad notes, quote, value history and listing, and keeps them all for Undo (none hidden)');
  perform public.shop_restore_items(s);
  select string_agg(x, '|' order by x) into after_rows from (
    select 'n' || (to_jsonb(n) - 'updated_at')::text as x from public.shop_ad_notes n where n.item_id = w
    union all select 'q' || (to_jsonb(q) - 'updated_at')::text from public.shop_trade_in_quotes q where q.item_id = w
    union all select 'h' || (to_jsonb(h) - 'updated_at')::text from public.shop_value_history h where h.item_id = w
    union all select 'l' || (to_jsonb(l) - 'updated_at')::text from public.shop_listings l where l.item_id = w) z;
  set constraints all immediate;
  perform t_ok(after_rows = before_rows and (select count(*) = 2 from public.shop_value_history where item_id = w),
    'R7 …and Undo puts every one back as it was, ids too: the note, the quote, both days of the history, the listing for sale with its price cut');
end $$;
reset role;

-- …and Activity's Undo of that delete too: the thing first, then its rows (a row whose thing isn't back yet is
-- refused with a foreign key's code, so the restore takes it in the next round).
set role authenticated;
do $$
begin
  insert into public.shop_items (id, title, price, status, bought_at) values ('d2000000-0000-0000-0000-0000000000e1', 'Watch', 3000, 'bought', '2026-01-01 12:00+01');
  update public.shop_items set value_now = 2000, value_currency = 'NOK', value_on = '2026-06-01' where id = 'd2000000-0000-0000-0000-0000000000e1';
end $$;
do $$
begin
  update public.shop_items set value_now = 1800, value_on = '2026-11-01' where id = 'd2000000-0000-0000-0000-0000000000e1';
  insert into public.shop_ad_notes (item_id, ad_url, price) values ('d2000000-0000-0000-0000-0000000000e1', 'https://finn.no/w', 1900);
  insert into public.shop_trade_in_quotes (item_id, dealer, amount) values ('d2000000-0000-0000-0000-0000000000e1', 'A store', 900);
  insert into public.shop_listings (item_id, status, prices, listed_on) values ('d2000000-0000-0000-0000-0000000000e1', 'for_sale', '[{"on": "2026-11-02", "price": 1900}]', '2026-11-02');
end $$;
insert into public.t_keep select 'r7_rows', jsonb_build_object(
  'n', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) from public.shop_ad_notes x where x.item_id = 'd2000000-0000-0000-0000-0000000000e1'),
  'q', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) from public.shop_trade_in_quotes x where x.item_id = 'd2000000-0000-0000-0000-0000000000e1'),
  'h', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.valued_on) from public.shop_value_history x where x.item_id = 'd2000000-0000-0000-0000-0000000000e1'),
  'l', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) from public.shop_listings x where x.item_id = 'd2000000-0000-0000-0000-0000000000e1'));
do $$
begin
  perform public.shop_delete_items(array['d2000000-0000-0000-0000-0000000000e1']::uuid[]);
  insert into public.t_keep values ('r7_del', jsonb_build_object('tx', txid_current()));
end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('r7_del'));
  perform t_ok((p ->> 'can_apply')::boolean and p -> 'error' = 'null' and p -> 'blocked' = '[]'
               and not exists (select 1 from jsonb_array_elements(p -> 'not_logged') e where e ->> 't' like 'shop\_%' and e ->> 't' not in ('shop_price_watch', 'shop_price_points')),
    'R7 a Shop delete with resale rows can be undone from Activity too (only the price watch, written by shop-price, is outside the log)');
  p := public.app_undo_transaction(public.t_tx('r7_del'), true, p ->> 'confirm');
  perform t_ok(p -> 'error' = 'null' and p -> 'drift' = '[]'
               and (select v from public.t_keep where k = 'r7_rows') = jsonb_build_object(
                 'n', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) from public.shop_ad_notes x where x.item_id = 'd2000000-0000-0000-0000-0000000000e1'),
                 'q', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) from public.shop_trade_in_quotes x where x.item_id = 'd2000000-0000-0000-0000-0000000000e1'),
                 'h', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.valued_on) from public.shop_value_history x where x.item_id = 'd2000000-0000-0000-0000-0000000000e1'),
                 'l', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) from public.shop_listings x where x.item_id = 'd2000000-0000-0000-0000-0000000000e1')),
    'R7 …and puts the thing, its note, quote, both history days and its listing for sale back as they were, no drift');
end $$;
reset role;

-- ═══ R8. The defaults ════════════════════════════════════════════════════════
set test.uid = '00000000-0000-0000-0000-000000000006';
set role authenticated;
do $$
begin
  perform t_ok(public.shop_add_resale_defaults() = 6, 'R8 an account added later gets the six defaults it lacks…');
  perform t_ok(public.shop_add_resale_defaults() = 0 and (select count(*) = 3 from public.shop_ad_templates) and (select count(*) = 3 from public.shop_handover_checklists),
    'R8 …three templates and three checklists; asked again, nothing');
end $$;
do $$
declare n integer;
begin
  update public.shop_ad_templates set body = 'Mitt eget: {name}' where marketplace = 'finn.no';
  delete from public.shop_handover_checklists where category = 'Phones';
  n := public.shop_add_resale_defaults();
  perform t_ok(n = 1
               and (select body = 'Mitt eget: {name}' from public.shop_ad_templates where marketplace = 'finn.no')
               and exists (select 1 from public.shop_handover_checklists where category = 'Phones'),
    'R8 …after deleting one and editing another: only the deleted one comes back, the edited one stays as the owner wrote it');
end $$;
select t_ok(t_err($q$insert into public.shop_handover_checklists (category, steps) values ('  phones ', 'x')$q$) like '23505 %'
        and t_err($q$insert into public.shop_ad_templates (marketplace, title, body) values ('finn.no', 'x', 'y')$q$) like '23505 %'
        and t_err($q$insert into public.shop_ad_templates (marketplace, category, title, body) values ('finn.no', 'Phones', 'x', 'y')$q$) = 'done'
        and t_err($q$insert into public.shop_ad_templates (marketplace, category, title, body) values ('finn.no', 'PHONES', 'x', 'y')$q$) like '23505 %'
        and t_err($q$insert into public.shop_ad_templates (title, body) values ('x', 'y')$q$) like '23505 %'
        and t_err($q$insert into public.shop_ad_templates (marketplace, title, body, language) values ('dba.dk', 'x', 'y', 'da')$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_templates (marketplace, title, body) values ('dba.dk', ' ', 'y')$q$) like '23514 %'
        and t_err($q$insert into public.shop_handover_checklists (category, steps) values ('Drones', repeat(E'x\n', 60) || 'x')$q$) like '23514 %',
  'R8 one template per marketplace and category, one checklist per category (names without case or spaces around); a known language; no blank title; at most 60 steps');
select t_ok(t_err($q$insert into public.shop_ad_templates (marketplace, title, body) values ('a.example', repeat(' ', 300) || 'x', 'y')$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_templates (marketplace, title, body) values ('a.example', 'x', repeat(' ', 1000000) || 'y')$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_templates (marketplace, title, body) values ('a.example', 'x', E' \n\t ')$q$) like '23514 %'
        and t_err($q$insert into public.shop_ad_templates (marketplace, category, title, body) values ('a.example', repeat(' ', 100) || 'x', 'x', 'y')$q$) like '23514 %'
        and t_err($q$insert into public.shop_handover_checklists (category, steps) values (repeat(' ', 100) || 'Drones', 'x')$q$) like '23514 %'
        and t_err($q$insert into public.shop_handover_checklists (category, steps) values ('Drones', repeat(' ', 5000) || 'x')$q$) like '23514 %'
        and t_err($q$insert into public.shop_handover_checklists (category, steps) values ('Drones', 'Charge it')$q$) = 'done',
  'R8 a title, text, category or checklist counts every character — a run of spaces around one letter is no way past the bound — and needs one that is not a space');
reset role;
set test.uid = '00000000-0000-0000-0000-000000000003';
set role authenticated;
select t_ok(t_err('select public.shop_add_resale_defaults()') like '42501 %', 'R8 an account outside the owner lock may not add them');
reset role;
reset test.uid;
set role anon;
select t_ok(t_err('select public.shop_add_resale_defaults()') like '42501 %', 'R8 nor may anyone signed out');
reset role;

-- ═══ R9. Deleting an account ════════════════════════════════════════════════
set test.uid = '00000000-0000-0000-0000-000000000006';
set role authenticated;
do $$
begin
  update public.shop_items set value_now = 5000, value_on = '2026-11-01' where id = 'd2000000-0000-0000-0000-0000000000f6';
  insert into public.shop_trade_in_quotes (item_id, dealer, amount) values ('d2000000-0000-0000-0000-0000000000f6', 'A store', 2000);
  insert into public.shop_listings (item_id, status, prices) values ('d2000000-0000-0000-0000-0000000000f6', 'for_sale', jsonb_build_array(jsonb_build_object('on', public.t_today()::text, 'price', 5500)));
end $$;
reset role;
reset test.uid;
set role t_auth_admin;
delete from auth.users where id = '00000000-0000-0000-0000-000000000006';
reset role;
select t_ok(bool_and(not exists (select 1 from public.shop_ad_notes where user_id = '00000000-0000-0000-0000-000000000006')
                     and not exists (select 1 from public.shop_trade_in_quotes where user_id = '00000000-0000-0000-0000-000000000006')
                     and not exists (select 1 from public.shop_value_history where user_id = '00000000-0000-0000-0000-000000000006')
                     and not exists (select 1 from public.shop_listings where user_id = '00000000-0000-0000-0000-000000000006')
                     and not exists (select 1 from public.shop_ad_templates where user_id = '00000000-0000-0000-0000-000000000006')
                     and not exists (select 1 from public.shop_handover_checklists where user_id = '00000000-0000-0000-0000-000000000006')),
  'R9 an account with ad notes, quotes, value history, a listing, templates and checklists deletes cleanly (as Supabase Auth would)');
