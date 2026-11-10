-- After a later migration re-ran 191's seed with changed facts (scripts/verify-db-shop-rules.mjs writes it from 191:
-- Elkjøp's open purchase 45 days instead of 30, its search link /sok, and a new store "Nordisk" (nordisk.example) with
-- a 30-day return rule). Account 1 edited Elkjøp's 30 days (to 35) and Elkjøp's name, and has a store of its own on
-- nordisk.example (stores.sql); account 6 edited nothing.

-- ═══ R7. A later seed never overwrites the owner's edits ═════════════════════
select t_ok((select days = 35 and owner_edited and (source_facts ->> 'days')::int = 45
             from public.shop_store_rules where id = t_rule('elkjop_open_purchase')),
  'R7 the owner''s 35 days stay; the source now says 45 — a conflict the app shows ("Elkjøp''s page now says 45")');
select t_ok((select name = 'Elkjøp Norge' and owner_edited and search_url = 'https://www.elkjop.no/search?q={q}'
                    and source_facts ->> 'search_url' = 'https://www.elkjop.no/sok?q={q}' and source_facts ->> 'name' = 'Elkjøp'
             from public.shop_stores where id = t_store('elkjop')),
  'R7 …the owner''s renamed Elkjøp keeps every fact as it was (the new search link is in its source only)');
select t_ok((select days = 45 and not owner_edited and source_facts = public.shop_store_rule_facts(r)
             from public.shop_store_rules r where user_id = '00000000-0000-0000-0000-000000000006' and seed_key = 'elkjop_open_purchase')
        and (select search_url = 'https://www.elkjop.no/sok?q={q}' and not owner_edited
             from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000006' and seed_key = 'elkjop'),
  'R7 an account that edited nothing gets the new facts');
select t_ok((select days = 50 and not owner_edited from public.shop_store_rules where id = t_rule('elkjop_open_purchase_club')),
  'R7 the owner''s rules the seed didn''t change stay as they were');
select t_ok(not exists (select 1 from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000001' and seed_key = 'nordisk')
        and not exists (select 1 from public.shop_store_rules where user_id = '00000000-0000-0000-0000-000000000001' and seed_key = 'nordisk_return')
        and (select name = 'Nordisk (mine)' and origin = 'owner' from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000001' and hosts = '{nordisk.example}')
        and (select count(*) = 1 from public.shop_store_rules r join public.shop_stores s on s.id = r.store_id
              where r.user_id = '00000000-0000-0000-0000-000000000006' and s.seed_key = 'nordisk' and r.days = 30),
  'R7 a new seeded store whose web address the owner already has is left out, its rules with it (the owner''s store wins); another account gets both');
set role authenticated;
do $$
declare res jsonb;
begin
  res := public.shop_store_rule_reset(public.t_rule('elkjop_open_purchase'));
  perform t_ok((res -> 'after' ->> 'days')::int = 45 and (res -> 'before' ->> 'days')::int = 35
               and (select not owner_edited from public.shop_store_rules where id = public.t_rule('elkjop_open_purchase')),
    'R7 Reset to the source takes the new 45 days');
end $$;
reset role;
