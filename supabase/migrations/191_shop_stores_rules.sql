-- 191 · Shop: stores, marketplaces and their rules as data; Norway's consumer law as data; deal days the owner can
-- edit (Shop step B, the data side — the owner approved the plan on 10.11.2026: "no power only processes", every
-- store and marketplace is a row with its rules; Norway only for the law; FINN and Tise are never fetched).
--
-- 1. shop_stores — one row per store, marketplace, price site or refurbisher: kind, name, country, currency, the web
--    addresses it owns (`hosts`: a link is on a store when its host is one of them or a subdomain of one —
--    "m.finn.no" is on finn.no, the rule of 188's shop_site_policies), an optional search-link pattern (`search_url`:
--    https only, `{q}` replaced by the URL-encoded brand + model, its host one of the store's own), an optional ad
--    template and its language (marketplaces only), and the owner's member tier there. Whether apps may read a
--    store's pages stays in 188's shop_site_policies — matched by host, never copied here.
-- 2. shop_store_rules — one row per rule of a store: open_purchase · return · seasonal_return · price_match (against
--    `listed` stores — `against_stores`, the account's own store ids — or `any`) · price_protection (the store's
--    `own` price or `any`). Days, a member tier, a date window (bought from–to, as MM-DD, crossing a year end when
--    it must) with a return-until day or a number of days, exclusions (campaign, black_friday, outlet,
--    marketplace_seller, used), the payout (money or a gift card), the store's own words, its link and the day read.
--    A seeded or page-read rule is never deleted by the app — it is turned off (`off`), so a later seed can't bring
--    it back.
-- 3. shop_law_rules — Norway's consumer law (Norway only, owner 10.11.2026), one row per rule, each citing its law:
--    the right to cancel (angrerett) — 14 days from receipt for a purchase at a distance (online, by phone) from a
--    business; none in a shop, none from a private seller (FINN) — and the right to complain (reklamasjon): 2 years,
--    5 for a thing meant to last much longer (forbrukerkjøpsloven § 27); 2 years between private persons
--    (kjøpsloven § 32). Counted from the day the buyer got the thing. The texts were written from the laws as
--    published on Lovdata; they were not re-read live for this change (no live sites in it) — `checked_on` is the
--    day the rows were written.
--    · No user_id: the law is the same for every account (reference data, like 188's shop_site_policies). App users
--      read it (owner lock); only migrations and the service role write it.
--    · No audit trigger: not user-authored — written only by migrations (their history is git).
-- 4. shop_deal_day_edits — deal days become editable (190 made them read-only reference rows): the owner's own
--    version of a deal day, by slug. A row whose slug is one of 190's replaces that deal day for this account (`off`
--    = the owner turned it off); any other slug is a deal day of the owner's own. Reset = the row goes (190's row
--    shows again). 190's shared rows stay as they are and a migration may change them freely: the owner's row is
--    another row, so their edit is never overwritten.
--
-- Per account or shared? The stores and their rules are PER ACCOUNT (user_id, the owner policy, audited, the
-- owner lock), seeded into each account by shop_store_seed(); the law stays shared. Why: the owner edits the rules
-- and adds stores of their own (a Turkish shop), the member tier is the owner's own fact, Developer → Activity must
-- be able to undo an edit (it needs the row's account), and one account's edit must never move another account's
-- deadlines. The seeds' source is kept on each row instead (next point), which a shared table would have needed
-- a second copy for anyway.
--
-- "You edited it — never overwrite" (owner, 10.11.2026). Each store and rule row keeps what its source said
-- (`source_facts`: the facts as the seed, a page read or Ask AI gave them), and `owner_edited` is DERIVED by the
-- rules trigger on every write, whoever writes: true for a row the owner made, or when the row's facts differ from
-- its source. So nothing can forget to set it, a reset to the source clears it, and an Undo that writes the old
-- facts back gets the old flag back. A seed run (this migration, a later one, a new account) writes the source to
-- every row but the facts only where owner_edited is false; where it is true the row keeps the owner's facts and
-- now differs from its source — a conflict the app shows, never picks silently. A member tier and a store's
-- `hidden` are the owner's own and never facts.
--
-- Who writes (the doors). The rules trigger tells them apart by the role the write runs as:
--    · the app (authenticated) — the owner: may edit any fact, add stores and rules (origin 'owner'), turn a rule
--      off, delete only rows it made itself; never `origin`, `seed_key` or `source_facts` (kept as they were; an
--      Ask AI row's source may be written back, which is what Undo does);
--    · the service role — the assistant (ai-proxy writes as it): stores are read-only to it; a rule it writes is
--      origin 'ask_ai' ("from Ask AI — check it"), its source is what it wrote, it may cite only the store's own
--      pages, and it may change or delete only its own rules the owner hasn't edited. A later page reader gets its
--      own door in its own migration; until then nothing else writes these tables as the service role;
--    · anyone else (a migration, the SQL editor, a cascade of a deleted account) — trusted, as written.
--
-- Seeds: only what has a source; unknown rules are left out, never guessed (owner, 10.11.2026). Stores: Prisjakt,
-- FINN, Tise, Elkjøp, Power, Jernia, Komplett, Proshop, Clas Ohlson, XXL, Jula and Dustin. Rules: Elkjøp's 30-day
-- open purchase and 50 days for club members, and Power's 90-day returns — the stores' own product pages, read on
-- 10.11.2026 (docs/integrations/prisjakt.md). Not seeded: Power's help centre's 60 days (no page of it was kept),
-- Jernia's returns (its page links to them without days), any price match or price protection (no page read says
-- one), and every rule of the stores that answer apps with a bot check (never read). Search links only where a page
-- shows its form: Elkjøp's (`/search?q=`, its product page's search form, 10.11.2026).
--
-- Seeded into every account in app_allowed_users now, and into an account added later (a trigger on
-- app_allowed_users, the SQL editor's insert). The audit trigger is attached after the first seed, so Activity
-- doesn't list the seed as a change of the owner's.
--
-- Functions: search_path ''; the rules triggers and the resets run as the caller; only the trigger that seeds a new
-- account is SECURITY DEFINER (it runs the seed for the account just added, nothing else) and no role may call it;
-- the seed itself is for migrations only. Safe to re-run: a second run writes nothing. Adds rows only (the seeds).
-- No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── 0. Small checks the tables use ──────────────────────────────────────────
-- A host as 188 has it: lower case, dotted labels, no scheme or port.
create or replace function public.shop_host_ok(p_host text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_host is not null and char_length(p_host) <= 253
     and p_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
$$;

-- A store's hosts: 1–20, each a host, none twice.
create or replace function public.shop_hosts_ok(p_hosts text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_hosts is not null and coalesce(pg_catalog.array_ndims(p_hosts), 0) = 1 and pg_catalog.cardinality(p_hosts) between 1 and 20
     and (select pg_catalog.bool_and(public.shop_host_ok(h)) from pg_catalog.unnest(p_hosts) h)
     and (select count(distinct h) from pg_catalog.unnest(p_hosts) h) = pg_catalog.cardinality(p_hosts)
$$;

-- A web link the app may show: https only, a host of dotted labels right after the scheme (no user, no port — so
-- "https://elkjop.no@example.com" is no link), then a path, query or fragment without spaces, control characters,
-- quotes, angle brackets, backslashes or backticks; at most 2 048 characters.
create or replace function public.shop_https_ok(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null and char_length(p_url) <= 2048
     and p_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+([/?#][^[:space:][:cntrl:]"<>`\\]*)?$'
$$;

-- The host of such a link, in lower case (null when it is none).
create or replace function public.shop_link_host(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when public.shop_https_ok(p_url) then pg_catalog.lower(pg_catalog.substring(p_url, '^https://([A-Za-z0-9.-]+)')) end
$$;

-- Whether a host is one of `p_hosts` or a subdomain of one (188's rule).
create or replace function public.shop_host_on(p_host text, p_hosts text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_host is not null and exists (
    select 1 from pg_catalog.unnest(p_hosts) h
     where p_host = h or (char_length(p_host) > char_length(h) + 1 and pg_catalog.right(p_host, char_length(h) + 1) = '.' || h))
$$;

-- A search-link pattern: `{q}` at least once, never in the host; with `{q}` filled in it is a web link the app may
-- show, on one of the store's own hosts.
create or replace function public.shop_search_url_ok(p_url text, p_hosts text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null and pg_catalog.strpos(p_url, '{q}') > 0
     and pg_catalog.strpos(coalesce(pg_catalog.substring(p_url, '^https://([^/?#]*)'), '{'), '{') = 0
     and public.shop_https_ok(pg_catalog.replace(p_url, '{q}', 'q'))
     and public.shop_host_on(public.shop_link_host(pg_catalog.replace(p_url, '{q}', 'q')), p_hosts)
$$;

-- A day of the year as MM-DD that every year has (no 29.02, as 190's fixed deal days).
create or replace function public.shop_month_day_ok(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
    then pg_catalog.substr(p, 4, 2)::integer <= case pg_catalog.substr(p, 1, 2)::integer when 2 then 28 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end
    else false end
$$;

-- ─── 1. Stores and marketplaces ──────────────────────────────────────────────
create table if not exists public.shop_stores (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  seed_key      text check (seed_key is null or seed_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  kind          text not null check (kind in ('shop', 'marketplace', 'price_site', 'refurbisher')),
  name          text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  country       text not null check (country ~ '^[A-Z]{2}$'),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  hosts         text[] not null check (public.shop_hosts_ok(hosts)),
  search_url    text check (search_url is null or public.shop_search_url_ok(search_url, hosts)),
  ad_template   text check (ad_template is null or char_length(ad_template) between 1 and 4000),
  ad_language   text check (ad_language is null or ad_language ~ '^[a-z]{2,3}$'),
  member_tier   text check (member_tier is null or (char_length(member_tier) between 1 and 60 and member_tier = btrim(member_tier))),
  hidden        boolean not null default false,
  origin        text not null default 'owner' check (origin in ('seed', 'page', 'owner')),
  source_url    text check (source_url is null or public.shop_https_ok(source_url)),
  read_on       date check (read_on is null or (read_on >= date '2000-01-01' and read_on < date '2100-01-01')),
  source_facts  jsonb check (source_facts is null or jsonb_typeof(source_facts) = 'object'),
  owner_edited  boolean not null default false,
  edited_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint shop_stores_seed_key unique (user_id, seed_key),
  -- An ad template comes with its language, and only a marketplace has one.
  constraint shop_stores_ad_check check ((ad_template is null) = (ad_language is null) and (ad_template is null or kind = 'marketplace'))
);
alter table public.shop_stores enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_stores' and policyname = 'Users manage own shop_stores'
  ) then
    create policy "Users manage own shop_stores" on public.shop_stores
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.shop_stores from anon;
grant select, insert, update, delete on public.shop_stores to authenticated;
grant select, insert, update, delete on public.shop_stores to service_role;
create index if not exists idx_shop_stores_user_name on public.shop_stores (user_id, name);

-- What a store's source says: the facts the owner can edit, a member tier and `hidden` left out (the owner's own).
create or replace function public.shop_store_facts(p public.shop_stores)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'kind', p.kind, 'name', p.name, 'country', p.country, 'currency', p.currency,
    'hosts', (select pg_catalog.to_jsonb(coalesce(pg_catalog.array_agg(distinct h order by h), '{}'::text[])) from pg_catalog.unnest(p.hosts) h),
    'search_url', p.search_url, 'ad_template', p.ad_template, 'ad_language', p.ad_language,
    'source_url', p.source_url, 'read_on', p.read_on)
$$;

-- The doors (the header), the account's hosts each on one store, and owner_edited derived.
create or replace function public.shop_stores_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_door text := case when current_user in ('authenticated', 'anon') then 'owner'
                      when current_user = 'service_role' then 'service' else 'trusted' end;
begin
  if v_door = 'service' then
    raise exception 'Stores are changed in the app, not by the assistant' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if v_door = 'owner' and old.seed_key is not null then
      raise exception 'A store from the app''s list is hidden, not deleted (a later update would bring it back)' using errcode = '23514';
    end if;
    return old;
  end if;

  new.name := pg_catalog.btrim(new.name);
  new.member_tier := nullif(pg_catalog.btrim(new.member_tier), '');
  new.hosts := array(select distinct pg_catalog.lower(pg_catalog.btrim(h)) from pg_catalog.unnest(new.hosts) h order by 1);
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  else
    new.created_at := least(coalesce(new.created_at, pg_catalog.now()), pg_catalog.now());
  end if;
  if v_door = 'owner' then
    if tg_op = 'INSERT' then
      new.origin := 'owner';
      new.seed_key := null;
      new.source_facts := null;
    else
      new.origin := old.origin;
      new.seed_key := old.seed_key;
      new.source_facts := old.source_facts;
    end if;
  end if;
  if new.read_on > current_date + 1 then
    raise exception 'A source can''t be read in the future' using errcode = '22007';
  end if;

  -- A web address belongs to one store of an account (the most specific host still wins in the app).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shop_stores ' || new.user_id::text, 0));
  if exists (select 1 from public.shop_stores s where s.user_id = new.user_id and s.id <> new.id and s.hosts && new.hosts) then
    raise exception 'That web address already belongs to another store' using errcode = '23505';
  end if;

  new.owner_edited := new.origin = 'owner'
    or (new.source_facts is not null and public.shop_store_facts(new) is distinct from new.source_facts);
  if not new.owner_edited then
    new.edited_at := null;
  elsif tg_op = 'UPDATE' and public.shop_store_facts(new) is distinct from public.shop_store_facts(old)
        and new.edited_at is not distinct from old.edited_at then
    new.edited_at := pg_catalog.now();
  else
    new.edited_at := least(coalesce(new.edited_at, pg_catalog.now()), pg_catalog.now());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_shop_stores_rules on public.shop_stores;
create trigger trg_shop_stores_rules before insert or update or delete on public.shop_stores
  for each row execute function public.shop_stores_rules();
drop trigger if exists trg_shop_stores_updated_at on public.shop_stores;
create trigger trg_shop_stores_updated_at before update on public.shop_stores
  for each row execute function public.update_updated_at();

comment on table public.shop_stores is
  'Stores, marketplaces, price sites and refurbishers, one row each, per account (seeded by shop_store_seed). A link is on a store when its host is one of `hosts` or a subdomain of one. Whether apps may read its pages: shop_site_policies (188), by host.';
comment on column public.shop_stores.search_url is 'A search link: https, {q} = the URL-encoded brand + model, on one of the store''s own hosts. Opened by the owner, never fetched.';
comment on column public.shop_stores.member_tier is 'The owner''s member tier at this store (a rule with the same member_tier applies to them). The owner''s own: never a fact.';
comment on column public.shop_stores.source_facts is 'What the source (a seed or a page read) said, as the row''s facts: the reset goes back to it, a seed run writes it, and the facts follow it only while owner_edited is false.';
comment on column public.shop_stores.owner_edited is 'Derived on every write: the owner made the row, or its facts differ from source_facts. Never overwritten by a seed or a page read.';

-- ─── 2. A store's rules ──────────────────────────────────────────────────────
create table if not exists public.shop_store_rules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  store_id       uuid not null references public.shop_stores(id) on delete cascade,
  seed_key       text check (seed_key is null or seed_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  kind           text not null check (kind in ('open_purchase', 'return', 'seasonal_return', 'price_match', 'price_protection')),
  label          text check (label is null or (char_length(label) between 1 and 60 and label = btrim(label))),
  days           smallint check (days is null or days between 1 and 400),
  member_tier    text check (member_tier is null or (char_length(member_tier) between 1 and 60 and member_tier = btrim(member_tier))),
  window_from    text check (window_from is null or public.shop_month_day_ok(window_from)),
  window_to      text check (window_to is null or public.shop_month_day_ok(window_to)),
  return_until   text check (return_until is null or public.shop_month_day_ok(return_until)),
  exclusions     text[] not null default '{}'
                 check (coalesce(array_ndims(exclusions), 1) = 1 and array_position(exclusions, null) is null
                        and exclusions <@ array['campaign', 'black_friday', 'outlet', 'marketplace_seller', 'used']::text[]),
  payout         text check (payout is null or payout in ('money', 'gift_card')),
  against        text check (against is null or against in ('listed', 'any', 'own')),
  against_stores uuid[] check (against_stores is null
                 or (coalesce(array_ndims(against_stores), 0) = 1 and cardinality(against_stores) between 1 and 50 and array_position(against_stores, null) is null)),
  words          text check (words is null or char_length(words) between 1 and 2000),
  source_url     text check (source_url is null or public.shop_https_ok(source_url)),
  read_on        date check (read_on is null or (read_on >= date '2000-01-01' and read_on < date '2100-01-01')),
  origin         text not null default 'owner' check (origin in ('seed', 'page', 'owner', 'ask_ai')),
  source_facts   jsonb check (source_facts is null or jsonb_typeof(source_facts) = 'object'),
  owner_edited   boolean not null default false,
  edited_at      timestamptz,
  off            boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint shop_store_rules_seed_key unique (user_id, seed_key),
  -- Each kind's own fields, and nothing else: a return window has days; a seasonal one a window and either days or a
  -- return-until day; a price match is against listed stores (named) or any; price protection has days and is
  -- against the store's own price or any.
  constraint shop_store_rules_shape check (case kind
    when 'open_purchase' then days is not null and window_from is null and window_to is null and return_until is null and against is null and against_stores is null
    when 'return' then days is not null and window_from is null and window_to is null and return_until is null and against is null and against_stores is null
    when 'seasonal_return' then window_from is not null and window_to is not null and (days is null) <> (return_until is null) and against is null and against_stores is null
    when 'price_match' then against in ('listed', 'any') and (against = 'listed') = (against_stores is not null)
                            and days is null and window_from is null and window_to is null and return_until is null
    when 'price_protection' then against in ('own', 'any') and against_stores is null and days is not null
                            and window_from is null and window_to is null and return_until is null
  end)
);
alter table public.shop_store_rules enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_store_rules' and policyname = 'Users manage own shop_store_rules'
  ) then
    create policy "Users manage own shop_store_rules" on public.shop_store_rules
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.shop_store_rules from anon;
grant select, insert, update, delete on public.shop_store_rules to authenticated;
grant select, insert, update, delete on public.shop_store_rules to service_role;
create index if not exists idx_shop_store_rules_user_store on public.shop_store_rules (user_id, store_id);
-- A deleted store takes its rules (ON DELETE CASCADE looks them up by store_id).
create index if not exists idx_shop_store_rules_store on public.shop_store_rules (store_id);

-- What a rule's source says: every fact the owner can edit (the store it belongs to never changes).
create or replace function public.shop_store_rule_facts(p public.shop_store_rules)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'kind', p.kind, 'label', p.label, 'days', p.days, 'member_tier', p.member_tier,
    'window_from', p.window_from, 'window_to', p.window_to, 'return_until', p.return_until,
    'exclusions', (select pg_catalog.to_jsonb(coalesce(pg_catalog.array_agg(distinct e order by e), '{}'::text[])) from pg_catalog.unnest(p.exclusions) e),
    'payout', p.payout, 'against', p.against,
    'against_stores', case when p.against_stores is null then null
                      else (select pg_catalog.to_jsonb(pg_catalog.array_agg(distinct s order by s)) from pg_catalog.unnest(p.against_stores) s) end,
    'words', p.words, 'source_url', p.source_url, 'read_on', p.read_on, 'off', p.off)
$$;

-- The doors (the header): what the owner, the assistant and a migration may do; a rule stays with its store, which
-- is the account's own, and a listed store is one of the account's own (a foreign key — or an id list — ignores
-- row level security); owner_edited derived.
create or replace function public.shop_store_rules_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_door  text := case when current_user in ('authenticated', 'anon') then 'owner'
                       when current_user = 'service_role' then 'service' else 'trusted' end;
  v_hosts text[];
begin
  if tg_op = 'DELETE' then
    if v_door = 'owner' and old.origin in ('seed', 'page') then
      raise exception 'A rule from the store''s own pages is turned off, not deleted (a later update would bring it back)' using errcode = '23514';
    end if;
    if v_door = 'service' and old.origin <> 'ask_ai' then
      raise exception 'The assistant may delete only rules it wrote itself' using errcode = '42501';
    end if;
    return old;
  end if;

  new.label := nullif(pg_catalog.btrim(new.label), '');
  new.member_tier := nullif(pg_catalog.btrim(new.member_tier), '');
  new.words := nullif(pg_catalog.btrim(new.words), '');
  new.exclusions := array(select distinct e from pg_catalog.unnest(coalesce(new.exclusions, '{}'::text[])) e order by 1);
  if new.against_stores is not null then
    new.against_stores := array(select distinct s from pg_catalog.unnest(new.against_stores) s order by 1);
  end if;
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    if new.store_id is distinct from old.store_id and v_door <> 'trusted' then
      raise exception 'A rule stays with its store — add it to the other store instead' using errcode = '23514';
    end if;
  else
    new.created_at := least(coalesce(new.created_at, pg_catalog.now()), pg_catalog.now());
  end if;

  select s.hosts into v_hosts from public.shop_stores s where s.id = new.store_id and s.user_id = new.user_id;
  if not found then
    raise exception 'A rule belongs to one of your own stores' using errcode = '23514';
  end if;
  if new.against_stores is not null and exists (
    select 1 from pg_catalog.unnest(new.against_stores) a
     where (tg_op = 'INSERT' or old.against_stores is null or not (a = any (old.against_stores)))
       and (a = new.store_id or not exists (select 1 from public.shop_stores s where s.id = a and s.user_id = new.user_id))
  ) then
    raise exception 'A price match is against your own other stores' using errcode = '23514';
  end if;
  if new.read_on > current_date + 1 then
    raise exception 'A source can''t be read in the future' using errcode = '22007';
  end if;

  if v_door = 'owner' then
    if tg_op = 'INSERT' then
      if new.origin is distinct from 'ask_ai' then new.origin := 'owner'; end if;
      new.seed_key := null;
      if new.origin <> 'ask_ai' then new.source_facts := null; end if;
    else
      new.origin := old.origin;
      new.seed_key := old.seed_key;
      if old.origin <> 'ask_ai' then new.source_facts := old.source_facts; end if;
    end if;
  elsif v_door = 'service' then
    -- The assistant: its own rules only, labelled as its own, citing only the store's own pages.
    if tg_op = 'UPDATE' and (old.origin <> 'ask_ai' or old.owner_edited) then
      raise exception 'The assistant may change only rules it wrote itself, and none you have edited' using errcode = '42501';
    end if;
    if new.source_url is not null and not public.shop_host_on(public.shop_link_host(new.source_url), v_hosts) then
      raise exception 'The assistant may cite only the store''s own pages' using errcode = '22023';
    end if;
    new.origin := 'ask_ai';
    new.seed_key := case when tg_op = 'UPDATE' then old.seed_key end;
    new.edited_at := null;
    new.source_facts := public.shop_store_rule_facts(new);
  end if;

  new.owner_edited := new.origin = 'owner'
    or (new.source_facts is not null and public.shop_store_rule_facts(new) is distinct from new.source_facts);
  if not new.owner_edited then
    new.edited_at := null;
  elsif tg_op = 'UPDATE' and public.shop_store_rule_facts(new) is distinct from public.shop_store_rule_facts(old)
        and new.edited_at is not distinct from old.edited_at then
    new.edited_at := pg_catalog.now();
  else
    new.edited_at := least(coalesce(new.edited_at, pg_catalog.now()), pg_catalog.now());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_shop_store_rules_rules on public.shop_store_rules;
create trigger trg_shop_store_rules_rules before insert or update or delete on public.shop_store_rules
  for each row execute function public.shop_store_rules_rules();
drop trigger if exists trg_shop_store_rules_updated_at on public.shop_store_rules;
create trigger trg_shop_store_rules_updated_at before update on public.shop_store_rules
  for each row execute function public.update_updated_at();

comment on table public.shop_store_rules is
  'A store''s rules, one row each, per account: open_purchase, return, seasonal_return, price_match, price_protection — with days, a member tier, a window (MM-DD), exclusions, the payout, the store''s words, its link and the day read. origin: seed, page, owner, ask_ai ("from Ask AI — check it").';
comment on column public.shop_store_rules.against_stores is 'price_match against listed stores: the account''s own store ids (checked when added; a deleted store''s id is left and ignored).';
comment on column public.shop_store_rules.window_from is 'seasonal_return: bought from this day of the year (MM-DD) …';
comment on column public.shop_store_rules.window_to is '… to this one (MM-DD; before window_from = it crosses the year end).';
comment on column public.shop_store_rules.return_until is 'seasonal_return: returned by this day of the year (MM-DD), the first one after window_to.';
comment on column public.shop_store_rules.source_facts is 'What the source (a seed, a page read or Ask AI) said, as the row''s facts: the reset goes back to it; a seed run writes it, and the facts follow only while owner_edited is false.';
comment on column public.shop_store_rules.owner_edited is 'Derived on every write: the owner made the rule, or its facts differ from source_facts. Never overwritten by a seed or a page read.';
comment on column public.shop_store_rules.off is 'The owner turned this rule off (a seeded rule is turned off, never deleted).';

-- Reset to the source: the facts go back to source_facts (so owner_edited goes false). Answers {"before", "after"},
-- the rows as they were and are, for the app's Undo. Runs as the caller.
create or replace function public.shop_store_rule_reset(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_old   public.shop_store_rules;
  v_src   public.shop_store_rules;
  v_after jsonb;
begin
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_old from public.shop_store_rules r where r.id = p_id and r.user_id = v_user for update;
  if not found then
    raise exception 'That rule is not there any more' using errcode = 'P0002';
  end if;
  if v_old.source_facts is null then
    raise exception 'You made this rule — it has no source to go back to' using errcode = '22023';
  end if;
  v_src := jsonb_populate_record(null::public.shop_store_rules, v_old.source_facts);
  update public.shop_store_rules r
     set kind = v_src.kind, label = v_src.label, days = v_src.days, member_tier = v_src.member_tier,
         window_from = v_src.window_from, window_to = v_src.window_to, return_until = v_src.return_until,
         exclusions = coalesce(v_src.exclusions, '{}'::text[]), payout = v_src.payout, against = v_src.against,
         against_stores = v_src.against_stores, words = v_src.words, source_url = v_src.source_url,
         read_on = v_src.read_on, off = coalesce(v_src.off, false)
   where r.id = p_id and r.user_id = v_user
  returning to_jsonb(r) into v_after;
  return jsonb_build_object('before', to_jsonb(v_old), 'after', v_after);
end;
$$;

-- The same for a store (its member tier and `hidden` stay: they are the owner's own).
create or replace function public.shop_store_reset(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_old   public.shop_stores;
  v_src   public.shop_stores;
  v_after jsonb;
begin
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_old from public.shop_stores s where s.id = p_id and s.user_id = v_user for update;
  if not found then
    raise exception 'That store is not there any more' using errcode = 'P0002';
  end if;
  if v_old.source_facts is null then
    raise exception 'You made this store — it has no source to go back to' using errcode = '22023';
  end if;
  v_src := jsonb_populate_record(null::public.shop_stores, v_old.source_facts);
  update public.shop_stores s
     set kind = v_src.kind, name = v_src.name, country = v_src.country, currency = v_src.currency, hosts = v_src.hosts,
         search_url = v_src.search_url, ad_template = v_src.ad_template, ad_language = v_src.ad_language,
         source_url = v_src.source_url, read_on = v_src.read_on
   where s.id = p_id and s.user_id = v_user
  returning to_jsonb(s) into v_after;
  return jsonb_build_object('before', to_jsonb(v_old), 'after', v_after);
end;
$$;

-- ─── 3. Norway's consumer law ────────────────────────────────────────────────
create table if not exists public.shop_law_rules (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z][a-z0-9_]{0,39}$'),
  country      text not null check (country = 'NO'),
  kind         text not null check (kind in ('cancel', 'complaint')),
  channel      text not null check (channel in ('distance', 'in_store', 'any')),
  seller       text not null check (seller in ('business', 'private')),
  gives_right  boolean not null,
  days         smallint check (days is null or days between 1 and 400),
  years        smallint check (years is null or years between 1 and 10),
  long_lasting boolean,
  counts_from  text check (counts_from is null or counts_from = 'receipt'),
  to_workday   boolean not null default false,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  summary      text not null check (char_length(btrim(summary)) between 1 and 600),
  law          text not null check (char_length(btrim(law)) between 1 and 200),
  law_url      text not null check (law_url ~ '^https://lovdata\.no/[^[:space:][:cntrl:]"<>`\\]*$' and char_length(law_url) <= 2048),
  checked_on   date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- A right to cancel has days when it gives one; a right to complain has years (and says whether it is the one for
  -- things meant to last much longer); a right counts from receipt.
  constraint shop_law_rules_shape check (
    (kind = 'cancel' and years is null and long_lasting is null and gives_right = (days is not null)
       and (counts_from is not null) = gives_right and (to_workday is false or gives_right))
    or (kind = 'complaint' and gives_right and days is null and years is not null and counts_from is not null and not to_workday))
);
alter table public.shop_law_rules enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_law_rules' and policyname = 'App users read law rules'
  ) then
    -- The same law for everyone: read for all signed in (the owner lock narrows it to app users), written only by
    -- migrations and the service role.
    create policy "App users read law rules" on public.shop_law_rules for select to authenticated using (true);
  end if;
end $$;
revoke all on public.shop_law_rules from anon, authenticated;
grant select on public.shop_law_rules to authenticated;
grant select, insert, update, delete on public.shop_law_rules to service_role;

drop trigger if exists trg_shop_law_rules_updated_at on public.shop_law_rules;
create trigger trg_shop_law_rules_updated_at before update on public.shop_law_rules
  for each row execute function public.update_updated_at();

-- The seeds (written 10.11.2026 from the laws as published on Lovdata; the names on screen English, the Norwegian
-- word after it):
--   cancel_distance_business  angrerettloven (LOV-2014-06-20-27): a purchase at a distance (online, by phone) or
--                             away from the shop, from a business — 14 days from the day the thing was received; a
--                             last day on a Saturday, Sunday or public holiday moves to the next working day.
--   cancel_in_store_business  the same law covers distance and off-premises sales only: a shop purchase has no right
--                             to cancel — only the store's own open purchase or returns.
--   cancel_private            the law covers a business selling to a consumer: none from a private seller (FINN).
--   complaint_business        forbrukerkjøpsloven § 27 (LOV-2002-06-21-34): 2 years from receipt …
--   complaint_business_long   … 5 years for a thing that, in normal use, is meant to last considerably longer.
--   complaint_private         kjøpsloven § 32 (LOV-1988-05-13-27): 2 years from receipt between private persons.
insert into public.shop_law_rules (slug, country, kind, channel, seller, gives_right, days, years, long_lasting, counts_from, to_workday, name, summary, law, law_url, checked_on) values
  ('cancel_distance_business', 'NO', 'cancel', 'distance', 'business', true, 14, null, null, 'receipt', true,
   'Right to cancel (angrerett)',
   'Bought online, by phone or away from the shop from a business: 14 days to cancel for any reason, from the day you got the thing. A last day on a Saturday, Sunday or public holiday moves to the next working day.',
   'Angrerettloven (LOV-2014-06-20-27)', 'https://lovdata.no/lov/2014-06-20-27', '2026-11-10'),
  ('cancel_in_store_business', 'NO', 'cancel', 'in_store', 'business', false, null, null, null, null, false,
   'No right to cancel in a shop',
   'Bought in a shop: the law gives no right to cancel. Only what the store itself offers counts (open purchase, returns).',
   'Angrerettloven (LOV-2014-06-20-27) — distance and off-premises sales only', 'https://lovdata.no/lov/2014-06-20-27', '2026-11-10'),
  ('cancel_private', 'NO', 'cancel', 'any', 'private', false, null, null, null, null, false,
   'No right to cancel from a private seller',
   'Bought from a private person (FINN, Tise): no right to cancel — the law covers purchases from a business.',
   'Angrerettloven (LOV-2014-06-20-27) — a business selling to a consumer', 'https://lovdata.no/lov/2014-06-20-27', '2026-11-10'),
  ('complaint_business', 'NO', 'complaint', 'any', 'business', true, null, 2, false, 'receipt', false,
   'Right to complain (reklamasjon)',
   'Bought from a business: 2 years from the day you got it to complain about a fault, within a reasonable time after you found it (two months is always in time).',
   'Forbrukerkjøpsloven § 27 (LOV-2002-06-21-34)', 'https://lovdata.no/lov/2002-06-21-34/§27', '2026-11-10'),
  ('complaint_business_long', 'NO', 'complaint', 'any', 'business', true, null, 5, true, 'receipt', false,
   'Right to complain (reklamasjon), 5 years',
   'Bought from a business, a thing that in normal use is meant to last considerably longer (a TV, a computer, a phone): 5 years from the day you got it.',
   'Forbrukerkjøpsloven § 27 (LOV-2002-06-21-34)', 'https://lovdata.no/lov/2002-06-21-34/§27', '2026-11-10'),
  ('complaint_private', 'NO', 'complaint', 'any', 'private', true, null, 2, null, 'receipt', false,
   'Right to complain from a private seller (reklamasjon)',
   'Bought from a private person: 2 years from the day you got it to complain about a fault, within a reasonable time after you found it. No 5-year rule.',
   'Kjøpsloven § 32 (LOV-1988-05-13-27)', 'https://lovdata.no/lov/1988-05-13-27/§32', '2026-11-10')
on conflict (slug) do nothing;

comment on table public.shop_law_rules is
  'Norway''s consumer law for purchases, one rule a row, each citing its law (angrerett, reklamasjon): reference data, the same for every account; written by migrations and the service role only.';
comment on column public.shop_law_rules.channel is 'distance = online, by phone or away from the shop; in_store = in a shop; any = both.';
comment on column public.shop_law_rules.long_lasting is 'complaint: true = the rule for things meant to last considerably longer (5 years), false = the others, null = one rule for all.';
comment on column public.shop_law_rules.to_workday is 'The last day moves to the next working day when it falls on a Saturday, Sunday or public holiday (src/features/shop/norwayHolidays.ts).';

-- ─── 4. Deal days the owner edits ────────────────────────────────────────────
create table if not exists public.shop_deal_day_edits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z][a-z0-9_]{0,39}$'),
  name        text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  rule_kind   text not null check (rule_kind in ('fixed', 'nth_weekday')),
  month       smallint not null check (month between 1 and 12),
  day         smallint check (day between 1 and 31),
  weekday     smallint check (weekday between 1 and 7),
  nth         smallint check (nth in (1, 2, 3, 4, -1)),
  offset_days smallint not null default 0 check (offset_days between -31 and 31),
  length_days smallint not null default 1 check (length_days between 1 and 31),
  off         boolean not null default false,
  source_url  text check (source_url is null or public.shop_https_ok(source_url)),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint shop_deal_day_edits_one unique (user_id, slug),
  -- 190's rule shapes: a fixed day every year has (no 29.02), or the n-th weekday of a month.
  constraint shop_deal_day_edits_rule_check check (
    (rule_kind = 'fixed' and weekday is null and nth is null and day is not null
      and day <= case month when 2 then 28 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end)
    or (rule_kind = 'nth_weekday' and day is null and weekday is not null and nth is not null))
);
alter table public.shop_deal_day_edits enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_deal_day_edits' and policyname = 'Users manage own shop_deal_day_edits'
  ) then
    create policy "Users manage own shop_deal_day_edits" on public.shop_deal_day_edits
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.shop_deal_day_edits from anon;
grant select, insert, update, delete on public.shop_deal_day_edits to authenticated;
grant select, insert, update, delete on public.shop_deal_day_edits to service_role;

drop trigger if exists trg_shop_deal_day_edits_updated_at on public.shop_deal_day_edits;
create trigger trg_shop_deal_day_edits_updated_at before update on public.shop_deal_day_edits
  for each row execute function public.update_updated_at();
drop trigger if exists trg_audit on public.shop_deal_day_edits;
create trigger trg_audit after insert or update or delete on public.shop_deal_day_edits
  for each row execute function public.log_audit();

comment on table public.shop_deal_day_edits is
  'The owner''s own version of a deal day, by slug: one of shop_deal_days'' slugs replaces that deal day for this account (off = turned off), any other is a deal day of the owner''s own. Reset = delete the row. shop_deal_days itself is never changed by the app.';

-- ─── 5. The seeds, into each account ─────────────────────────────────────────
-- Writes the seeded stores and rules into one account: a missing row is added; a row that is there gets the seed's
-- facts as its source, and the facts themselves only while the owner hasn't edited it. A seeded store whose web
-- address the account already has on a store of its own is left out (the owner's store wins), and its rules with
-- it. Answers how many rows it wrote (0 on a second run). For migrations only: no role may call it.
create or replace function public.shop_store_seed(p_user uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n      integer := 0;
  s      record;
  v_new  public.shop_stores;
  v_old  public.shop_stores;
  v_rnew public.shop_store_rules;
  v_rold public.shop_store_rules;
  v_src  jsonb;
  v_sid  uuid;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    return 0;
  end if;

  -- Stores: each with the page its facts come from and the day it was read (null = not read: the site answers apps
  -- with a bot check, docs/integrations/prisjakt.md, so only its own address is known).
  for s in select * from (values
    ('prisjakt', '{"kind": "price_site", "name": "Prisjakt", "country": "NO", "currency": "NOK", "hosts": ["prisjakt.no"],
                   "source_url": "https://www.prisjakt.no/information/brukervilkar", "read_on": "2026-11-10"}'::jsonb),
    ('finn', '{"kind": "marketplace", "name": "FINN", "country": "NO", "currency": "NOK", "hosts": ["finn.no"],
               "source_url": "https://www.finn.no/vilkar/brukervilkar-finn", "read_on": "2026-11-10"}'::jsonb),
    ('tise', '{"kind": "marketplace", "name": "Tise", "country": "NO", "currency": "NOK", "hosts": ["tise.com"],
               "source_url": "https://tise.com/terms", "read_on": "2026-11-10"}'::jsonb),
    ('elkjop', '{"kind": "shop", "name": "Elkjøp", "country": "NO", "currency": "NOK", "hosts": ["elkjop.no"],
                 "search_url": "https://www.elkjop.no/search?q={q}",
                 "source_url": "https://www.elkjop.no/product/tv-lyd-og-smarte-hjem/tv-og-tilbehor/tv/tcl-65-mqled75k-4k-mini-led-tv-2025/899848",
                 "read_on": "2026-11-10"}'::jsonb),
    ('power', '{"kind": "shop", "name": "Power", "country": "NO", "currency": "NOK", "hosts": ["power.no"],
                "source_url": "https://www.power.no/hjem-og-hage/rengjoering-og-stoevsuging/dampvasker/karcher-se-3-compact-home-tekstilrenser/p-4229993/",
                "read_on": "2026-11-10"}'::jsonb),
    ('jernia', '{"kind": "shop", "name": "Jernia", "country": "NO", "currency": "NOK", "hosts": ["jernia.no"],
                 "source_url": "https://www.jernia.no/produkter/12310223/mobel-og-tepperenser-se-3-compact", "read_on": "2026-11-10"}'::jsonb),
    ('komplett', '{"kind": "shop", "name": "Komplett", "country": "NO", "currency": "NOK", "hosts": ["komplett.no"],
                   "source_url": "https://www.komplett.no/"}'::jsonb),
    ('proshop', '{"kind": "shop", "name": "Proshop", "country": "NO", "currency": "NOK", "hosts": ["proshop.no"],
                  "source_url": "https://www.proshop.no/"}'::jsonb),
    ('clas_ohlson', '{"kind": "shop", "name": "Clas Ohlson", "country": "NO", "currency": "NOK", "hosts": ["clasohlson.com"],
                      "source_url": "https://www.clasohlson.com/no/"}'::jsonb),
    ('xxl', '{"kind": "shop", "name": "XXL", "country": "NO", "currency": "NOK", "hosts": ["xxl.no"],
              "source_url": "https://www.xxl.no/"}'::jsonb),
    ('jula', '{"kind": "shop", "name": "Jula", "country": "NO", "currency": "NOK", "hosts": ["jula.no"],
               "source_url": "https://www.jula.no/"}'::jsonb),
    ('dustin', '{"kind": "shop", "name": "Dustin", "country": "NO", "currency": "NOK", "hosts": ["dustin.no"],
                 "source_url": "https://www.dustin.no/"}'::jsonb)
  ) v(key, facts) loop
    v_new := jsonb_populate_record(null::public.shop_stores, s.facts);
    v_src := public.shop_store_facts(v_new);
    select * into v_old from public.shop_stores t where t.user_id = p_user and t.seed_key = s.key for update;
    if not found then
      if exists (select 1 from public.shop_stores t where t.user_id = p_user and t.hosts && v_new.hosts) then
        continue;
      end if;
      insert into public.shop_stores (user_id, seed_key, origin, kind, name, country, currency, hosts, search_url,
                                      ad_template, ad_language, source_url, read_on, source_facts)
      values (p_user, s.key, 'seed', v_new.kind, v_new.name, v_new.country, v_new.currency, v_new.hosts, v_new.search_url,
              v_new.ad_template, v_new.ad_language, v_new.source_url, v_new.read_on, v_src);
      n := n + 1;
    elsif v_old.source_facts is distinct from v_src then
      if v_old.owner_edited then
        update public.shop_stores t set source_facts = v_src where t.id = v_old.id;
      else
        update public.shop_stores t
           set source_facts = v_src, kind = v_new.kind, name = v_new.name, country = v_new.country, currency = v_new.currency,
               hosts = v_new.hosts, search_url = v_new.search_url, ad_template = v_new.ad_template,
               ad_language = v_new.ad_language, source_url = v_new.source_url, read_on = v_new.read_on
         where t.id = v_old.id;
      end if;
      n := n + 1;
    end if;
  end loop;

  -- Rules: only what a store's own page said (read 10.11.2026), in its own words.
  for s in select * from (values
    ('elkjop_open_purchase', 'elkjop', '{"kind": "open_purchase", "days": 30,
       "words": "30-dagers åpent kjøp med uåpnet emballasje. Åpnet, men ubrukt emballasje kan returneres innen 14 dager hvis produkttypen tillater det.",
       "source_url": "https://www.elkjop.no/product/tv-lyd-og-smarte-hjem/tv-og-tilbehor/tv/tcl-65-mqled75k-4k-mini-led-tv-2025/899848",
       "read_on": "2026-11-10"}'::jsonb),
    ('elkjop_open_purchase_club', 'elkjop', '{"kind": "open_purchase", "days": 50, "member_tier": "Kundeklubb",
       "words": "50 dagers åpent kjøp med uåpnet emballasje. Åpnet, men ubrukt emballasje kan returneres innen 14 dager hvis produkttypen tillater det.",
       "source_url": "https://www.elkjop.no/product/tv-lyd-og-smarte-hjem/tv-og-tilbehor/tv/tcl-65-mqled75k-4k-mini-led-tv-2025/899848",
       "read_on": "2026-11-10"}'::jsonb),
    ('power_return', 'power', '{"kind": "return", "days": 90,
       "source_url": "https://www.power.no/hjem-og-hage/rengjoering-og-stoevsuging/dampvasker/karcher-se-3-compact-home-tekstilrenser/p-4229993/",
       "read_on": "2026-11-10"}'::jsonb)
  ) v(key, store_key, facts) loop
    select t.id into v_sid from public.shop_stores t where t.user_id = p_user and t.seed_key = s.store_key;
    if not found then
      continue;
    end if;
    v_rnew := jsonb_populate_record(null::public.shop_store_rules, s.facts || '{"exclusions": [], "off": false}'::jsonb);
    v_src := public.shop_store_rule_facts(v_rnew);
    select * into v_rold from public.shop_store_rules r where r.user_id = p_user and r.seed_key = s.key for update;
    if not found then
      insert into public.shop_store_rules (user_id, store_id, seed_key, origin, kind, label, days, member_tier, window_from,
                                           window_to, return_until, exclusions, payout, against, against_stores, words,
                                           source_url, read_on, off, source_facts)
      values (p_user, v_sid, s.key, 'seed', v_rnew.kind, v_rnew.label, v_rnew.days, v_rnew.member_tier, v_rnew.window_from,
              v_rnew.window_to, v_rnew.return_until, v_rnew.exclusions, v_rnew.payout, v_rnew.against, v_rnew.against_stores,
              v_rnew.words, v_rnew.source_url, v_rnew.read_on, v_rnew.off, v_src);
      n := n + 1;
    elsif v_rold.source_facts is distinct from v_src then
      if v_rold.owner_edited then
        update public.shop_store_rules r set source_facts = v_src where r.id = v_rold.id;
      else
        update public.shop_store_rules r
           set source_facts = v_src, kind = v_rnew.kind, label = v_rnew.label, days = v_rnew.days, member_tier = v_rnew.member_tier,
               window_from = v_rnew.window_from, window_to = v_rnew.window_to, return_until = v_rnew.return_until,
               exclusions = v_rnew.exclusions, payout = v_rnew.payout, against = v_rnew.against,
               against_stores = v_rnew.against_stores, words = v_rnew.words, source_url = v_rnew.source_url,
               read_on = v_rnew.read_on, off = v_rnew.off
         where r.id = v_rold.id;
      end if;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- An account added to the allow-list later (the SQL editor) gets the seeds too. SECURITY DEFINER: the seed runs as
-- this function's owner whoever adds the account, for that account only.
create or replace function public.shop_store_seed_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.shop_store_seed(new.user_id);
  return null;
end;
$$;
drop trigger if exists trg_shop_store_seed on public.app_allowed_users;
create trigger trg_shop_store_seed after insert on public.app_allowed_users
  for each row execute function public.shop_store_seed_new_user();

select public.shop_store_seed(a.user_id) from public.app_allowed_users a;

-- Audited from here on (the owner's edits; Activity can undo them — one id primary key each).
drop trigger if exists trg_audit on public.shop_stores;
create trigger trg_audit after insert or update or delete on public.shop_stores
  for each row execute function public.log_audit();
drop trigger if exists trg_audit on public.shop_store_rules;
create trigger trg_audit after insert or update or delete on public.shop_store_rules
  for each row execute function public.log_audit();

-- ─── 6. Grants on the functions ──────────────────────────────────────────────
-- The checks run inside the tables' CHECK constraints, as whoever writes.
revoke all on function public.shop_host_ok(text) from public, anon;
revoke all on function public.shop_hosts_ok(text[]) from public, anon;
revoke all on function public.shop_https_ok(text) from public, anon;
revoke all on function public.shop_link_host(text) from public, anon;
revoke all on function public.shop_host_on(text, text[]) from public, anon;
revoke all on function public.shop_search_url_ok(text, text[]) from public, anon;
revoke all on function public.shop_month_day_ok(text) from public, anon;
revoke all on function public.shop_store_facts(public.shop_stores) from public, anon;
revoke all on function public.shop_store_rule_facts(public.shop_store_rules) from public, anon;
grant execute on function public.shop_host_ok(text) to authenticated, service_role;
grant execute on function public.shop_hosts_ok(text[]) to authenticated, service_role;
grant execute on function public.shop_https_ok(text) to authenticated, service_role;
grant execute on function public.shop_link_host(text) to authenticated, service_role;
grant execute on function public.shop_host_on(text, text[]) to authenticated, service_role;
grant execute on function public.shop_search_url_ok(text, text[]) to authenticated, service_role;
grant execute on function public.shop_month_day_ok(text) to authenticated, service_role;
grant execute on function public.shop_store_facts(public.shop_stores) to authenticated, service_role;
grant execute on function public.shop_store_rule_facts(public.shop_store_rules) to authenticated, service_role;
-- Trigger functions and the seed: nobody calls them.
revoke all on function public.shop_stores_rules() from public, anon, authenticated, service_role;
revoke all on function public.shop_store_rules_rules() from public, anon, authenticated, service_role;
revoke all on function public.shop_store_seed_new_user() from public, anon, authenticated, service_role;
revoke all on function public.shop_store_seed(uuid) from public, anon, authenticated, service_role;
-- The resets: the app's, for app users (each checks is_app_user itself).
revoke all on function public.shop_store_rule_reset(uuid) from public, anon;
revoke all on function public.shop_store_reset(uuid) from public, anon;
grant execute on function public.shop_store_rule_reset(uuid) to authenticated;
grant execute on function public.shop_store_reset(uuid) to authenticated;

select public.owner_lock_apply('public.shop_stores');
select public.owner_lock_apply('public.shop_store_rules');
select public.owner_lock_apply('public.shop_law_rules');
select public.owner_lock_apply('public.shop_deal_day_edits');
