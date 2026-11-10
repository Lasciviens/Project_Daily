-- 188 · Shop: sites whose terms forbid automated reading, and the condition of a price (Shop phase 1, 10.11.2026).
--
-- 1. shop_site_policies — a small reference table of sites shop-price must never read. FINN's terms (§ 6) and its
--    robots.txt forbid robots without written consent; Tise's terms forbid scraping and bots. Until now shop-price's
--    read, check and the daily sweep read any pasted link, a FINN ad included (and the sweep would have read it every
--    day). The sites are data, not code (owner, 10.11.2026: no store names hardcoded); a later phase folds this into
--    stores. A row: host (a link is on it when its host is that host or a subdomain of it — "m.finn.no" is on
--    finn.no; shop-price matches, priceRead.ts's listedSite), the flag, the reason, where it says so, the day checked.
--    · No user_id: shared reference data about sites, the same for every account (like fx_rates_nok). App users
--      read it (owner lock); only migrations and the service role write it (no browser policy or grant for writes).
--    · No audit trigger: not user-authored — written only by migrations (its history is git) and the service role.
--    · One id primary key, host unique (an audit could be added later without changing the key).
--    Seeded with finn.no and tise.com.
-- 2. shop_price_watch.status gains 'not_allowed': the link's site is listed, so shop-price never fetched it (on any
--    redirect hop either). The last price read before stays, as after any check that read nothing.
-- 3. The condition of a price. Prisjakt's schema.org figures (AggregateOffer) mix new, refurbished and used offers;
--    its page's own offer list marks each one (verified live on 10.11.2026). A price now is read from new offers only,
--    and each watch and price point says what its price covers (`condition`):
--      'new'     Prisjakt's offer list, new offers only;
--      'mixed'   Prisjakt's schema.org figures, when its page carries no offer list — new, used and refurbished alike;
--      'unknown' a shop's own page, which doesn't say;
--      NULL      read before 188 — a Prisjakt price then may be a used or refurbished one: a later "lowest seen"
--                leaves those out.
--    used_low / refurbished_low: the cheapest used / refurbished offer in Prisjakt's list (evidence for resale), on
--    the watch and on each point. The checks keep NaN and infinity out (NaN >= 0 is true in Postgres).
-- 4. shop_restore_price_history (187) carries the new columns through Delete's Undo, checked like the others.
--
-- Changes no row. Safe to re-run. No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── 1. Sites that may not be read ───────────────────────────────────────────
create table if not exists public.shop_site_policies (
  id                   uuid primary key default gen_random_uuid(),
  host                 text not null unique
                       check (host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(host) <= 253),
  no_automated_reading boolean not null default true,
  reason               text not null check (char_length(btrim(reason)) between 1 and 500),
  source_url           text not null check (source_url ~ '^https://[^[:space:]]+$' and char_length(source_url) <= 2048),
  checked_on           date not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.shop_site_policies enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_site_policies' and policyname = 'App users read site policies'
  ) then
    -- Reference data about sites, the same for everyone: read for all signed in (the owner lock narrows it to app
    -- users), written only by migrations and the service role.
    create policy "App users read site policies" on public.shop_site_policies for select to authenticated using (true);
  end if;
end $$;
revoke all on public.shop_site_policies from anon, authenticated;
grant select on public.shop_site_policies to authenticated;
grant select, insert, update, delete on public.shop_site_policies to service_role;

drop trigger if exists trg_shop_site_policies_updated_at on public.shop_site_policies;
create trigger trg_shop_site_policies_updated_at before update on public.shop_site_policies
  for each row execute function public.update_updated_at();

insert into public.shop_site_policies (host, no_automated_reading, reason, source_url, checked_on) values
  ('finn.no', true, 'FINN''s terms (§ 6) and its robots.txt forbid robots and other automated reading without written consent.',
   'https://www.finn.no/vilkar/brukervilkar-finn', '2026-11-10'),
  ('tise.com', true, 'Tise''s terms forbid scraping and bots.', 'https://tise.com/terms', '2026-11-10')
on conflict (host) do nothing;

comment on table public.shop_site_policies is
  'Sites shop-price never reads (their terms forbid automated reading): a link is on one when its host is that host or a subdomain of it. Reference data, the same for every account; written by migrations and the service role only.';
