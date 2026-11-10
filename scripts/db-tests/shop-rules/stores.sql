-- Migration 191 (stores, marketplaces and their rules; Norway's law; deal days the owner edits) on the Shop chain
-- after 187, 188, 190 and 191 each ran twice (scripts/verify-db-shop-rules.mjs), after scenarios.sql, site-policies.sql
-- and signals.sql (whose t_ok, t_err, t_keep, t_tx and t_state this uses). Accounts by then: 1 (the owner) and 5
-- (seeded by 191 itself), 4 (added to the allow-list by signals.sql after 191 ran: seeded by the trigger), 2 deleted
-- by scenarios.sql's S10 (its stores went with it), 3 outside the owner lock. Setup and checks run as the superuser;
-- the app's reads and writes as `authenticated`, the assistant's as `service_role` (ai-proxy writes as it).
-- stores-reseed.sql runs after a later migration's seed (191 with changed facts) and checks what it changed.
-- Hosts beyond the seeded stores and every name are made up.

insert into auth.users values ('00000000-0000-0000-0000-000000000006') on conflict do nothing;
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000006') on conflict do nothing;

-- A rule's or a store's id in account 1 by its seed key.
create or replace function public.t_rule(k text) returns uuid language sql stable as $$
  select id from public.shop_store_rules where user_id = '00000000-0000-0000-0000-000000000001' and seed_key = k
$$;
create or replace function public.t_store(k text) returns uuid language sql stable as $$
  select id from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000001' and seed_key = k
$$;
grant execute on function public.t_rule(text) to authenticated, service_role;
grant execute on function public.t_store(text) to authenticated, service_role;
grant execute on function public.t_ok(boolean, text) to service_role;
grant execute on function public.t_err(text) to service_role;
grant all on public.t_keep to service_role;
-- A row compared field by field (updated_at moves with every write).
grant execute on function public.t_state(jsonb) to service_role;

-- ═══ R0. The migration ═══════════════════════════════════════════════════════
select t_ok(bool_and((select relrowsecurity from pg_class where oid = t::regclass))
        and bool_and(exists (select 1 from pg_policies where tablename = t and policyname = 'app_owner_lock')),
  'R0 after two runs: row level security and the owner lock on all four tables')
  from unnest(array['shop_stores', 'shop_store_rules', 'shop_law_rules', 'shop_deal_day_edits']) t;
select t_ok(bool_and(exists (select 1 from pg_policies where tablename = t and policyname = 'Users manage own ' || t
                              and cmd = 'ALL' and qual = '(( SELECT auth.uid() AS uid) = user_id)' and with_check = '(( SELECT auth.uid() AS uid) = user_id)'))
        and (select count(*) = 1 from pg_policies where tablename = 'shop_law_rules' and policyname <> 'app_owner_lock' and cmd = 'SELECT'),
  'R0 stores, rules and deal-day edits are the owner''s own rows ((select auth.uid())); the law is read-only')
  from unnest(array['shop_stores', 'shop_store_rules', 'shop_deal_day_edits']) t;
select t_ok(bool_and(has_table_privilege('authenticated', 'public.' || t, p) and has_table_privilege('service_role', 'public.' || t, p)
                     and not has_table_privilege('anon', 'public.' || t, p)),
  'R0 grants: the app and the service role read and write stores, rules and deal-day edits; signed out, nothing')
  from unnest(array['shop_stores', 'shop_store_rules', 'shop_deal_day_edits']) t, unnest(array['select', 'insert', 'update', 'delete']) p;
select t_ok(bool_and(has_table_privilege('authenticated', 'public.shop_law_rules', p) = (p = 'select')
                     and has_table_privilege('service_role', 'public.shop_law_rules', p) and not has_table_privilege('anon', 'public.shop_law_rules', p)),
  'R0 the law: the app reads it, only the service role writes it, signed out nothing')
  from unnest(array['select', 'insert', 'update', 'delete']) p;
select t_ok((select count(*) = 3 from pg_trigger where tgname = 'trg_audit' and tgrelid in ('public.shop_stores'::regclass, 'public.shop_store_rules'::regclass, 'public.shop_deal_day_edits'::regclass))
        and not exists (select 1 from pg_trigger where tgrelid = 'public.shop_law_rules'::regclass and tgname = 'trg_audit')
        and (select count(*) = 2 from pg_trigger where tgname in ('trg_shop_stores_rules', 'trg_shop_store_rules_rules'))
        and (select count(*) = 1 from pg_trigger where tgrelid = 'public.app_allowed_users'::regclass and tgname = 'trg_shop_store_seed'),
  'R0 the owner''s tables are audited and kept by their rules triggers, the law has no audit, a new account is seeded by a trigger');
select t_ok((select bool_and(p.proconfig = array['search_path=""'] and p.prosecdef = (p.proname = 'shop_store_seed_new_user'))
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
               'shop_host_ok', 'shop_hosts_ok', 'shop_https_ok', 'shop_link_host', 'shop_host_on', 'shop_search_url_ok', 'shop_month_day_ok',
               'shop_store_facts', 'shop_store_rule_facts', 'shop_stores_rules', 'shop_store_rules_rules', 'shop_store_rule_reset',
               'shop_store_reset', 'shop_store_seed', 'shop_store_seed_new_user'))
        and (select count(*) = 15 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
               'shop_host_ok', 'shop_hosts_ok', 'shop_https_ok', 'shop_link_host', 'shop_host_on', 'shop_search_url_ok', 'shop_month_day_ok',
               'shop_store_facts', 'shop_store_rule_facts', 'shop_stores_rules', 'shop_store_rules_rules', 'shop_store_rule_reset',
               'shop_store_reset', 'shop_store_seed', 'shop_store_seed_new_user')),
  'R0 every function 191 writes has search_path ''''; only the new account''s seed trigger is SECURITY DEFINER');
select t_ok(has_function_privilege('authenticated', 'public.shop_store_rule_reset(uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.shop_store_reset(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.shop_store_rule_reset(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.shop_store_reset(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public.shop_store_seed(uuid)', 'execute')
        and not has_function_privilege('service_role', 'public.shop_store_seed(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.shop_store_seed(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public.shop_store_seed_new_user()', 'execute'),
  'R0 the resets are for signed-in callers; the seed and its trigger for nobody (migrations only)');
set role authenticated;
select t_ok(t_err($q$select public.shop_store_seed('00000000-0000-0000-0000-000000000001')$q$) like '42501 %',
  'R0 …the app can''t run the seed (it would write as the migration does)');
reset role;

-- The seeds: each account in the allow-list has the same twelve stores and three rules, every one seeded, its
-- source kept and equal to its facts.
select t_ok((select string_agg(seed_key || ':' || kind || ':' || name || ':' || array_to_string(hosts, '+') || ':' || country || ':' || currency
                               || ':' || coalesce(read_on::text, '-'), ',' order by seed_key)
               from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000001')
          = 'clas_ohlson:shop:Clas Ohlson:clasohlson.com:NO:NOK:-,dustin:shop:Dustin:dustin.no:NO:NOK:-,elkjop:shop:Elkjøp:elkjop.no:NO:NOK:2026-11-10,'
            || 'finn:marketplace:FINN:finn.no:NO:NOK:2026-11-10,jernia:shop:Jernia:jernia.no:NO:NOK:2026-11-10,jula:shop:Jula:jula.no:NO:NOK:-,'
            || 'komplett:shop:Komplett:komplett.no:NO:NOK:-,power:shop:Power:power.no:NO:NOK:2026-11-10,'
            || 'prisjakt:price_site:Prisjakt:prisjakt.no:NO:NOK:2026-11-10,proshop:shop:Proshop:proshop.no:NO:NOK:-,'
            || 'tise:marketplace:Tise:tise.com:NO:NOK:2026-11-10,xxl:shop:XXL:xxl.no:NO:NOK:-',
  'R0 twelve stores seeded: Prisjakt, FINN, Tise, Elkjøp, Power, Jernia (read 10.11.2026) and six never read (they answer apps with a bot check)');
select t_ok((select bool_and(origin = 'seed' and not owner_edited and edited_at is null and source_facts = public.shop_store_facts(s)
                             and source_url like 'https://%' and member_tier is null and not hidden)
             from public.shop_stores s)
        and (select count(*) = 12 from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000005')
        and (select count(*) = 12 from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000006')
        and not exists (select 1 from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000003')
        and not exists (select 1 from public.shop_stores where user_id in ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004')),
  'R0 every seeded store: origin seed, not edited, its source = its facts, a https source; account 5 got them from 191, account 6 from the trigger when it was allowed in, account 3 (not allowed) none, deleted accounts none');
select t_ok((select search_url = 'https://www.elkjop.no/search?q={q}' from public.shop_stores where id = t_store('elkjop'))
        and (select count(*) = 1 from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000001' and search_url is not null),
  'R0 one search link seeded, Elkjøp''s (its product page''s own search form)');
select t_ok((select string_agg(r.seed_key || ':' || s.seed_key || ':' || r.kind || ':' || r.days || ':' || coalesce(r.member_tier, '-') || ':' || r.read_on, ',' order by r.seed_key)
               from public.shop_store_rules r join public.shop_stores s on s.id = r.store_id where r.user_id = '00000000-0000-0000-0000-000000000001')
          = 'elkjop_open_purchase:elkjop:open_purchase:30:-:2026-11-10,elkjop_open_purchase_club:elkjop:open_purchase:50:Kundeklubb:2026-11-10,power_return:power:return:90:-:2026-11-10'
        and (select bool_and(origin = 'seed' and not owner_edited and source_facts = public.shop_store_rule_facts(r) and not off and exclusions = '{}'
                             and source_url like 'https://www.' || (select hosts[1] from public.shop_stores s where s.id = r.store_id) || '/%')
             from public.shop_store_rules r)
        and (select words like '30-dagers åpent kjøp med uåpnet emballasje.%' from public.shop_store_rules where id = t_rule('elkjop_open_purchase'))
        and (select count(*) = 3 from public.shop_store_rules where user_id = '00000000-0000-0000-0000-000000000006'),
  'R0 three rules seeded, each from the store''s own product page (10.11.2026): Elkjøp 30 days, 50 for Kundeklubb members, Power 90 — in the store''s own words');
select t_ok(not exists (select 1 from public.audit_logs where table_name in ('shop_stores', 'shop_store_rules') and user_id <> '00000000-0000-0000-0000-000000000006'),
  'R0 the first seed and the second run are not in Activity (only account 6''s seed, written when it was allowed in)');
select t_ok((select string_agg(slug || ':' || kind || ':' || channel || ':' || seller || ':' || gives_right || ':' || coalesce(days::text, '-') || ':'
                               || coalesce(years::text, '-') || ':' || coalesce(long_lasting::text, '-') || ':' || to_workday, ',' order by slug) from public.shop_law_rules)
          = 'cancel_distance_business:cancel:distance:business:true:14:-:-:true,cancel_in_store_business:cancel:in_store:business:false:-:-:-:false,'
            || 'cancel_private:cancel:any:private:false:-:-:-:false,complaint_business:complaint:any:business:true:-:2:false:false,'
            || 'complaint_business_long:complaint:any:business:true:-:5:true:false,complaint_private:complaint:any:private:true:-:2:-:false'
        and (select bool_and(country = 'NO' and law_url like 'https://lovdata.no/%' and checked_on = '2026-11-10' and law <> '' and summary <> '') from public.shop_law_rules)
        and (select law_url = 'https://lovdata.no/lov/2002-06-21-34/§27' from public.shop_law_rules where slug = 'complaint_business_long'),
  'R0 Norway''s law, six rules: angrerett 14 days from receipt at a distance from a business (none in a shop, none from a private seller), reklamasjon 2 / 5 years, 2 between private persons — each citing Lovdata');

-- ═══ R1. Each account its own (row level security and the owner lock) ═══════
set role authenticated;
select t_ok((select count(*) = 12 from public.shop_stores) and (select count(*) = 3 from public.shop_store_rules)
        and (select count(*) = 6 from public.shop_law_rules),
  'R1 the owner reads their twelve stores, three rules and the law — never another account''s');
select t_ok(t_err($q$insert into public.shop_law_rules (slug, country, kind, channel, seller, gives_right, days, counts_from, name, summary, law, law_url, checked_on)
                     values ('x', 'NO', 'cancel', 'distance', 'business', true, 365, 'receipt', 'x', 'x', 'x', 'https://lovdata.no/x', '2026-11-10')$q$) like '42501 %'
        and t_err($q$update public.shop_law_rules set days = 365 where slug = 'cancel_distance_business'$q$) like '42501 %'
        and t_err($q$delete from public.shop_law_rules where slug = 'cancel_private'$q$) like '42501 %',
  'R1 …and can''t add, change or remove a rule of the law (only migrations write it)');
reset role;
set test.uid = '00000000-0000-0000-0000-000000000006';
set role authenticated;
do $$
declare n integer;
begin
  update public.shop_store_rules set days = 365 where id = public.t_rule('elkjop_open_purchase');
  get diagnostics n = row_count;
  perform t_ok(n = 0 and (select count(*) = 3 from public.shop_store_rules) and not exists (select 1 from public.shop_store_rules where id = public.t_rule('elkjop_open_purchase')),
    'R1 another app account sees only its own rules and can''t change the owner''s (no row)');
  perform t_ok(t_err(format($q$insert into public.shop_store_rules (store_id, kind, days) values (%L, 'return', 365)$q$, public.t_store('power'))) like '23514 %',
    'R1 …nor hang a rule on the owner''s store (a foreign key ignores row level security; the trigger doesn''t)');
end $$;
reset role;
set test.uid = '00000000-0000-0000-0000-000000000003';
set role authenticated;
select t_ok((select count(*) = 0 from public.shop_stores) and (select count(*) = 0 from public.shop_store_rules)
        and (select count(*) = 0 from public.shop_law_rules) and (select count(*) = 0 from public.shop_deal_day_edits)
        and t_err($q$insert into public.shop_stores (kind, name, country, currency, hosts) values ('shop', 'Stranger shop', 'NO', 'NOK', '{stranger.example}')$q$) like '42501 %',
  'R1 an account outside the owner lock reads nothing (not even the law) and writes nothing');
reset role;
reset test.uid;

-- ═══ R2. The owner edits a rule; never overwritten; reset; Undo ═════════════
set role authenticated;
do $$
declare
  r0 public.shop_store_rules; r1 public.shop_store_rules; r2 public.shop_store_rules; res jsonb;
  v_id constant uuid := public.t_rule('elkjop_open_purchase');
begin
  select * into r0 from public.shop_store_rules where shop_store_rules.id = v_id;
  update public.shop_store_rules set days = 35, words = 'Typed from the store''s terms.' where shop_store_rules.id = v_id;
  select * into r1 from public.shop_store_rules where shop_store_rules.id = v_id;
  perform t_ok(r1.owner_edited and r1.edited_at is not null and r1.days = 35 and r1.origin = 'seed' and r1.seed_key = 'elkjop_open_purchase'
               and r1.source_facts = r0.source_facts and (r1.source_facts ->> 'days')::int = 30,
    'R2 the owner edits a seeded rule: owner_edited and its time set by the database, origin and source kept (the source still says 30)');
  update public.shop_store_rules set days = 30, words = r0.words where shop_store_rules.id = v_id;
  select * into r2 from public.shop_store_rules where shop_store_rules.id = v_id;
  perform t_ok(not r2.owner_edited and r2.edited_at is null and public.shop_store_rule_facts(r2) = r2.source_facts,
    'R2 …typed back to what the source says, it is not edited any more (owner_edited is derived, never forgotten)');
  update public.shop_store_rules set origin = 'owner', seed_key = 'planted', source_facts = '{"days": 365}', owner_edited = false where shop_store_rules.id = v_id;
  select * into r2 from public.shop_store_rules where shop_store_rules.id = v_id;
  perform t_ok(r2.origin = 'seed' and r2.seed_key = 'elkjop_open_purchase' and r2.source_facts = r0.source_facts and not r2.owner_edited,
    'R2 the app can''t write origin, seed_key or the source, nor set owner_edited itself (kept as they were)');
  update public.shop_store_rules set owner_edited = true where shop_store_rules.id = v_id;
  select * into r1 from public.shop_store_rules where shop_store_rules.id = v_id;
  update public.shop_store_rules set days = 33 where shop_store_rules.id = v_id;
  update public.shop_store_rules set owner_edited = false where shop_store_rules.id = v_id;
  select * into r2 from public.shop_store_rules where shop_store_rules.id = v_id;
  perform t_ok(not r1.owner_edited and r2.owner_edited and r2.days = 33,
    'R2 …an edited rule stays edited when the app sends owner_edited false (and an unedited one stays unedited when it sends true)');
  update public.shop_store_rules set days = 30 where shop_store_rules.id = v_id;
  perform t_ok(t_err(format($q$update public.shop_store_rules set store_id = %L where id = %L$q$, public.t_store('power'), v_id)) like '23514 %',
    'R2 a rule stays with its store');
  perform t_ok(t_err(format($q$delete from public.shop_store_rules where id = %L$q$, v_id)) like '23514 %',
    'R2 a seeded rule is never deleted by the app …');
  update public.shop_store_rules set off = true where shop_store_rules.id = v_id;
  select * into r2 from public.shop_store_rules where shop_store_rules.id = v_id;
  perform t_ok(r2.off and r2.owner_edited, 'R2 … it is turned off, which is an edit (a later seed won''t turn it on)');
  -- Reset to the source, then its Undo (the app writes `before`'s facts back, with its time).
  res := public.shop_store_rule_reset(v_id);
  select * into r2 from public.shop_store_rules where shop_store_rules.id = v_id;
  perform t_ok(not r2.off and not r2.owner_edited and r2.days = 30 and public.t_state(res -> 'after') = public.t_state(to_jsonb(r2))
               and (res -> 'before' ->> 'off')::boolean and (res -> 'before' ->> 'owner_edited')::boolean,
    'R2 Reset to the source: the source''s facts back, not edited; it answers the row before and after');
  update public.shop_store_rules set off = (res -> 'before' ->> 'off')::boolean, days = (res -> 'before' ->> 'days')::int,
         edited_at = (res -> 'before' ->> 'edited_at')::timestamptz where shop_store_rules.id = v_id;
  select * into r2 from public.shop_store_rules where shop_store_rules.id = v_id;
  perform t_ok(public.t_state(to_jsonb(r2)) = public.t_state(res -> 'before'),
    'R2 …and its Undo puts back exactly the row before (off, edited, its edit time)');
  res := public.shop_store_rule_reset(v_id);
  perform t_ok(t_err(format($q$select public.shop_store_rule_reset(%L)$q$, gen_random_uuid())) like 'P0002 %',
    'R2 a reset of a rule that isn''t there (or another account''s) says so');
end $$;
-- The owner's own rule on a seeded store; Power's help centre's 60 days, typed (a conflict with the page's 90).
do $$
declare r public.shop_store_rules;
begin
  insert into public.shop_store_rules (id, store_id, kind, days, words, source_url, read_on, origin, seed_key, source_facts)
  values ('dd000000-0000-0000-0000-000000000001', public.t_store('power'), 'return', 60, 'Typed from the help centre.',
          'https://www.power.no/kundeservice/', '2026-11-10', 'seed', 'planted', '{"days": 365}');
  select * into r from public.shop_store_rules where id = 'dd000000-0000-0000-0000-000000000001';
  perform t_ok(r.origin = 'owner' and r.seed_key is null and r.source_facts is null and r.owner_edited and r.edited_at is not null,
    'R2 a rule the owner adds is theirs (origin owner, no seed key, no source, edited) whatever it claims');
  perform t_ok(t_err($q$select public.shop_store_rule_reset('dd000000-0000-0000-0000-000000000001')$q$) like '22023 %',
    'R2 …and has no source to reset to');
  perform t_ok((select count(*) = 2 from public.shop_store_rules where store_id = public.t_store('power') and kind = 'return' and not off),
    'R2 Power now has two return rules, 90 (its product page) and 60 (typed) — a conflict the app shows, never picks silently');
end $$;
reset role;
-- A later edit moves the edit time on (the first edit was days ago).
update public.shop_store_rules set edited_at = '2026-11-01 10:00+01' where id = 'dd000000-0000-0000-0000-000000000001';
set role authenticated;
update public.shop_store_rules set days = 61 where id = 'dd000000-0000-0000-0000-000000000001';
reset role;
select t_ok((select edited_at > '2026-11-02' and days = 61 from public.shop_store_rules where id = 'dd000000-0000-0000-0000-000000000001'),
  'R2 a later edit moves "typed" on to its own day');
set role authenticated;
update public.shop_store_rules set days = 60 where id = 'dd000000-0000-0000-0000-000000000001';
reset role;
-- An Undo days later writes the edit time back as it was (never "typed today").
set role authenticated;
update public.shop_store_rules set days = 45 where id = t_rule('elkjop_open_purchase_club');
reset role;
update public.shop_store_rules set edited_at = '2026-11-01 10:00+01' where id = t_rule('elkjop_open_purchase_club');
set role authenticated;
select public.shop_store_rule_reset(t_rule('elkjop_open_purchase_club'));
update public.shop_store_rules set days = 45, edited_at = '2026-11-01 10:00+01' where id = t_rule('elkjop_open_purchase_club');
reset role;
select t_ok((select days = 45 and owner_edited and edited_at = '2026-11-01 10:00+01' from public.shop_store_rules where id = t_rule('elkjop_open_purchase_club')),
  'R2 the Undo of a reset puts back the edit and its own day (typed 01.11.2026), not today');
set role authenticated;
select public.shop_store_rule_reset(t_rule('elkjop_open_purchase_club'));
reset role;
-- Activity's Undo of an edit (app_undo_transaction) gives back the row exactly, its flag too.
set role authenticated;
do $$
begin
  update public.shop_store_rules set days = 45 where id = public.t_rule('elkjop_open_purchase_club');
  insert into public.t_keep values ('r2_edit', jsonb_build_object('tx', txid_current()));
end $$;
do $$
declare p jsonb; r public.shop_store_rules;
begin
  p := public.app_undo_transaction(public.t_tx('r2_edit'));
  p := public.app_undo_transaction(public.t_tx('r2_edit'), true, p ->> 'confirm');
  select * into r from public.shop_store_rules where id = public.t_rule('elkjop_open_purchase_club');
  perform t_ok(r.days = 50 and not r.owner_edited and r.edited_at is null and coalesce(jsonb_array_length(p -> 'drift'), 0) = 0,
    'R2 Developer → Activity undoes an edit: 50 days again, not edited, and no drift');
end $$;
reset role;

-- ═══ R3. The owner's stores ══════════════════════════════════════════════════
set role authenticated;
do $$
declare s public.shop_stores; res jsonb;
begin
  update public.shop_stores set member_tier = '  Kundeklubb ', hidden = true where id = public.t_store('elkjop');
  select * into s from public.shop_stores where id = public.t_store('elkjop');
  perform t_ok(s.member_tier = 'Kundeklubb' and s.hidden and not s.owner_edited and s.edited_at is null,
    'R3 a member tier (trimmed) and hiding are the owner''s own: the store is not "edited", so a seed still updates its facts');
  update public.shop_stores set source_facts = '{"name": "Planted", "hosts": ["attacker.example"]}', origin = 'owner', seed_key = 'x' where id = public.t_store('elkjop');
  select * into s from public.shop_stores where id = public.t_store('elkjop');
  perform t_ok(s.source_facts ->> 'name' = 'Elkjøp' and s.origin = 'seed' and s.seed_key = 'elkjop' and not s.owner_edited,
    'R3 the app can''t write a store''s source, origin or seed key (kept as they were — a Reset can''t be steered)');
  update public.shop_stores set hidden = false where id = public.t_store('elkjop');
  update public.shop_stores set name = 'Elkjøp Lørenskog' where id = public.t_store('elkjop');
  select * into s from public.shop_stores where id = public.t_store('elkjop');
  perform t_ok(s.owner_edited and s.edited_at is not null and s.source_facts ->> 'name' = 'Elkjøp',
    'R3 renaming a seeded store is an edit (its source still says Elkjøp)');
  res := public.shop_store_reset(public.t_store('elkjop'));
  select * into s from public.shop_stores where id = public.t_store('elkjop');
  perform t_ok(s.name = 'Elkjøp' and not s.owner_edited and s.member_tier = 'Kundeklubb',
    'R3 Reset to the source brings the name back and keeps the member tier');
  perform t_ok(t_err(format($q$delete from public.shop_stores where id = %L$q$, public.t_store('jula'))) like '23514 %',
    'R3 a seeded store is never deleted by the app (it is hidden)');
  insert into public.shop_stores (id, kind, name, country, currency, hosts, search_url, origin, seed_key, source_facts)
  values ('dd000000-0000-0000-0000-000000000010', 'shop', 'Trendyol', 'TR', 'TRY', '{SHOP.Example.com.tr}',
          'https://www.shop.example.com.tr/sr?q={q}', 'seed', 'planted', '{"name": "x"}');
  select * into s from public.shop_stores where id = 'dd000000-0000-0000-0000-000000000010';
  perform t_ok(s.origin = 'owner' and s.seed_key is null and s.source_facts is null and s.owner_edited and s.hosts = '{shop.example.com.tr}',
    'R3 a store the owner adds (a Turkish shop) is theirs, its host in lower case, whatever it claims');
  insert into public.shop_store_rules (id, store_id, kind, days) values ('dd000000-0000-0000-0000-000000000011', 'dd000000-0000-0000-0000-000000000010', 'return', 14);
  perform t_ok(t_err($q$insert into public.shop_stores (kind, name, country, currency, hosts) values ('shop', 'Copy', 'NO', 'NOK', '{elkjop.no}')$q$) like '23505 %'
               and t_err($q$update public.shop_stores set hosts = '{power.no, shop.example.com.tr}' where id = 'dd000000-0000-0000-0000-000000000010'$q$) like '23505 %',
    'R3 a web address belongs to one store of an account');
  delete from public.shop_stores where id = 'dd000000-0000-0000-0000-000000000010';
  perform t_ok(not exists (select 1 from public.shop_store_rules where id = 'dd000000-0000-0000-0000-000000000011'),
    'R3 the owner deletes a store of their own, and its rules go with it');
end $$;
reset role;

-- ═══ R4. Bounds: links, hosts, days, windows, NaN ════════════════════════════
set role authenticated;
select t_ok(bool_and(t_err(format($q$update public.shop_store_rules set source_url = %L where id = %L$q$, u, t_rule('power_return'))) like '23514 %'),
  'R4 a source link is https only, its host right after the scheme: no http, javascript:, user@host, port, space, quote, angle bracket or 2 049 characters')
  from unnest(array['http://www.power.no/', 'javascript:alert(1)', 'https://www.power.no@attacker.example/', 'https://www.power.no:8443/',
                    'https://www.power.no/a b', 'https://www.power.no/"x', 'https://www.power.no/<x>', 'https://www.power.no/' || repeat('a', 2030),
                    '//www.power.no/', 'https://power/']) u;
select t_ok(t_err(format($q$update public.shop_store_rules set source_url = 'https://www.power.no/kundeservice/retur?x=1#y' where id = %L$q$, t_rule('power_return'))) = 'done',
  'R4 …a plain https link saves (the owner may cite any site)');
select t_ok(bool_and(t_err(format($q$update public.shop_stores set search_url = %L where id = %L$q$, u, t_store('power'))) like '23514 %'),
  'R4 a search link needs {q}, never in the host, https, on the store''s own host')
  from unnest(array['https://www.power.no/search', 'https://{q}.power.no/', 'http://www.power.no/s?q={q}', 'https://attacker.example/?q={q}',
                    'https://power.no.attacker.example/?q={q}', 'https://www.power.no/s?q={q} x', 'javascript:{q}']) u;
select t_ok(t_err(format($q$update public.shop_stores set search_url = 'https://www.power.no/search/?q={q}' where id = %L$q$, t_store('power'))) = 'done',
  'R4 …a subdomain of its own host saves');
select t_ok(bool_and(t_err(format($q$update public.shop_stores set hosts = %L where id = %L$q$, h, t_store('xxl'))) like '23514 %'),
  'R4 a store''s hosts: 1–20 real hosts, no scheme, path, port or empty one')
  from unnest(array['{}', '{xxl}', '{https://xxl.no}', '{xxl.no/x}', '{xxl.no:443}', '{""}', '{-xxl.no}',
                    (select array_agg('h' || g || '.example')::text from generate_series(1, 21) g)]) h;
do $$ declare v text; begin
  v := t_err(format($q$update public.shop_stores set hosts = '{XXL.no, xxl.no, www.xxl.no}' where id = %L$q$, public.t_store('xxl')));
  perform t_ok(v = 'done' and (select hosts = '{www.xxl.no,xxl.no}' from public.shop_stores where id = public.t_store('xxl')),
    'R4 …written in lower case, each once, sorted (so the source comparison doesn''t see an order)');
end $$;
select t_ok(bool_and(t_err(format($q$update public.shop_store_rules set %s where id = %L$q$, x, t_rule('power_return'))) ~ '^(23514|22P02|22003|22007|23502) '),
  'R4 a rule''s numbers and days are bounded: 1–400 days, NaN, infinity and text refused, no day read in the future or before 2000')
  from unnest(array['days = 0', 'days = 401', $x$days = 'NaN'$x$, $x$days = 'Infinity'$x$, $x$days = 'thirty'$x$, 'days = null',
                    'read_on = current_date + 5', $x$read_on = '1999-12-31'$x$]) x;
select t_ok(bool_and(t_err(format($q$insert into public.shop_store_rules (store_id, kind, window_from, window_to, return_until) values (%L, 'seasonal_return', %L, '12-24', '01-15')$q$,
                                  t_store('elkjop'), d)) like '23514 %'),
  'R4 a window''s day is a MM-DD every year has (no 29.02, no 13th month, no 1-5)')
  from unnest(array['02-29', '13-01', '1-5', '00-10', '04-31', 'NaN', '11/01']) d;
select t_ok(bool_and(t_err(format($q$insert into public.shop_store_rules (store_id, kind, days, window_from, window_to, return_until, against, against_stores) values (%L, %s)$q$, t_store('elkjop'), v)) like '23514 %'),
  'R4 each kind only with its own fields (days for a return, a window for a seasonal one, whom a match is against …)')
  from unnest(array[$x$'open_purchase', null, null, null, null, null, null$x$, $x$'return', 30, null, null, null, 'any', null$x$,
                    $x$'seasonal_return', null, null, '12-24', '01-15', null, null$x$, $x$'seasonal_return', 30, '11-01', '12-24', '01-15', null, null$x$,
                    $x$'price_match', null, null, null, null, 'listed', null$x$, $x$'price_match', null, null, null, null, 'own', null$x$,
                    $x$'price_match', 14, null, null, null, 'any', null$x$, $x$'price_protection', 14, null, null, null, 'listed', null$x$,
                    $x$'price_protection', null, null, null, null, 'own', null$x$]) v;
select t_ok(bool_and(t_err(format($q$update public.shop_store_rules set %s where id = %L$q$, x, t_rule('power_return'))) like '23514 %'),
  'R4 exclusions from the list only, a known payout, words and a label of bounded length')
  from unnest(array[$x$exclusions = '{sale}'$x$, $x$exclusions = '{campaign,null}'$x$, $x$payout = 'points'$x$,
                    $x$words = repeat('x', 2001)$x$, $x$label = repeat('x', 61)$x$]) x;
do $$ declare v text; begin
  v := t_err(format($q$update public.shop_store_rules set exclusions = '{used,campaign,used}', payout = 'gift_card' where id = %L$q$, public.t_rule('power_return')));
  perform t_ok(v = 'done' and (select exclusions = '{campaign,used}' from public.shop_store_rules where id = public.t_rule('power_return')),
    'R4 …exclusions each once, sorted');
end $$;
do $$
begin
  perform t_ok(t_err(format($q$insert into public.shop_store_rules (store_id, kind, against, against_stores) values (%L, 'price_match', 'listed', %L)$q$,
                            public.t_store('elkjop'), array[public.t_store('power'), public.t_store('komplett')])) = 'done',
    'R4 a price match against listed stores names the account''s own other stores');
  perform t_ok(t_err(format($q$insert into public.shop_store_rules (store_id, kind, against, against_stores) values (%L, 'price_match', 'listed', %L)$q$,
                            public.t_store('elkjop'), array[public.t_store('elkjop')])) like '23514 %'
               and t_err(format($q$insert into public.shop_store_rules (store_id, kind, against, against_stores) values (%L, 'price_match', 'listed', %L)$q$,
                            public.t_store('elkjop'), array[(select id from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000006' limit 1)])) like '23514 %'
               and t_err(format($q$insert into public.shop_store_rules (store_id, kind, against, against_stores) values (%L, 'price_match', 'listed', %L)$q$,
                            public.t_store('elkjop'), array[gen_random_uuid()])) like '23514 %'
               and t_err(format($q$insert into public.shop_store_rules (store_id, kind, against, against_stores) values (%L, 'price_match', 'listed', %L)$q$,
                            public.t_store('elkjop'), (select array_agg(gen_random_uuid()) from generate_series(1, 51)))) like '23514 %',
    'R4 …never itself, another account''s store, a store that isn''t there, or more than 50');
end $$;
select t_ok(bool_and(t_err(format($q$update public.shop_stores set %s where id = %L$q$, x, t_store('jula'))) ~ '^(23514|23502) '),
  'R4 a store: an ISO country and currency, a name, an ad template only for a marketplace and with its language')
  from unnest(array[$x$country = 'no'$x$, $x$country = 'NOR'$x$, $x$currency = 'NOKK'$x$, $x$currency = 'nok'$x$, $x$name = ''$x$,
                    $x$name = repeat('x', 81)$x$, $x$ad_template = 'Selger {title}', ad_language = 'nb'$x$, $x$kind = 'bazaar'$x$]) x;
select t_ok(t_err(format($q$update public.shop_stores set ad_template = 'Selger {title}' where id = %L$q$, t_store('finn'))) like '23514 %'
        and t_err(format($q$update public.shop_stores set ad_template = 'Selger {title}', ad_language = 'nb' where id = %L$q$, t_store('finn'))) = 'done',
  'R4 …a marketplace''s ad template saves with its language');
reset role;

-- ═══ R5. The assistant (ai-proxy writes as the service role) ═════════════════
set test.uid = 'none';
set role service_role;
do $$
declare r public.shop_store_rules; n integer;
begin
  perform t_ok(t_err(format($q$update public.shop_stores set member_tier = 'Gold' where id = %L$q$, public.t_store('power'))) like '42501 %'
               and t_err($q$insert into public.shop_stores (user_id, kind, name, country, currency, hosts) values ('00000000-0000-0000-0000-000000000001', 'shop', 'Planted', 'NO', 'NOK', '{planted.example}')$q$) like '42501 %'
               and t_err(format($q$delete from public.shop_stores where id = %L$q$, public.t_store('xxl'))) like '42501 %',
    'R5 stores are read-only to the assistant (a planted host or search link would steer the owner''s taps)');
  insert into public.shop_store_rules (id, user_id, store_id, kind, window_from, window_to, return_until, words, source_url, origin, seed_key, owner_edited)
  values ('dd000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', public.t_store('elkjop'), 'seasonal_return',
          '11-01', '12-24', '01-15', 'Christmas returns until 15 January.', 'https://www.elkjop.no/kundeservice/retur', 'seed', 'planted', true);
  select * into r from public.shop_store_rules where id = 'dd000000-0000-0000-0000-000000000020';
  perform t_ok(r.origin = 'ask_ai' and r.seed_key is null and not r.owner_edited and r.source_facts = public.shop_store_rule_facts(r),
    'R5 a rule the assistant writes is labelled ask_ai ("from Ask AI — check it"), whatever it claims; its source is what it wrote');
  perform t_ok(t_err(format($q$insert into public.shop_store_rules (user_id, store_id, kind, days) values ('00000000-0000-0000-0000-000000000001', %L, 'return', 365)$q$,
                            (select id from public.shop_stores where user_id = '00000000-0000-0000-0000-000000000006' and seed_key = 'power'))) like '23514 %',
    'R5 …nor hang a rule on another account''s store (the service role skips row level security; the trigger doesn''t)');
  perform t_ok(t_err(format($q$insert into public.shop_store_rules (user_id, store_id, kind, days, source_url) values ('00000000-0000-0000-0000-000000000001', %L, 'return', 365, 'https://attacker.example/elkjop')$q$, public.t_store('elkjop'))) like '22023 %'
               and t_err(format($q$insert into public.shop_store_rules (user_id, store_id, kind, days, source_url) values ('00000000-0000-0000-0000-000000000001', %L, 'return', 365, 'https://elkjop.no.attacker.example/')$q$, public.t_store('elkjop'))) like '22023 %',
    'R5 …it may cite only the store''s own pages');
  update public.shop_store_rules set return_until = '01-31' where id = 'dd000000-0000-0000-0000-000000000020';
  select * into r from public.shop_store_rules where id = 'dd000000-0000-0000-0000-000000000020';
  perform t_ok(r.return_until = '01-31' and not r.owner_edited and r.source_facts ->> 'return_until' = '01-31',
    'R5 …it may change its own rule (its source follows)');
  perform t_ok(t_err(format($q$update public.shop_store_rules set days = 365 where id = %L$q$, public.t_rule('power_return'))) like '42501 %'
               and t_err($q$update public.shop_store_rules set days = 365 where id = 'dd000000-0000-0000-0000-000000000001'$q$) like '42501 %'
               and t_err(format($q$delete from public.shop_store_rules where id = %L$q$, public.t_rule('power_return'))) like '42501 %'
               and t_err($q$delete from public.shop_store_rules where id = 'dd000000-0000-0000-0000-000000000001'$q$) like '42501 %',
    'R5 …but never change or delete a seeded rule or one the owner made');
end $$;
reset role;
reset test.uid;
set role authenticated;
do $$
declare r public.shop_store_rules; res jsonb;
begin
  update public.shop_store_rules set return_until = '01-10' where id = 'dd000000-0000-0000-0000-000000000020';
  select * into r from public.shop_store_rules where id = 'dd000000-0000-0000-0000-000000000020';
  perform t_ok(r.origin = 'ask_ai' and r.owner_edited and r.source_facts ->> 'return_until' = '01-31',
    'R5 the owner corrects the assistant''s rule: it is the owner''s edit now (the source still the assistant''s words)');
  res := public.shop_store_rule_reset('dd000000-0000-0000-0000-000000000020');
  perform t_ok(res -> 'after' ->> 'return_until' = '01-31' and not (res -> 'after' ->> 'owner_edited')::boolean,
    'R5 …a reset goes back to what the assistant wrote');
  update public.shop_store_rules set return_until = '01-10' where id = 'dd000000-0000-0000-0000-000000000020';
end $$;
reset role;
set test.uid = 'none';
set role service_role;
select t_ok(t_err($q$update public.shop_store_rules set return_until = '03-31' where id = 'dd000000-0000-0000-0000-000000000020'$q$) like '42501 %'
        and t_err($q$delete from public.shop_store_rules where id = 'dd000000-0000-0000-0000-000000000020'$q$) = 'done',
  'R5 once the owner edited it the assistant can''t change it; deleting its own rule goes (ai-proxy asks the owner first: a Confirm card)');
reset role;
reset test.uid;

-- ═══ R6. Deal days the owner edits ═══════════════════════════════════════════
set role authenticated;
do $$
begin
  insert into public.shop_deal_day_edits (slug, name, rule_kind, month, weekday, nth, offset_days, length_days)
  values ('black_friday', 'Black Week', 'nth_weekday', 11, 4, 4, -3, 8);
  insert into public.t_keep values ('r6_edit', jsonb_build_object('tx', txid_current()));
end $$;
select t_ok((select offset_days = -3 and length_days = 8 and name = 'Black Week' and user_id = '00000000-0000-0000-0000-000000000001'
             from public.shop_deal_day_edits where slug = 'black_friday')
        and (select offset_days = 1 and length_days = 1 and name = 'Black Friday' from public.shop_deal_days where slug = 'black_friday'),
  'R6 the owner edits Black Friday into Black Week: their own row; 190''s row stays as it was');
select t_ok(bool_and(t_err(format($q$insert into public.shop_deal_day_edits (slug, name, rule_kind, month, day, weekday, nth, source_url) values (%s)$q$, v)) ~ '^(23514|23505|22P02) '),
  'R6 a deal day''s edit keeps 190''s bounds: a day every year has, a whole n-th weekday, a slug, https, one per slug')
  from unnest(array[$x$'leap', 'Leap', 'fixed', 2, 29, null, null, null$x$, $x$'fifth', 'Fifth', 'nth_weekday', 11, null, 4, 5, null$x$,
                    $x$'Bad Slug', 'x', 'fixed', 1, 1, null, null, null$x$, $x$'linked', 'x', 'fixed', 1, 1, null, null, 'http://deals.example/'$x$,
                    $x$'black_friday', 'Twice', 'fixed', 11, 27, null, null, null$x$, $x$'nan', 'x', 'fixed', 1, 'NaN', null, null, null$x$]) v;
select t_ok(t_err($q$insert into public.shop_deal_day_edits (slug, name, rule_kind, month, day) values ('payday_sale', 'Payday sale', 'fixed', 1, 25)$q$) = 'done'
        and t_err($q$update public.shop_deal_day_edits set off = true where slug = 'singles_day'$q$) = 'done',
  'R6 a deal day of the owner''s own saves too');
reset role;
set test.uid = '00000000-0000-0000-0000-000000000006';
set role authenticated;
select t_ok(not exists (select 1 from public.shop_deal_day_edits)
        and t_err($q$update public.shop_deal_day_edits set offset_days = 5 where slug = 'black_friday'$q$) = 'done'
        and t_err($q$insert into public.shop_deal_day_edits (user_id, slug, name, rule_kind, month, day) values ('00000000-0000-0000-0000-000000000001', 'planted', 'x', 'fixed', 1, 1)$q$) like '42501 %',
  'R6 another account sees none of the owner''s deal-day edits, changes none, plants none');
reset role;
reset test.uid;
select t_ok((select offset_days = -3 from public.shop_deal_day_edits where slug = 'black_friday' and user_id = '00000000-0000-0000-0000-000000000001'),
  'R6 …the owner''s edit is untouched');
-- A later migration changes 190's row: the owner's edit is another row, never overwritten.
update public.shop_deal_days set name = 'Black Friday (updated)', checked_on = '2026-11-20' where slug = 'black_friday';
select t_ok((select name = 'Black Week' and offset_days = -3 from public.shop_deal_day_edits where slug = 'black_friday' and user_id = '00000000-0000-0000-0000-000000000001'),
  'R6 a migration that changes 190''s Black Friday leaves the owner''s edit as it is');
update public.shop_deal_days set name = 'Black Friday', checked_on = '2026-11-10' where slug = 'black_friday';
set role authenticated;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('r6_edit'));
  p := public.app_undo_transaction(public.t_tx('r6_edit'), true, p ->> 'confirm');
  perform t_ok(not exists (select 1 from public.shop_deal_day_edits where slug = 'black_friday'),
    'R6 Developer → Activity undoes the edit (audited, one id key): Black Friday is 190''s again');
end $$;
reset role;

-- Kept for stores-reseed.sql: the owner's edit of Elkjøp's 30 days (to 35), and account 6's untouched.
set role authenticated;
update public.shop_store_rules set days = 35 where id = t_rule('elkjop_open_purchase');
update public.shop_stores set name = 'Elkjøp Norge' where id = t_store('elkjop');
reset role;
set role authenticated;
insert into public.shop_stores (kind, name, country, currency, hosts) values ('shop', 'Nordisk (mine)', 'NO', 'NOK', '{nordisk.example}');
reset role;
