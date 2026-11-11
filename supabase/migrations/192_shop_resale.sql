-- 192 · Shop: resale and selling — ad notes, trade-in quotes, value history, listings, ad templates and hand-over
-- checklists (Shop step C, data side; the owner approved the plan on 10.11.2026).
--
-- 1. shop_ad_notes — "+ Note an ad": an ad for the same thing that the owner saw and pasted by hand — its link, its
--    price, the marketplace, the condition, the day it was noted, and `asking` (true: what the seller asks — "asking,
--    not sold"; false: what it sold for). Evidence for what a thing could sell for (src/features/shop/resaleEvidence.ts).
--    · The link is https only and is NEVER fetched: no function reads this table (shop-price reads shop_items.url
--      only, and FINN's and Tise's terms forbid automated reading — 188). It is a link the owner opens, shown with
--      its address. One web address: https://, a host of letters, digits, dots and hyphens (so no user:password@),
--      then only printable ASCII (an allow-list: no space, control, invisible or direction-changing character —
--      the app sends a link as the browser's URL parser writes it, which encodes those), at most 2 048 characters;
--      when the marketplace is named, the link's host is
--      that host or a subdomain of it (www.finn.no is on finn.no). The column is `ad_url`, never `url`: the
--      assistant may not write it (AI_NO_WRITE), while it may still write shop_items.url.
-- 2. shop_trade_in_quotes — a trade-in quote the owner typed (a dealer's offer: the floor of what a thing fetches).
-- 3. shop_value_history — every "Could sell for" (shop_items.value_now / value_currency / value_on) with its day,
--    kept from now on. Written by the database for every writer (web, the assistant, edge functions): an AFTER
--    trigger on shop_items, one row per thing and day (the latest estimate of that day). A thing added with an
--    estimate gets its row when the transaction ends (a deferred trigger, on conflict nothing): a restore — Delete's
--    Undo, Activity's Undo — puts the thing back first and its own history rows after it, and those win. The
--    history holds the estimates the record held, and a change takes back only what the previous estimate held: an
--    estimate moved to an earlier day — an Undo or a correction — takes back its own day's row, a cleared estimate
--    likewise (an Undo of a first estimate leaves nothing behind); every other row stays, so no single write — one
--    the assistant was steered into, say — can wipe the history (security review, 10.11.2026). An estimate of a
--    billion or more (or no number) is left out. Estimates from before 192 are not in it (the app adds the thing's
--    current one when the history has none).
-- 4. shop_listings — selling a thing: Listed (the ad is written, not up yet) → For sale (the ad is up; the days on
--    sale count from for_sale_on) → Sold, or Withdrawn (taken down unsold). The price story is `prices`, dated price
--    changes oldest first ({"on": "2026-11-10", "price": 2400}, the first the asking price when listed, the last the
--    price now; 1–100 entries, in order, each from the listing's day up to today). One currency per listing. At most
--    one open (listed or for sale) listing per thing, and only for a thing you have (bought, not gone).
--    · Sold comes from the sale itself (selling never deletes: shop_record_sale writes the disposal facts): the
--      same trigger on shop_items closes the thing's open listing when it leaves — Sold when it was sold, Withdrawn
--      when it went another way — on the day it left (never before the listing's own days, never after today),
--      marked closed_by_sale; when the sale is undone (disposal back to none) a listing the sale closed opens again
--      as it was (For sale, or Listed). A listing is Sold only while its thing is sold, and open only while the thing
--      is yours — checked when the transaction ends (a deferred constraint trigger, as 187's sale groups), so
--      Activity's Undo, which puts a sale's rows back one by one, newest change first, passes through a moment where
--      the listing is back before the thing.
--    · `prices` lives on the row (jsonb), not in a table of its own: Shop's Delete with Undo brings back the rows of
--      tables that point at shop_items (point 16 of docs/backend/database.md), never rows of a table that points at
--      a listing, so a price story in its own table would be lost by an Undo.
--    · ad_url: the ad's link once it is up — the same rules as an ad note's (never fetched, AI_NO_WRITE). ad_text,
--      the ad as written, is the owner's alone too (AI_NO_WRITE): the owner copies it into FINN as it stands.
-- 5. shop_ad_templates — the ad's text per marketplace (and optionally per category), the owner's own rows to edit:
--    a title and a body with {name}, {condition}, {bought}, {price} and {accessories} (filled by
--    src/features/shop/resaleTexts.ts; a line whose field is empty is left out). A language per template ('nb' or
--    'en'). One per account, marketplace (none = any other) and category (none = any), names compared without case.
--    Seeded in Norwegian (owner, 10.11.2026: ad texts in Norwegian, one template per marketplace, editable): finn.no,
--    tise.com and one for any other marketplace.
-- 6. shop_handover_checklists — what to do before handing a thing over, per category, the owner's own rows to edit:
--    `steps`, one per line. Seeded for Phones, Game Consoles and Computers & Laptops (the taxonomy's and 030's names;
--    the app matches a thing's category to them as it matches suggestions — case, spaces, "&"/"and" and other names
--    for the same thing). In English: the owner reads them in the app (AGENTS.md: English everywhere; only the ad
--    texts are Norwegian, by the owner's decision).
--    · shop_add_resale_defaults() adds the default templates and checklists the caller has none of (an account
--      added later, or after deleting one) — never one the owner already has, edited or not.
--
-- Marketplaces are keyed by text, not by a store id. Migration 191 (stores, built in parallel) makes every store and
-- marketplace a row; 192 must not depend on it, and its seeds need a key that exists now. `marketplace` is the
-- marketplace's host in shop_site_policies' form (188: finn.no, tise.com), or none. A later migration, once 191 has
-- landed, adds store_id with its foreign key to shop_stores and fills it from the host.
--
-- Bounds (security review, 10.11.2026): a text's length counts every character and it needs one that is not a space
-- (so a megabyte of spaces is no title); an amount is from 0 below a billion; a listing's price has at most two
-- decimals.
--
-- Every table: the account's own rows (user_id with auth.uid() by default, the owner policy, the owner lock),
-- audited (trg_audit — Developer → Activity can undo them; one id primary key), grants for the app and the service
-- role, none for anon. A row about a thing (ad notes, quotes, value history, listings) is about one of the account's
-- own things, whoever writes it (a trigger — a foreign key ignores row level security), refused with a foreign key's
-- code (23503) so a restore that puts the thing back later in the same Undo retries the row then; a deleted thing
-- takes its rows (ON DELETE CASCADE) and Shop's Delete with Undo puts them back as the caller (the app may insert them).
--
-- shop_items' new AFTER trigger (value history, listings) fires after trg_audit (same-event triggers fire in name
-- order): the thing's own change is logged first and what the trigger changes after it, so Activity's Undo — which
-- takes a save back newest change first — puts the history and the listing back by their own audit rows, and then
-- the thing, whose trigger finds them already as they were (it writes a history row only when it differs). It
-- changes nothing when neither "Could sell for" nor how the thing left changed — so deleting an account (cascades
-- and SET NULL updates) never reaches it with an insert for a vanishing user.
--
-- 7. Two older rules refuse with a foreign key's code too. 187's shop_item_costs_rules ("A cost belongs to one of your
--    own items") and 190's shop_signal_states_rules ("Needs a look remembers only your own things") refused a row
--    whose thing is not (yet) the account's own with a check violation (23514), so Activity's Undo of a Shop delete
--    — which puts rows back table by table and retries only a foreign key's or a unique key's refusal in a later
--    round — stopped at a thing's extra cost or snoozed Needs-a-look row before the thing itself was back. Both are
--    re-created word for word but for that one code (23503); every other refusal of theirs keeps its own. Shop's
--    own Delete with Undo was not affected (it puts the thing back before its rows), and another account's thing
--    is refused as before.
--
-- Functions: search_path '', SECURITY INVOKER (row level security and the owner lock apply), granted to signed-in
-- callers only where the app calls them. Safe to re-run. Writes rows only for the seeds (each app user's default
-- templates and checklists, those they lack). No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── Helpers ─────────────────────────────────────────────────────────────────
-- Whether a link (already checked to be one https:// address) is on a host or a subdomain of it.
create or replace function public.shop_link_on_host(p_url text, p_host text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(x.h = p_host
                  or (char_length(x.h) > char_length(p_host) and right(x.h, char_length(p_host) + 1) = '.' || p_host), false)
    from (select lower(substring(p_url from '^https://([A-Za-z0-9.-]+)')) as h) x
$$;

-- ─── 1. Ad notes ─────────────────────────────────────────────────────────────
create table if not exists public.shop_ad_notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id      uuid not null references public.shop_items(id) on delete cascade,
  ad_url       text not null check (ad_url ~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][!-~]*)?$'
                                    and char_length(ad_url) <= 2048),
  marketplace  text check (marketplace is null or (marketplace ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
                                                   and char_length(marketplace) <= 253)),
  price        numeric not null check (price >= 0 and price < 1000000000),
  currency     text not null default 'NOK' check (currency in ('NOK', 'TRY', 'EUR', 'USD')),
  condition    text check (condition is null or condition in ('new', 'like_new', 'good', 'fair', 'for_parts')),
  asking       boolean not null default true,
  noted_on     date not null default ((now() at time zone 'Europe/Oslo')::date) check (noted_on >= date '2000-01-01'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.shop_ad_notes enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_ad_notes' and policyname = 'Users manage own shop_ad_notes'
  ) then
    create policy "Users manage own shop_ad_notes" on public.shop_ad_notes
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.shop_ad_notes from anon;
grant select, insert, update, delete on public.shop_ad_notes to authenticated;
grant select, insert, update, delete on public.shop_ad_notes to service_role;
create index if not exists idx_shop_ad_notes_user_item on public.shop_ad_notes (user_id, item_id);
create index if not exists idx_shop_ad_notes_item on public.shop_ad_notes (item_id);

comment on table public.shop_ad_notes is
  'An ad for the same thing the owner noted by hand ("+ Note an ad"): its link (never fetched), price, marketplace, condition and day. Evidence for "Could sell for".';
comment on column public.shop_ad_notes.ad_url is 'The ad''s link, https only — never fetched by anything (the owner opens it). On the marketplace''s host when one is named.';
comment on column public.shop_ad_notes.marketplace is 'The marketplace''s host (finn.no, tise.com — shop_site_policies'' form), or null. A store id joins it once migration 191''s stores have landed.';
comment on column public.shop_ad_notes.asking is 'True: the price is what the seller asks (asking, not sold). False: what it sold for.';

-- ─── 2. Trade-in quotes ──────────────────────────────────────────────────────
create table if not exists public.shop_trade_in_quotes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id     uuid not null references public.shop_items(id) on delete cascade,
  dealer      text not null check (char_length(dealer) <= 120 and dealer ~ '\S'),
  amount      numeric not null check (amount >= 0 and amount < 1000000000),
  currency    text not null default 'NOK' check (currency in ('NOK', 'TRY', 'EUR', 'USD')),
  condition   text check (condition is null or condition in ('new', 'like_new', 'good', 'fair', 'for_parts')),
  quoted_on   date not null default ((now() at time zone 'Europe/Oslo')::date) check (quoted_on >= date '2000-01-01'),
  note        text check (note is null or char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.shop_trade_in_quotes enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_trade_in_quotes' and policyname = 'Users manage own shop_trade_in_quotes'
  ) then
    create policy "Users manage own shop_trade_in_quotes" on public.shop_trade_in_quotes
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.shop_trade_in_quotes from anon;
grant select, insert, update, delete on public.shop_trade_in_quotes to authenticated;
grant select, insert, update, delete on public.shop_trade_in_quotes to service_role;
create index if not exists idx_shop_trade_in_quotes_user_item on public.shop_trade_in_quotes (user_id, item_id);
create index if not exists idx_shop_trade_in_quotes_item on public.shop_trade_in_quotes (item_id);

comment on table public.shop_trade_in_quotes is
  'A trade-in quote the owner typed: what a dealer offered for a thing (the floor of what it fetches), on a day, for a condition.';
comment on column public.shop_trade_in_quotes.dealer is 'Who offered it (a store''s name, as typed). A store id joins it once migration 191''s stores have landed.';

-- ─── 3. Value history ────────────────────────────────────────────────────────
create table if not exists public.shop_value_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id     uuid not null references public.shop_items(id) on delete cascade,
  valued_on   date not null check (valued_on >= date '2000-01-01' and valued_on < date '2100-01-01'),
  value       numeric not null check (value >= 0 and value < 1000000000),
  currency    text not null default 'NOK' check (currency in ('NOK', 'TRY', 'EUR', 'USD')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One estimate per thing and day (the latest of that day).
  constraint shop_value_history_one_a_day unique (item_id, valued_on)
);
alter table public.shop_value_history enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_value_history' and policyname = 'Users manage own shop_value_history'
  ) then
    create policy "Users manage own shop_value_history" on public.shop_value_history
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
-- The app reads it; it writes it only through shop_items (this trigger, as the caller) and Shop's Delete with
-- Undo, which puts rows back as the caller — so the app may insert, update and delete its own rows.
revoke all on public.shop_value_history from anon;
grant select, insert, update, delete on public.shop_value_history to authenticated;
grant select, insert, update, delete on public.shop_value_history to service_role;
create index if not exists idx_shop_value_history_user_day on public.shop_value_history (user_id, valued_on);

comment on table public.shop_value_history is
  'Every "Could sell for" estimate with its day (one per thing and day), kept by the database from shop_items.value_now / value_currency / value_on since migration 192.';

-- ─── 4. Listings ─────────────────────────────────────────────────────────────
create table if not exists public.shop_listings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id         uuid not null references public.shop_items(id) on delete cascade,
  marketplace     text check (marketplace is null or (marketplace ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
                                                      and char_length(marketplace) <= 253)),
  ad_url          text check (ad_url is null or (ad_url ~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][!-~]*)?$'
                                                  and char_length(ad_url) <= 2048)),
  status          text not null default 'listed' check (status in ('listed', 'for_sale', 'sold', 'withdrawn')),
  listed_on       date not null default ((now() at time zone 'Europe/Oslo')::date) check (listed_on >= date '2000-01-01'),
  for_sale_on     date,
  ended_on        date,
  currency        text not null default 'NOK' check (currency in ('NOK', 'TRY', 'EUR', 'USD')),
  prices          jsonb not null,
  ad_text         text check (ad_text is null or char_length(ad_text) <= 6000),
  closed_by_sale  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint shop_listings_state_check check (
    (status = 'listed' and for_sale_on is null and ended_on is null)
    or (status = 'for_sale' and for_sale_on is not null and ended_on is null)
    or (status in ('sold', 'withdrawn') and ended_on is not null)),
  constraint shop_listings_days_check check (
    (for_sale_on is null or for_sale_on >= listed_on) and (ended_on is null or ended_on >= coalesce(for_sale_on, listed_on))),
  constraint shop_listings_closed_check check (not closed_by_sale or status in ('sold', 'withdrawn'))
);
alter table public.shop_listings enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_listings' and policyname = 'Users manage own shop_listings'
  ) then
    create policy "Users manage own shop_listings" on public.shop_listings
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.shop_listings from anon;
grant select, insert, update, delete on public.shop_listings to authenticated;
grant select, insert, update, delete on public.shop_listings to service_role;
create index if not exists idx_shop_listings_user_item on public.shop_listings (user_id, item_id);
create index if not exists idx_shop_listings_item on public.shop_listings (item_id);
-- One open listing per thing.
create unique index if not exists shop_listings_one_open on public.shop_listings (item_id) where status in ('listed', 'for_sale');

comment on table public.shop_listings is
  'Selling a thing: listed (ad written) → for_sale (the ad is up) → sold (from the sale itself) or withdrawn, with its dated price changes (prices) and the marketplace.';
comment on column public.shop_listings.prices is
  'The price story, oldest first: [{"on": "yyyy-mm-dd", "price": n}] — the first the asking price when listed, the last the price now (1–100, in order, from listed_on to today).';
comment on column public.shop_listings.closed_by_sale is 'Set by the database when the thing''s sale closed this listing; the sale''s Undo opens it again.';
comment on column public.shop_listings.ad_url is 'The ad''s link once it is up, https only — never fetched. On the marketplace''s host when one is named.';

-- ─── 5. Ad templates ─────────────────────────────────────────────────────────
create table if not exists public.shop_ad_templates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  marketplace  text check (marketplace is null or (marketplace ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
                                                   and char_length(marketplace) <= 253)),
  category     text check (category is null or (char_length(category) <= 80 and category ~ '\S')),
  language     text not null default 'nb' check (language in ('nb', 'en')),
  title        text not null check (char_length(title) <= 200 and title ~ '\S'),
  body         text not null check (char_length(body) <= 5000 and body ~ '\S'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.shop_ad_templates enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_ad_templates' and policyname = 'Users manage own shop_ad_templates'
  ) then
    create policy "Users manage own shop_ad_templates" on public.shop_ad_templates
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.shop_ad_templates from anon;
grant select, insert, update, delete on public.shop_ad_templates to authenticated;
grant select, insert, update, delete on public.shop_ad_templates to service_role;
-- One per account, marketplace (none = any other) and category (none = any), the category without case.
create unique index if not exists shop_ad_templates_one on public.shop_ad_templates
  (user_id, marketplace, (lower(btrim(category)))) nulls not distinct;

comment on table public.shop_ad_templates is
  'The owner''s ad texts per marketplace (null = any other) and category (null = any): a title and a body with {name}, {condition}, {bought}, {price}, {accessories} (src/features/shop/resaleTexts.ts). Seeded in Norwegian.';

-- ─── 6. Hand-over checklists ─────────────────────────────────────────────────
create table if not exists public.shop_handover_checklists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category    text not null check (char_length(category) <= 80 and category ~ '\S'),
  steps       text not null check (char_length(steps) <= 4000 and steps ~ '\S'
                                   and coalesce(array_length(string_to_array(steps, E'\n'), 1), 0) <= 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.shop_handover_checklists enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_handover_checklists' and policyname = 'Users manage own shop_handover_checklists'
  ) then
    create policy "Users manage own shop_handover_checklists" on public.shop_handover_checklists
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.shop_handover_checklists from anon;
grant select, insert, update, delete on public.shop_handover_checklists to authenticated;
grant select, insert, update, delete on public.shop_handover_checklists to service_role;
create unique index if not exists shop_handover_checklists_one on public.shop_handover_checklists (user_id, (lower(btrim(category))));

comment on table public.shop_handover_checklists is
  'What to do before handing a thing over, per category (one step per line): the owner''s own rows, seeded for phones, game consoles and computers.';

-- ─── Rules ───────────────────────────────────────────────────────────────────
-- Ad notes, trade-in quotes and the value history: about one of the account's own things; a day noted or quoted is
-- at most tomorrow in Oslo (a phone east of Oslo is already on the next day); an ad's link is on its marketplace.
create or replace function public.shop_resale_rows_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_last date := public.oslo_day(pg_catalog.now()) + 1;
begin
  -- 23503 (a foreign key's code): a restore — Delete's Undo, Activity's Undo — puts such a row back in a later round,
  -- once its thing is back; another account's thing never comes back as yours.
  if not exists (select 1 from public.shop_items i where i.id = new.item_id and i.user_id = new.user_id) then
    raise exception 'This is about one of your own things' using errcode = '23503';
  end if;
  if tg_table_name = 'shop_ad_notes' then
    if new.noted_on > v_last then
      raise exception 'An ad is noted on a day up to today' using errcode = '23514';
    end if;
    if new.marketplace is not null and not public.shop_link_on_host(new.ad_url, new.marketplace) then
      raise exception 'The ad''s link is not on %', new.marketplace using errcode = '23514';
    end if;
  elsif tg_table_name = 'shop_trade_in_quotes' then
    if new.quoted_on > v_last then
      raise exception 'A quote is from a day up to today' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- A listing: one of the account's own things; the days of a change of state stamped; its days up to tomorrow in Oslo;
-- its price story whole and in order. (Open only while the thing is yours, sold only while it is sold: when the
-- transaction ends — shop_listings_thing_check below.)
create or replace function public.shop_listings_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := public.oslo_day(pg_catalog.now());
  v_item  record;
  v_prev  date;
  v_on    date;
  v_price numeric;
  e       jsonb;
begin
  select i.user_id into v_item from public.shop_items i where i.id = new.item_id;
  if not found or v_item.user_id <> new.user_id then
    raise exception 'A listing is for one of your own things' using errcode = '23503';
  end if;
  if new.ad_url is not null and new.marketplace is not null and not public.shop_link_on_host(new.ad_url, new.marketplace) then
    raise exception 'The ad''s link is not on %', new.marketplace using errcode = '23514';
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'listed' then
      new.for_sale_on := null;
      new.ended_on := null;
      new.closed_by_sale := false;
    elsif new.status = 'for_sale' then
      new.for_sale_on := coalesce(new.for_sale_on, greatest(v_today, new.listed_on));
      new.ended_on := null;
      new.closed_by_sale := false;
    else
      new.ended_on := coalesce(new.ended_on, greatest(v_today, coalesce(new.for_sale_on, new.listed_on)));
    end if;
  end if;

  if new.listed_on > v_today + 1 or new.for_sale_on > v_today + 1 or new.ended_on > v_today + 1 then
    raise exception 'A listing''s days are up to today' using errcode = '23514';
  end if;

  if pg_catalog.jsonb_typeof(new.prices) is distinct from 'array' or pg_catalog.jsonb_array_length(new.prices) not between 1 and 100 then
    raise exception 'A listing has its asking price and at most 99 price changes' using errcode = '23514';
  end if;
  v_prev := new.listed_on;
  for e in select x.value from pg_catalog.jsonb_array_elements(new.prices) x loop
    if pg_catalog.jsonb_typeof(e) is distinct from 'object'
       or (select count(*) from pg_catalog.jsonb_object_keys(e)) <> 2
       or pg_catalog.jsonb_typeof(e -> 'on') is distinct from 'string'
       or pg_catalog.jsonb_typeof(e -> 'price') is distinct from 'number'
       or (e ->> 'on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'A price change is {"on": day, "price": amount}' using errcode = '23514';
    end if;
    begin
      v_on := (e ->> 'on')::date;
    exception when others then
      raise exception 'A price change is {"on": day, "price": amount}' using errcode = '23514';
    end;
    v_price := (e ->> 'price')::numeric;
    if v_on < v_prev or v_on > v_today + 1 then
      raise exception 'Price changes go in order, from the day it was listed up to today' using errcode = '23514';
    end if;
    if v_price < 0 or v_price >= 1000000000 or pg_catalog.scale(v_price) > 2 then
      raise exception 'A price is from 0 below a billion, with at most two decimals' using errcode = '23514';
    end if;
    v_prev := v_on;
  end loop;
  return new;
end;
$$;

-- When the transaction ends: an open listing's thing is yours (bought, not gone), a sold listing's thing is sold —
-- the listing as it is then (a later write may have changed it, a delete taken it).
create or replace function public.shop_listings_thing_check()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status   text;
  v_item     record;
begin
  select l.status into v_status from public.shop_listings l where l.id = new.id;
  if not found then
    return null;
  end if;
  select i.status, i.disposal into v_item from public.shop_items i where i.id = new.item_id;
  if not found then
    return null;
  end if;
  if v_status in ('listed', 'for_sale') and (v_item.status <> 'bought' or v_item.disposal is not null) then
    raise exception 'Only a thing you have can be listed for sale' using errcode = '23514';
  end if;
  if v_status = 'sold' and v_item.disposal is distinct from 'sold' then
    raise exception 'A listing is sold when its thing is — record the sale (Sell or give away) first' using errcode = '23514';
  end if;
  return null;
end;
$$;

-- A thing added with an estimate: its row in the history, when the transaction ends — from the thing as it is then
-- (a later write may have changed or deleted it) and only when its day has none yet (a restore put the old one back).
create or replace function public.shop_items_value_first()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item record;
  v_day  date;
begin
  select i.user_id, i.value_now, i.value_currency, i.value_on into v_item from public.shop_items i where i.id = new.id;
  if not found or v_item.value_now is null then
    return null;
  end if;
  v_day := coalesce(v_item.value_on, public.oslo_day(pg_catalog.now()));
  if v_item.value_now >= 0 and v_item.value_now < 1000000000 and v_day >= date '2000-01-01' and v_day < date '2100-01-01' then
    insert into public.shop_value_history (user_id, item_id, valued_on, value, currency)
    values (v_item.user_id, new.id, v_day, v_item.value_now, coalesce(v_item.value_currency, 'NOK'))
    on conflict (item_id, valued_on) do nothing;
  end if;
  return null;
end;
$$;

-- shop_items → the value history and the listings (3 and 4 in the header). Runs as the caller.
create or replace function public.shop_items_resale()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date;
  v_day   date;
  v_end   text;
begin
  -- 1. "Could sell for": the history holds the estimates the record held (a new thing's first: shop_items_value_first).
  if new.value_now is distinct from old.value_now or new.value_currency is distinct from old.value_currency
     or new.value_on is distinct from old.value_on then
    v_today := public.oslo_day(pg_catalog.now());
    if new.value_now is not null then
      v_day := coalesce(new.value_on, v_today);
      if new.value_now >= 0 and new.value_now < 1000000000 and v_day >= date '2000-01-01' and v_day < date '2100-01-01' then
        -- An estimate moved to an earlier day (an Undo, a correction) takes back its own day's row — only what the
        -- previous estimate held, never the rows of other days.
        if old.value_now is not null then
          delete from public.shop_value_history h where h.item_id = new.id and h.valued_on > v_day
            and h.valued_on = coalesce(old.value_on, v_today);
        end if;
        insert into public.shop_value_history as h (user_id, item_id, valued_on, value, currency)
        values (new.user_id, new.id, v_day, new.value_now, coalesce(new.value_currency, 'NOK'))
        on conflict (item_id, valued_on) do update set value = excluded.value, currency = excluded.currency
          where h.value is distinct from excluded.value or h.currency is distinct from excluded.currency;
      end if;
    elsif old.value_now is not null then
      -- Cleared: the estimate it held is taken back (its own day's row); every other row stays.
      delete from public.shop_value_history h where h.item_id = new.id and h.valued_on = coalesce(old.value_on, v_today);
    end if;
  end if;

  -- 2. How it left: a sale closes the thing's open listing, its Undo opens it again.
  if new.disposal is distinct from old.disposal then
    v_today := coalesce(v_today, public.oslo_day(pg_catalog.now()));
    v_end := case when new.disposal = 'sold' then 'sold' else 'withdrawn' end;
    if old.disposal is null then
      update public.shop_listings l
         set status = v_end,
             ended_on = greatest(least(coalesce(new.disposed_on, v_today), v_today), l.listed_on, coalesce(l.for_sale_on, l.listed_on)),
             closed_by_sale = true
       where l.item_id = new.id and l.status in ('listed', 'for_sale');
    elsif new.disposal is null then
      -- The one the sale closed opens as it was; one marked sold by hand is taken down (it can't stay sold).
      update public.shop_listings l
         set status = case when not l.closed_by_sale then 'withdrawn' when l.for_sale_on is null then 'listed' else 'for_sale' end,
             ended_on = case when l.closed_by_sale then null else l.ended_on end,
             closed_by_sale = false
       where l.item_id = new.id and (l.closed_by_sale or l.status = 'sold');
    else
      -- It left another way than first written (sold ↔ given away …): the listing says the same.
      update public.shop_listings l
         set status = v_end
       where l.item_id = new.id and (l.closed_by_sale or l.status = 'sold') and l.status is distinct from v_end;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_shop_ad_notes_rules on public.shop_ad_notes;
create trigger trg_shop_ad_notes_rules before insert or update on public.shop_ad_notes
  for each row execute function public.shop_resale_rows_rules();
drop trigger if exists trg_shop_trade_in_quotes_rules on public.shop_trade_in_quotes;
create trigger trg_shop_trade_in_quotes_rules before insert or update on public.shop_trade_in_quotes
  for each row execute function public.shop_resale_rows_rules();
drop trigger if exists trg_shop_value_history_rules on public.shop_value_history;
create trigger trg_shop_value_history_rules before insert or update on public.shop_value_history
  for each row execute function public.shop_resale_rows_rules();
drop trigger if exists trg_shop_listings_rules on public.shop_listings;
create trigger trg_shop_listings_rules before insert or update on public.shop_listings
  for each row execute function public.shop_listings_rules();
drop trigger if exists trg_shop_listings_thing on public.shop_listings;
create constraint trigger trg_shop_listings_thing after insert or update on public.shop_listings
  deferrable initially deferred
  for each row execute function public.shop_listings_thing_check();
-- Fires after trg_audit (see the header).
drop trigger if exists trg_shop_items_resale on public.shop_items;
create trigger trg_shop_items_resale after update on public.shop_items
  for each row execute function public.shop_items_resale();
drop trigger if exists trg_shop_items_value_first on public.shop_items;
create constraint trigger trg_shop_items_value_first after insert on public.shop_items
  deferrable initially deferred
  for each row execute function public.shop_items_value_first();

drop trigger if exists trg_shop_ad_notes_updated_at on public.shop_ad_notes;
create trigger trg_shop_ad_notes_updated_at before update on public.shop_ad_notes
  for each row execute function public.update_updated_at();
drop trigger if exists trg_shop_trade_in_quotes_updated_at on public.shop_trade_in_quotes;
create trigger trg_shop_trade_in_quotes_updated_at before update on public.shop_trade_in_quotes
  for each row execute function public.update_updated_at();
drop trigger if exists trg_shop_value_history_updated_at on public.shop_value_history;
create trigger trg_shop_value_history_updated_at before update on public.shop_value_history
  for each row execute function public.update_updated_at();
drop trigger if exists trg_shop_listings_updated_at on public.shop_listings;
create trigger trg_shop_listings_updated_at before update on public.shop_listings
  for each row execute function public.update_updated_at();
drop trigger if exists trg_shop_ad_templates_updated_at on public.shop_ad_templates;
create trigger trg_shop_ad_templates_updated_at before update on public.shop_ad_templates
  for each row execute function public.update_updated_at();
drop trigger if exists trg_shop_handover_checklists_updated_at on public.shop_handover_checklists;
create trigger trg_shop_handover_checklists_updated_at before update on public.shop_handover_checklists
  for each row execute function public.update_updated_at();

drop trigger if exists trg_audit on public.shop_ad_notes;
create trigger trg_audit after insert or update or delete on public.shop_ad_notes
  for each row execute function public.log_audit();
drop trigger if exists trg_audit on public.shop_trade_in_quotes;
create trigger trg_audit after insert or update or delete on public.shop_trade_in_quotes
  for each row execute function public.log_audit();
drop trigger if exists trg_audit on public.shop_value_history;
create trigger trg_audit after insert or update or delete on public.shop_value_history
  for each row execute function public.log_audit();
drop trigger if exists trg_audit on public.shop_listings;
create trigger trg_audit after insert or update or delete on public.shop_listings
  for each row execute function public.log_audit();
drop trigger if exists trg_audit on public.shop_ad_templates;
create trigger trg_audit after insert or update or delete on public.shop_ad_templates
  for each row execute function public.log_audit();
drop trigger if exists trg_audit on public.shop_handover_checklists;
create trigger trg_audit after insert or update or delete on public.shop_handover_checklists
  for each row execute function public.log_audit();

-- ─── 7. 187's and 190's rules: a thing not (yet) yours is a foreign key's refusal ─
-- 187's, word for word but for the code of its first refusal (23503: a restore retries it once the thing is back).
create or replace function public.shop_item_costs_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.shop_items where id = new.item_id and user_id = new.user_id) then
    raise exception 'A cost belongs to one of your own items' using errcode = '23503';
  end if;
  if new.currency = 'NOK' then
    new.fx_nok := 1;
    new.fx_source := 'fixed';
  elsif new.fx_nok is not null and (tg_op = 'INSERT' or new.fx_nok is distinct from old.fx_nok
                                    or new.fx_source is distinct from old.fx_source) then
    new.fx_source := case when new.fx_source = 'norges_bank' and new.fx_nok = public.shop_rate(new.currency, new.spent_on)
                          then 'norges_bank' else 'manual' end;
  elsif new.fx_nok is null or tg_op = 'INSERT' or new.currency is distinct from old.currency
        or new.spent_on is distinct from old.spent_on then
    new.fx_nok := public.shop_rate(new.currency, new.spent_on);
    new.fx_source := case when new.fx_nok is null then null else 'norges_bank' end;
  end if;
  return new;
end;
$$;

-- 190's, word for word but for the code of its first refusal (23503, as above).
create or replace function public.shop_signal_states_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.item_id is not null and not exists (
    select 1 from public.shop_items i where i.id = new.item_id and i.user_id = new.user_id
  ) then
    raise exception 'Needs a look remembers only your own things' using errcode = '23503';
  end if;
  if new.dismissed_at is not null and new.dismissed_at > pg_catalog.now() then
    new.dismissed_at := pg_catalog.now();
  end if;
  if tg_op = 'INSERT' then
    new.created_at := least(greatest(coalesce(new.created_at, pg_catalog.now()), timestamptz '2000-01-01 00:00:00+00'), pg_catalog.now());
    new.updated_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

-- ─── The default texts ───────────────────────────────────────────────────────
-- The ad templates, in Norwegian (the owner's decision): one for finn.no, one for tise.com, one for any other
-- marketplace. The fields: {name} the thing, {condition} its condition in the template's language, {bought} the
-- day it was bought (DD.MM.YYYY, "ca." when approximate), {price} the asking price with its unit, {accessories}
-- what goes with it. A line whose field has no value is left out.
create or replace function public.shop_resale_default_templates()
returns table (marketplace text, category text, language text, title text, body text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('finn.no', null::text, 'nb', '{name} – {condition}',
     E'Selger {name}.\nTilstand: {condition}.\nKjøpt {bought}.\nMedfølger: {accessories}.\n\nPris: {price}.\nKan hentes eller sendes. Send gjerne en melding hvis du lurer på noe.'),
    ('tise.com', null::text, 'nb', '{name}',
     E'{name} – {condition}.\nKjøpt {bought}.\nMedfølger: {accessories}.\nPris: {price}. Sendes eller hentes.'),
    (null::text, null::text, 'nb', '{name} – {condition}',
     E'Selger {name}.\nTilstand: {condition}.\nKjøpt {bought}.\nMedfølger: {accessories}.\n\nPris: {price}.\nSend gjerne en melding hvis du lurer på noe.')
  ) as d (marketplace, category, language, title, body)
$$;

-- The hand-over checklists, one step per line (English: the owner reads them in the app).
create or replace function public.shop_resale_default_checklists()
returns table (category text, steps text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('Phones', E'Back up what you want to keep\n'
               'Move BankID and your two-factor codes to your new phone\n'
               'Unpair your watch and earbuds\n'
               'Sign out of iCloud and turn off Find My (iPhone) — or remove your Google account (Android)\n'
               'Factory reset: Erase All Content and Settings (iPhone) or Factory data reset (Android)\n'
               'Take out the SIM card and the memory card\n'
               'Remove the phone from your Apple ID or Google devices list\n'
               'Pack the charger, the cable and the box'),
    ('Game Consoles', E'Turn off console sharing (PlayStation), remove it as your home Xbox, or deregister it as your primary console (Nintendo)\n'
                      'Sign out of PlayStation Network, Xbox or your Nintendo Account\n'
                      'Factory reset the console\n'
                      'Take out any memory card or extra drive\n'
                      'Pack the controllers, the cables, the charger and the box'),
    ('Computers & Laptops', E'Back up your files\n'
                            'Sign out of iCloud, Messages and the App Store and turn off Find My (Mac) — or sign out of your Microsoft account (Windows)\n'
                            'Unpair Bluetooth devices\n'
                            'Erase it: Erase All Content and Settings (Mac) or Reset this PC → Remove everything (Windows)\n'
                            'Take out any SD card or USB stick\n'
                            'Pack the charger and the box')
  ) as d (category, steps)
$$;

-- The defaults the caller has none of (never one the owner already has, edited or not); answers how many were added.
create or replace function public.shop_add_resale_defaults()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  n      integer;
  k      integer;
begin
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.shop_ad_templates (user_id, marketplace, category, language, title, body)
  select v_user, d.marketplace, d.category, d.language, d.title, d.body from public.shop_resale_default_templates() d
  on conflict do nothing;
  get diagnostics n = row_count;
  insert into public.shop_handover_checklists (user_id, category, steps)
  select v_user, d.category, d.steps from public.shop_resale_default_checklists() d
  on conflict do nothing;
  get diagnostics k = row_count;
  return n + k;
end;
$$;

-- The seeds: every app user's defaults (the owner lock's list; an account added later uses shop_add_resale_defaults).
insert into public.shop_ad_templates (user_id, marketplace, category, language, title, body)
select a.user_id, d.marketplace, d.category, d.language, d.title, d.body
  from public.app_allowed_users a
  cross join public.shop_resale_default_templates() d
on conflict do nothing;
insert into public.shop_handover_checklists (user_id, category, steps)
select a.user_id, d.category, d.steps
  from public.app_allowed_users a
  cross join public.shop_resale_default_checklists() d
on conflict do nothing;

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.shop_link_on_host(text, text) from public, anon;
revoke all on function public.shop_resale_rows_rules() from public, anon, authenticated, service_role;
revoke all on function public.shop_listings_rules() from public, anon, authenticated, service_role;
revoke all on function public.shop_listings_thing_check() from public, anon, authenticated, service_role;
revoke all on function public.shop_items_resale() from public, anon, authenticated, service_role;
revoke all on function public.shop_items_value_first() from public, anon, authenticated, service_role;
revoke all on function public.shop_item_costs_rules() from public, anon, authenticated, service_role;
revoke all on function public.shop_signal_states_rules() from public, anon, authenticated, service_role;
revoke all on function public.shop_resale_default_templates() from public, anon;
revoke all on function public.shop_resale_default_checklists() from public, anon;
revoke all on function public.shop_add_resale_defaults() from public, anon;
-- The rules triggers run as the caller and call these.
grant execute on function public.shop_link_on_host(text, text) to authenticated, service_role;
grant execute on function public.shop_resale_default_templates() to authenticated;
grant execute on function public.shop_resale_default_checklists() to authenticated;
grant execute on function public.shop_add_resale_defaults() to authenticated;

comment on function public.shop_link_on_host(text, text) is 'Whether an https link is on a host or one of its subdomains (an ad''s link on its marketplace).';
comment on function public.shop_items_resale() is
  'shop_items → shop_value_history (every "Could sell for" with its day) and shop_listings (a sale closes the open listing, its Undo opens it again). Fires after trg_audit.';
comment on function public.shop_add_resale_defaults() is
  'Adds the default ad templates (Norwegian) and hand-over checklists the caller has none of; answers how many were added.';

select public.owner_lock_apply('public.shop_ad_notes');
select public.owner_lock_apply('public.shop_trade_in_quotes');
select public.owner_lock_apply('public.shop_value_history');
select public.owner_lock_apply('public.shop_listings');
select public.owner_lock_apply('public.shop_ad_templates');
select public.owner_lock_apply('public.shop_handover_checklists');