comment on column public.shop_site_policies.no_automated_reading is
  'True: shop-price never fetches a link on this site (read, check, the daily sweep, any redirect hop) and says so (status not_allowed).';

-- ─── 2 and 3. The price watch: not_allowed, and what a price covers ─────────
alter table public.shop_price_watch drop constraint if exists shop_price_watch_status_check;
alter table public.shop_price_watch add constraint shop_price_watch_status_check
  check (status in ('ok', 'no_price', 'blocked', 'error', 'not_allowed'));

alter table public.shop_price_watch add column if not exists condition text;
alter table public.shop_price_watch add column if not exists used_low numeric;
alter table public.shop_price_watch add column if not exists refurbished_low numeric;
alter table public.shop_price_points add column if not exists condition text;
alter table public.shop_price_points add column if not exists used_low numeric;
alter table public.shop_price_points add column if not exists refurbished_low numeric;

alter table public.shop_price_watch drop constraint if exists shop_price_watch_condition_check;
alter table public.shop_price_watch add constraint shop_price_watch_condition_check
  check (condition is null or condition in ('new', 'mixed', 'unknown'));
alter table public.shop_price_watch drop constraint if exists shop_price_watch_used_low_check;
alter table public.shop_price_watch add constraint shop_price_watch_used_low_check
  check (used_low is null or (used_low >= 0 and used_low < 'Infinity'));
alter table public.shop_price_watch drop constraint if exists shop_price_watch_refurbished_low_check;
alter table public.shop_price_watch add constraint shop_price_watch_refurbished_low_check
  check (refurbished_low is null or (refurbished_low >= 0 and refurbished_low < 'Infinity'));
alter table public.shop_price_points drop constraint if exists shop_price_points_condition_check;
alter table public.shop_price_points add constraint shop_price_points_condition_check
  check (condition is null or condition in ('new', 'mixed', 'unknown'));
alter table public.shop_price_points drop constraint if exists shop_price_points_used_low_check;
alter table public.shop_price_points add constraint shop_price_points_used_low_check
  check (used_low is null or (used_low >= 0 and used_low < 'Infinity'));
alter table public.shop_price_points drop constraint if exists shop_price_points_refurbished_low_check;
alter table public.shop_price_points add constraint shop_price_points_refurbished_low_check
  check (refurbished_low is null or (refurbished_low >= 0 and refurbished_low < 'Infinity'));

comment on column public.shop_price_watch.condition is
  'What low/high/offers cover: new (Prisjakt''s offer list, new offers only), mixed (Prisjakt''s schema.org figures: new, used and refurbished alike), unknown (a shop''s own page); NULL = read before 188.';
comment on column public.shop_price_watch.used_low is 'The cheapest used offer in Prisjakt''s offer list at the last read that had the list.';
comment on column public.shop_price_watch.refurbished_low is 'The cheapest refurbished offer in Prisjakt''s offer list at the last read that had the list.';
comment on column public.shop_price_points.condition is
  'What this point''s low covers (as shop_price_watch.condition); NULL = read before 188, when a Prisjakt low could be a used or refurbished price.';
comment on column public.shop_price_points.used_low is 'The cheapest used offer in Prisjakt''s offer list at this read.';
comment on column public.shop_price_points.refurbished_low is 'The cheapest refurbished offer in Prisjakt''s offer list at this read.';

