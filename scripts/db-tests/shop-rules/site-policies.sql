-- Migration 188 (sites shop-price never reads, and the condition of a price) on the Shop chain after 187 and 188
-- each ran twice (scripts/verify-db-shop-rules.mjs), after scenarios.sql (whose t_ok and t_err this uses).
-- Setup and checks run as the superuser; app reads and writes as `authenticated`, shop-price's as `service_role`.
-- Names and hosts beyond the two seeded sites are made up.

-- ═══ P0. The migration ═══════════════════════════════════════════════════════
select t_ok((select relrowsecurity from pg_class where oid = 'public.shop_site_policies'::regclass)
        and exists (select 1 from pg_policies where tablename = 'shop_site_policies' and policyname = 'app_owner_lock')
        and (select string_agg(host, ',' order by host) = 'finn.no,tise.com' from public.shop_site_policies)
        and (select bool_and(no_automated_reading and checked_on = '2026-11-10' and source_url like 'https://%' and reason <> '')
             from public.shop_site_policies),
  'P0 after two runs: row level security, the owner lock, and finn.no and tise.com, each with its reason, its terms (https) and the day checked');
select t_ok((select source_url = 'https://www.finn.no/vilkar/brukervilkar-finn' from public.shop_site_policies where host = 'finn.no')
        and (select source_url = 'https://tise.com/terms' from public.shop_site_policies where host = 'tise.com'),
  'P0 each site names the terms that say so');
select t_ok(has_table_privilege('authenticated', 'public.shop_site_policies', 'select')
        and not has_table_privilege('authenticated', 'public.shop_site_policies', 'insert')
        and not has_table_privilege('authenticated', 'public.shop_site_policies', 'update')
        and not has_table_privilege('authenticated', 'public.shop_site_policies', 'delete')
        and not has_table_privilege('anon', 'public.shop_site_policies', 'select')
        and has_table_privilege('service_role', 'public.shop_site_policies', 'insert')
        and has_table_privilege('service_role', 'public.shop_site_policies', 'update')
        and has_table_privilege('service_role', 'public.shop_site_policies', 'delete'),
  'P0 grants: the app reads it and never writes it; signed out, nothing; the service role writes');
select t_ok(not exists (select 1 from pg_trigger where tgrelid = 'public.shop_site_policies'::regclass and tgname = 'trg_audit')
        and exists (select 1 from pg_trigger where tgrelid = 'public.shop_site_policies'::regclass and tgname = 'trg_shop_site_policies_updated_at'),
  'P0 no audit trigger (written by migrations — the header says why), updated_at kept');
select t_ok((select pg_get_constraintdef(oid) like '%not_allowed%' from pg_constraint where conname = 'shop_price_watch_status_check')
        and (select count(*) = 3 from information_schema.columns where table_name = 'shop_price_watch' and column_name in ('condition', 'used_low', 'refurbished_low'))
        and (select count(*) = 3 from information_schema.columns where table_name = 'shop_price_points' and column_name in ('condition', 'used_low', 'refurbished_low')),
  'P0 the watch takes not_allowed; the watch and the points have condition, used_low and refurbished_low');

-- ═══ P1. Who reads and writes the list ═══════════════════════════════════════
set role authenticated;
select t_ok((select count(*) = 2 from public.shop_site_policies), 'P1 the owner reads the list');
select t_ok(t_err($q$insert into public.shop_site_policies (host, reason, source_url, checked_on) values ('shop.example.com', 'x', 'https://shop.example.com/terms', '2026-11-10')$q$) like '42501 %'
        and t_err($q$update public.shop_site_policies set no_automated_reading = false where host = 'finn.no'$q$) like '42501 %'
        and t_err($q$delete from public.shop_site_policies where host = 'finn.no'$q$) like '42501 %',
  'P1 …and can''t add, change or remove a site (only migrations and the service role write it)');