-- ─── 4. Delete's Undo carries them (187's helper, with the new columns) ─────
-- The price watch and its history of the rows Delete's Undo just put back. Those tables are written by
-- shop-price only (the browser has no write on them), so this writes only for the rows this same
-- shop_restore_items call re-inserted — it lists their ids in the transaction-local setting
-- app.shop_restored, which the browser can't set (PostgREST exposes no set_config; 185 refuses it in the
-- read query and 189 watches it there), so a direct call writes nothing. The list counts only with this
-- transaction's own stamp (its id and start time) in front: a value left on a pooled connection by an
-- earlier request never matches. Then it checks what it is given: the caller's own account on every row,
-- web links only, a price from 0 below infinity (NaN sorts above infinity, so it goes too), a count from
-- 0 to 100 000, a known condition, no time in the future and none made up, at most the newest 20 000 points.
create or replace function public.shop_restore_price_history(p_watches jsonb, p_points jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_stamp text := pg_catalog.txid_current()::text || '/' || extract(epoch from pg_catalog.now())::text;
  v_set   text := coalesce(pg_catalog.current_setting('app.shop_restored', true), '');
  v_back  uuid[];
  n       integer := 0;
  k       integer;
begin
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_watches, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_points, '[]'::jsonb)) <> 'array' then
    raise exception 'Not a price history' using errcode = '22023';
  end if;
  if pg_catalog.split_part(v_set, '|', 1) = v_stamp then
    v_back := pg_catalog.string_to_array(nullif(pg_catalog.split_part(v_set, '|', 2), ''), ',')::uuid[];
  end if;
  insert into public.shop_price_watch (item_id, user_id, url, checked_at, status, error, source, name, image, low, high,
                                       offers, currency, in_stock, was, return_days, last_ok_at, prev_low, prev_at,
                                       condition, used_low, refurbished_low)
  select w.item_id, v_user, public.shop_web_link(w.url), least(w.checked_at, now()), w.status, left(w.error, 500),
         case when w.source in ('prisjakt', 'store') then w.source end, left(w.name, 300), public.shop_web_link(w.image),
         case when w.low >= 0 and w.low < 'Infinity' then w.low end,
         case when w.high >= 0 and w.high < 'Infinity' then w.high end,
         case when w.offers between 0 and 100000 then w.offers end,
         case when w.currency ~ '^[A-Z]{3}$' then w.currency end, w.in_stock,
         case when w.was >= 0 and w.was < 'Infinity' then w.was end,
         case when w.return_days between 0 and 100000 then w.return_days end,
         case when w.last_ok_at is null then null else least(w.last_ok_at, now()) end,
         case when w.prev_low >= 0 and w.prev_low < 'Infinity' then w.prev_low end,
         case when w.prev_at is null then null else least(w.prev_at, now()) end,
         case when w.condition in ('new', 'mixed', 'unknown') then w.condition end,
         case when w.used_low >= 0 and w.used_low < 'Infinity' then w.used_low end,
         case when w.refurbished_low >= 0 and w.refurbished_low < 'Infinity' then w.refurbished_low end
    from jsonb_populate_recordset(null::public.shop_price_watch, coalesce(p_watches, '[]'::jsonb)) w
   where w.item_id = any (v_back)
     and exists (select 1 from public.shop_items i where i.id = w.item_id and i.user_id = v_user)
  on conflict (item_id) do nothing;
  get diagnostics k = row_count;
  n := n + k;
  insert into public.shop_price_points (id, user_id, item_id, checked_at, low, high, offers, currency, source,
                                        condition, used_low, refurbished_low)
  select coalesce(p.id, gen_random_uuid()), v_user, p.item_id, least(p.checked_at, now()), p.low,
         case when p.high >= 0 and p.high < 'Infinity' then p.high end,
         case when p.offers between 0 and 100000 then p.offers end,
         case when p.currency ~ '^[A-Z]{3}$' then p.currency end, case when p.source in ('prisjakt', 'store') then p.source end,
         case when p.condition in ('new', 'mixed', 'unknown') then p.condition end,
         case when p.used_low >= 0 and p.used_low < 'Infinity' then p.used_low end,
         case when p.refurbished_low >= 0 and p.refurbished_low < 'Infinity' then p.refurbished_low end
    from (select x.* from jsonb_populate_recordset(null::public.shop_price_points, coalesce(p_points, '[]'::jsonb)) x
           where x.item_id = any (v_back) and x.checked_at is not null and x.low >= 0 and x.low < 'Infinity'
             and exists (select 1 from public.shop_items i where i.id = x.item_id and i.user_id = v_user)
           order by x.checked_at desc
           limit 20000) p
  on conflict (id) do nothing;
  get diagnostics k = row_count;
  return n + k;
end;
$$;

revoke all on function public.shop_restore_price_history(jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.shop_restore_price_history(jsonb, jsonb) to authenticated;
comment on function public.shop_restore_price_history(jsonb, jsonb) is
  'Delete''s Undo of the price watch and its history: only for the rows that same shop_restore_items call put back (app.shop_restored; a direct call writes nothing), every field checked, the price''s condition (188) too.';

select public.owner_lock_apply('public.shop_site_policies');