reset role;
set test.uid = '00000000-0000-0000-0000-000000000003';
set role authenticated;
select t_ok((select count(*) = 0 from public.shop_site_policies), 'P1 an account outside the owner lock reads nothing');
reset role;
reset test.uid;
set role anon;
select t_ok(t_err('select count(*) from public.shop_site_policies') like '42501 %', 'P1 signed out: no access at all');
reset role;
set test.uid = 'none';
set role service_role;
do $$
begin
  insert into public.shop_site_policies (host, reason, source_url, checked_on)
    values ('ads.example.com', 'Made-up terms that forbid robots.', 'https://ads.example.com/terms', '2026-11-10');
  perform t_ok((select no_automated_reading from public.shop_site_policies where host = 'ads.example.com'),
    'P1 the service role adds a site; it is not to be read unless the row says otherwise');
  perform t_ok(t_err($q$insert into public.shop_site_policies (host, reason, source_url, checked_on) values ('Finn.NO', 'x', 'https://x.example/t', '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_site_policies (host, reason, source_url, checked_on) values ('https://finn.no', 'x', 'https://x.example/t', '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_site_policies (host, reason, source_url, checked_on) values ('localhost', 'x', 'https://x.example/t', '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_site_policies (host, reason, source_url, checked_on) values ('b.example.com', 'x', 'http://x.example/t', '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_site_policies (host, reason, source_url, checked_on) values ('c.example.com', '  ', 'https://x.example/t', '2026-11-10')$q$) like '23514 %'
           and t_err($q$insert into public.shop_site_policies (host, reason, source_url, checked_on) values ('finn.no', 'again', 'https://x.example/t', '2026-11-10')$q$) like '23505 %',
    'P1 a host is one lower-case name with a dot (no capitals, no scheme, no bare name), the source is https, a reason is given, one row per host');
  delete from public.shop_site_policies where host = 'ads.example.com';
end $$;
reset role;
reset test.uid;

-- ═══ P2. The price's condition and not_allowed, as shop-price writes them ════
insert into public.shop_items (id, user_id, title, status, url) values
  ('cb000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Phone', 'wishlist', 'https://www.prisjakt.no/product.php?p=12105530'),
  ('cb000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'Sofa from an ad', 'wishlist', 'https://www.finn.no/recommerce/forsale/item/1');
set test.uid = 'none';
set role service_role;
do $$
begin
  insert into public.shop_price_watch (item_id, user_id, url, status, low, high, offers, currency, source, condition, used_low, refurbished_low, last_ok_at)
    values ('cb000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://www.prisjakt.no/product.php?p=12105530', 'ok',
            16115, 16252, 2, 'NOK', 'prisjakt', 'new', 5990, 6490, now() - interval '1 hour');
  insert into public.shop_price_points (user_id, item_id, checked_at, low, high, offers, currency, source, condition, used_low, refurbished_low)
    values ('00000000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-00000000000a', now() - interval '1 hour', 16115, 16252, 2, 'NOK', 'prisjakt', 'new', 5990, 6490);
  insert into public.shop_price_watch (item_id, user_id, url, status, error, source)
    values ('cb000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'https://www.finn.no/recommerce/forsale/item/1', 'not_allowed',
            'finn.no doesn''t allow automated reading', 'store');
  perform t_ok((select count(*) = 2 from public.shop_price_watch where item_id in ('cb000000-0000-0000-0000-00000000000a', 'cb000000-0000-0000-0000-00000000000b')),
    'P2 shop-price writes a new-only price with its used and refurbished lows, and a check it never made (not_allowed)');
  perform t_ok(t_err($q$update public.shop_price_watch set condition = 'used' where item_id = 'cb000000-0000-0000-0000-00000000000a'$q$) like '23514 %'
           and t_err($q$update public.shop_price_watch set used_low = 'NaN' where item_id = 'cb000000-0000-0000-0000-00000000000a'$q$) like '23514 %'
           and t_err($q$update public.shop_price_points set refurbished_low = 'Infinity' where item_id = 'cb000000-0000-0000-0000-00000000000a'$q$) like '23514 %'
           and t_err($q$update public.shop_price_points set used_low = -1 where item_id = 'cb000000-0000-0000-0000-00000000000a'$q$) like '23514 %'
           and t_err($q$update public.shop_price_points set condition = 'refurbished' where item_id = 'cb000000-0000-0000-0000-00000000000a'$q$) like '23514 %'
           and t_err($q$update public.shop_price_watch set status = 'forbidden' where item_id = 'cb000000-0000-0000-0000-00000000000b'$q$) like '23514 %',
    'P2 the database keeps out an unknown condition, a NaN, infinite or negative low, and an unknown status');
end $$;
reset role;
reset test.uid;

-- ═══ P3. Delete's Undo carries them (188's helper) ═══════════════════════════
set role authenticated;
do $$
declare s jsonb;
begin
  s := public.shop_delete_items(array['cb000000-0000-0000-0000-00000000000a', 'cb000000-0000-0000-0000-00000000000b']::uuid[]);
  perform public.shop_restore_items(s);
  perform t_ok((select condition = 'new' and used_low = 5990 and refurbished_low = 6490 and low = 16115
                from public.shop_price_watch where item_id = 'cb000000-0000-0000-0000-00000000000a')
               and (select condition = 'new' and used_low = 5990 and refurbished_low = 6490 and low = 16115
                    from public.shop_price_points where item_id = 'cb000000-0000-0000-0000-00000000000a')
               and (select status = 'not_allowed' and error like 'finn.no %' from public.shop_price_watch where item_id = 'cb000000-0000-0000-0000-00000000000b'),
    'P3 Delete''s Undo puts the watches and points back with their condition, their used and refurbished lows, and a not_allowed check');
  s := public.shop_delete_items(array['cb000000-0000-0000-0000-00000000000a']::uuid[]);
  s := jsonb_set(jsonb_set(s, '{watches,0,condition}', '"used"'), '{watches,0,used_low}', '"NaN"');
  s := jsonb_set(jsonb_set(s, '{points,0,condition}', '"<b>"'), '{points,0,refurbished_low}', '-3');
  perform public.shop_restore_items(s);
  perform t_ok((select condition is null and used_low is null and refurbished_low = 6490 and low = 16115
                from public.shop_price_watch where item_id = 'cb000000-0000-0000-0000-00000000000a')
               and (select condition is null and refurbished_low is null and used_low = 5990 and low = 16115
                    from public.shop_price_points where item_id = 'cb000000-0000-0000-0000-00000000000a'),
    'P3 …a forged condition, or a NaN or negative low, in the snapshot is not kept; the rest of the row is');
end $$;
reset role;
