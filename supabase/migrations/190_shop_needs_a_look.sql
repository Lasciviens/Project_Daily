-- 190 · Shop: what "Needs a look" remembers, deal days as repeating rules, and stock in the price history
-- (Shop phase 2, 10.11.2026 — the owner approved the look and phase 2: "I approve this shopping look yes go on").
--
-- 1. shop_signal_states — what the owner did with a Needs-a-look row: Snooze (not until a day: the row comes
--    back on that day) or Got it (the row comes back only when something new happens). Got it stores the row's
--    `signature` — a short text the app builds from what the row says (the price, the deadline) — so the same
--    row with the same facts stays away, and a new lower price or a new deadline brings it back. Got it clears a
--    snooze; a snooze keeps an earlier Got it. One row per account, thing (or none: a row about the whole page,
--    such as the tidy-up) and signal (a unique index; a missing thing counts as one key).
--    Signal keys — an allow-list (CHECK); a new kind of row is a new migration that widens it, and
--    src/features/shop/signalStates.ts's SHOP_SIGNALS changes with it (verify-shop-signals compares them):
--      at_target           a wish's price now is at or under its target
--      lowest_seen         a wish's price now is the lowest clean price seen in 60 days
--      back_in_stock       a shop's own page says in stock again after an out-of-stock read in the last 30 days
--      fake_before         a shop's struck-out "before" price is higher than any clean price seen in 60 days
--      deal_day            a deal day ahead (shop_deal_days) — for a wish waiting for a deal, or the page
--      cheaper_returnable  a thing you have costs less now than you paid, while it can still be returned
--      return_closing      a return window closing
--      complaint_ending    a complaint right (reklamasjon) ending
--      old_value           a "Could sell for" estimated over six months ago
--      old_wish            a wish waiting over six months
--      tidy_up             things missing a purchase day, a rate or a sale amount (one row for the page)
--    · user_id with auth.uid() by default; the owner policy and the owner lock; the browser reads and writes its
--      own rows (Shop's Delete with Undo puts a deleted thing's rows back as the caller: point 16 of
--      docs/backend/database.md needs INSERT). Audited (trg_audit): the owner's own choices, so Developer →
--      Activity can undo them (one id primary key).
--    · `signature` is untrusted input and only ever compared: 1–120 ASCII letters, digits and . _ : , ; = | @ # + / -
--      (no spaces, so no sentences — the assistant reads this table). snoozed_until is a day from 2000 to 2099;
--      a Got it has both its signature and its time (a time sent from the future is the database's now); a row
--      always holds a snooze or a Got it (Show again deletes it). A row about a thing is about one of the
--      account's own things, whoever writes it (a trigger; an extra cost has the same rule).
--    · Written through three functions that answer the row as it was before and as it is after (`before` is
--      null when there was none), so the app's Undo puts back exactly what was there: shop_signal_snooze,
--      shop_signal_dismiss (Got it) and shop_signal_put (Undo, and Show again with no state: the row goes). They
--      run as the caller (row level security and the owner lock apply), serialized per row by an advisory lock.
-- 2. shop_deal_days — deal days as repeating rules, so nobody types them every year: a name, a stable slug (the
--    app's signatures name it), a small typed rule — a fixed day and month ('fixed'), or the n-th weekday of a
--    month ('nth_weekday': ISO weekday 1 = Monday … 7 = Sunday; nth 1–4, or -1 = the last) — plus an offset in
--    days, a length in days, an optional source_url and the day it was checked. The day each year is computed
--    by src/features/shop/dealDays.ts (verify-shop-signals checks 2026–2030 against these rows).
--    · No user_id: the same days for every account (reference data, like shop_site_policies, 188). App users
--      read them (the owner lock); only migrations and the service role write them (no browser write grant or
--      policy). Editing them comes in phase 4.
--    · No audit trigger: not user-authored — written only by migrations (their history is git) and the service role.
--    Seeded with four rows, each with its reason below. No source_url: no live page was read for them; each
--    rule is checked by computing it (Black Friday 27.11.2026, 26.11.2027, 24.11.2028).
-- 3. shop_price_points.in_stock — whether a read said the thing was in stock (a shop's own page says so; Prisjakt's
--    new-offer reads and every point from before 190 leave it NULL), so "back in stock" can be read from the
--    history. shop-price writes it on each new point. A point's low and high are finite from now on (NaN >= 0 is
--    true in Postgres, so 137's checks let NaN and infinity in): checks for new writes, validated when no old
--    row breaks them.
-- 4. shop_restore_price_history (187, 188) carries in_stock through Delete's Undo; everything else in it is 188's.
-- 5. shop_price_stats(ids) — the price figures of up to 500 of the caller's things in one call (the Wishlist's
--    tiles and Needs a look; it replaces one history read per wish): the lowest and highest clean price seen (all
--    the two years kept, and the last 60 days), the last clean read's price, stock and time, whether it is back
--    in stock (an out-of-stock read in the last 30 days before the latest, which is in stock) and since when, and
--    a sparkline of the last 60 days (12 steps of 5 days, oldest first, the step's lowest; NULL = no read then).
--    Clean = condition 'new' (Prisjakt's new offers) or 'unknown' (a shop's own page): 'mixed' and NULL (read
--    before 188, when a Prisjakt price could be a used or refurbished one) are left out (owner-approved), and so
--    is any price that is negative, NaN or infinite. The figures are in the last clean read's currency (reads in
--    another currency are left out). Only the caller's own things count: another account's id gives nothing.
--    Runs as the caller.
--
-- Functions: search_path '', granted to signed-in callers only; only shop_restore_price_history is SECURITY
-- DEFINER (187's reason: the browser has no write on the price tables). Safe to re-run. Changes no row.
-- No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── 1. What Needs a look remembers ──────────────────────────────────────────
create table if not exists public.shop_signal_states (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id       uuid references public.shop_items(id) on delete cascade,
  signal        text not null check (signal in (
                  'at_target', 'lowest_seen', 'back_in_stock', 'fake_before', 'deal_day', 'cheaper_returnable',
                  'return_closing', 'complaint_ending', 'old_value', 'old_wish', 'tidy_up')),
  signature     text check (signature is null
                  or (signature ~ '^[A-Za-z0-9._:,;=|@#+/-]{1,120}$' and octet_length(signature) = char_length(signature))),
  snoozed_until date check (snoozed_until is null or (snoozed_until >= date '2000-01-01' and snoozed_until < date '2100-01-01')),
  dismissed_at  timestamptz check (dismissed_at is null or dismissed_at >= timestamptz '2000-01-01 00:00:00+00'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint shop_signal_states_got_it_check check ((signature is null) = (dismissed_at is null)),
  constraint shop_signal_states_holds_check check (snoozed_until is not null or dismissed_at is not null)
);
alter table public.shop_signal_states enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_signal_states' and policyname = 'Users manage own shop_signal_states'
  ) then
    create policy "Users manage own shop_signal_states" on public.shop_signal_states
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
-- Nobody signed out uses the app (the owner lock): anon gets nothing.
revoke all on public.shop_signal_states from anon;
grant select, insert, update, delete on public.shop_signal_states to authenticated;
grant select, insert, update, delete on public.shop_signal_states to service_role;

-- One row per account, thing (or none) and signal; the list is read whole per account.
create unique index if not exists idx_shop_signal_states_one
  on public.shop_signal_states (user_id, (coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid)), signal);
-- A deleted thing takes its rows (ON DELETE CASCADE looks them up by item_id).
create index if not exists idx_shop_signal_states_item on public.shop_signal_states (item_id) where item_id is not null;

-- A row about a thing is about one of the account's own things; Got it's time is never in the future.
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
    raise exception 'Needs a look remembers only your own things' using errcode = '23514';
  end if;
  if new.dismissed_at is not null and new.dismissed_at > pg_catalog.now() then
    new.dismissed_at := pg_catalog.now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_shop_signal_states_rules on public.shop_signal_states;
create trigger trg_shop_signal_states_rules before insert or update on public.shop_signal_states
  for each row execute function public.shop_signal_states_rules();
drop trigger if exists trg_shop_signal_states_updated_at on public.shop_signal_states;
create trigger trg_shop_signal_states_updated_at before update on public.shop_signal_states
  for each row execute function public.update_updated_at();
drop trigger if exists trg_audit on public.shop_signal_states;
create trigger trg_audit after insert or update or delete on public.shop_signal_states
  for each row execute function public.log_audit();

comment on table public.shop_signal_states is
  'What the owner did with a Shop "Needs a look" row: snoozed until a day, or Got it for one signature (the row comes back when its facts change). One row per account, thing (null = the whole page) and signal. Written through shop_signal_snooze / shop_signal_dismiss / shop_signal_put.';
comment on column public.shop_signal_states.signature is
  'What the row said when Got it was tapped (built by the app, e.g. at_target|NOK|6990): compared only, never shown or run. 1-120 ASCII characters without spaces.';
comment on column public.shop_signal_states.snoozed_until is 'Not shown before this day (it comes back on it).';

-- Snooze: the row stays away until p_until (a Got it stays). Answers {"before": row or null, "after": row}.
create or replace function public.shop_signal_snooze(p_item_id uuid, p_signal text, p_until date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_before jsonb;
  v_after  jsonb;
begin
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_until is null then
    raise exception 'Snoozing needs a day' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_user::text || '/' || coalesce(p_item_id::text, '-') || '/' || coalesce(p_signal, ''), 190));
  select to_jsonb(s) into v_before from public.shop_signal_states s
   where s.user_id = v_user and s.item_id is not distinct from p_item_id and s.signal = p_signal
   for update;
  insert into public.shop_signal_states as s (user_id, item_id, signal, snoozed_until)
  values (v_user, p_item_id, p_signal, p_until)
  on conflict (user_id, (coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid)), signal)
  do update set snoozed_until = excluded.snoozed_until
  returning to_jsonb(s) into v_after;
  return jsonb_build_object('before', v_before, 'after', v_after);
end;
$$;

-- Got it: the row stays away while its signature is p_signature (a snooze ends). Answers {"before", "after"}.
create or replace function public.shop_signal_dismiss(p_item_id uuid, p_signal text, p_signature text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_before jsonb;
  v_after  jsonb;
begin
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_signature is null then
    raise exception 'Got it needs the row''s signature' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_user::text || '/' || coalesce(p_item_id::text, '-') || '/' || coalesce(p_signal, ''), 190));
  select to_jsonb(s) into v_before from public.shop_signal_states s
   where s.user_id = v_user and s.item_id is not distinct from p_item_id and s.signal = p_signal
   for update;
  insert into public.shop_signal_states as s (user_id, item_id, signal, signature, dismissed_at, snoozed_until)
  values (v_user, p_item_id, p_signal, p_signature, pg_catalog.now(), null)
  on conflict (user_id, (coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid)), signal)
  do update set signature = excluded.signature, dismissed_at = excluded.dismissed_at, snoozed_until = null
  returning to_jsonb(s) into v_after;
  return jsonb_build_object('before', v_before, 'after', v_after);
end;
$$;

-- Puts a row's state exactly (Undo; Show again with p_state null — the row goes): its snooze, its Got it and when
-- it was said, and, when the row has to be made again, its own id and first time. Answers {"before", "after"}.
create or replace function public.shop_signal_put(p_item_id uuid, p_signal text, p_state jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_before jsonb;
  v_after  jsonb;
begin
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_state is not null and pg_catalog.jsonb_typeof(p_state) not in ('object', 'null') then
    raise exception 'Not a Needs-a-look state' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_user::text || '/' || coalesce(p_item_id::text, '-') || '/' || coalesce(p_signal, ''), 190));
  select to_jsonb(s) into v_before from public.shop_signal_states s
   where s.user_id = v_user and s.item_id is not distinct from p_item_id and s.signal = p_signal
   for update;
  if p_state is null or pg_catalog.jsonb_typeof(p_state) = 'null' then
    delete from public.shop_signal_states s
     where s.user_id = v_user and s.item_id is not distinct from p_item_id and s.signal = p_signal;
    return jsonb_build_object('before', v_before, 'after', null);
  end if;
  insert into public.shop_signal_states as s (id, user_id, item_id, signal, signature, snoozed_until, dismissed_at, created_at)
  values (coalesce((p_state ->> 'id')::uuid, gen_random_uuid()), v_user, p_item_id, p_signal,
          p_state ->> 'signature', (p_state ->> 'snoozed_until')::date, (p_state ->> 'dismissed_at')::timestamptz,
          least(coalesce((p_state ->> 'created_at')::timestamptz, pg_catalog.now()), pg_catalog.now()))
  on conflict (user_id, (coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid)), signal)
  do update set signature = excluded.signature, snoozed_until = excluded.snoozed_until, dismissed_at = excluded.dismissed_at
  returning to_jsonb(s) into v_after;
  return jsonb_build_object('before', v_before, 'after', v_after);
end;
$$;

-- ─── 2. Deal days as repeating rules ─────────────────────────────────────────
create table if not exists public.shop_deal_days (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z][a-z0-9_]{0,39}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  rule_kind   text not null check (rule_kind in ('fixed', 'nth_weekday')),
  month       smallint not null check (month between 1 and 12),
  day         smallint check (day between 1 and 31),
  weekday     smallint check (weekday between 1 and 7),
  nth         smallint check (nth in (1, 2, 3, 4, -1)),
  offset_days smallint not null default 0 check (offset_days between -31 and 31),
  length_days smallint not null default 1 check (length_days between 1 and 31),
  source_url  text check (source_url is null or (source_url ~ '^https://[^[:space:]]+$' and char_length(source_url) <= 2048)),
  checked_on  date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A fixed rule names a day that every year has (no 29.02); an n-th weekday names the weekday and which one.
  constraint shop_deal_days_rule_check check (
    (rule_kind = 'fixed' and weekday is null and nth is null and day is not null
      and day <= case month when 2 then 28 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end)
    or (rule_kind = 'nth_weekday' and day is null and weekday is not null and nth is not null))
);
alter table public.shop_deal_days enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_deal_days' and policyname = 'App users read deal days'
  ) then
    -- The same days for everyone: read for all signed in (the owner lock narrows it to app users), written only by
    -- migrations and the service role.
    create policy "App users read deal days" on public.shop_deal_days for select to authenticated using (true);
  end if;
end $$;
revoke all on public.shop_deal_days from anon, authenticated;
grant select on public.shop_deal_days to authenticated;
grant select, insert, update, delete on public.shop_deal_days to service_role;

drop trigger if exists trg_shop_deal_days_updated_at on public.shop_deal_days;
create trigger trg_shop_deal_days_updated_at before update on public.shop_deal_days
  for each row execute function public.update_updated_at();

-- The seeds (checked 10.11.2026 by computing each rule; dealDays.ts and verify-shop-signals):
--   black_friday    The day most Norwegian shops run their biggest sale (many a whole "Black Week"): the Friday
--                   after the fourth Thursday of November (US Thanksgiving) — 27.11.2026, 26.11.2027, 24.11.2028.
--   cyber_monday    The online follow-up: the Monday after Black Friday (the fourth Thursday + 4) — 30.11.2026.
--   singles_day     11.11, the online sales day from China that Norwegian web shops run too.
--   mellomdagssalg  Norway's sale between Christmas and New Year: 27.12, 5 days (to 31.12).
insert into public.shop_deal_days (slug, name, rule_kind, month, day, weekday, nth, offset_days, length_days, checked_on) values
  ('black_friday', 'Black Friday', 'nth_weekday', 11, null, 4, 4, 1, 1, '2026-11-10'),
  ('cyber_monday', 'Cyber Monday', 'nth_weekday', 11, null, 4, 4, 4, 1, '2026-11-10'),
  ('singles_day', 'Singles'' Day', 'fixed', 11, 11, null, null, 0, 1, '2026-11-10'),
  ('mellomdagssalg', 'Mellomdagssalg', 'fixed', 12, 27, null, null, 0, 5, '2026-11-10')
on conflict (slug) do nothing;

comment on table public.shop_deal_days is
  'Deal days as repeating rules (Black Friday = the 4th Thursday of November + 1 day): reference data, the same for every account; written by migrations and the service role only. The day each year: src/features/shop/dealDays.ts.';
comment on column public.shop_deal_days.weekday is 'nth_weekday: ISO weekday, 1 = Monday … 7 = Sunday.';
comment on column public.shop_deal_days.nth is 'nth_weekday: which one in the month, 1–4, or -1 = the last.';
comment on column public.shop_deal_days.offset_days is 'Days added to the rule''s day (Black Friday: the 4th Thursday + 1).';

-- ─── 3. Stock in the price history; finite prices ────────────────────────────
alter table public.shop_price_points add column if not exists in_stock boolean;
comment on column public.shop_price_points.in_stock is
  'Whether this read said the thing was in stock (a shop''s own page; NULL for Prisjakt''s new-offer reads and every point from before 190).';

alter table public.shop_price_points drop constraint if exists shop_price_points_low_finite_check;
alter table public.shop_price_points add constraint shop_price_points_low_finite_check
  check (low >= 0 and low < 'Infinity') not valid;
alter table public.shop_price_points drop constraint if exists shop_price_points_high_finite_check;
alter table public.shop_price_points add constraint shop_price_points_high_finite_check
  check (high is null or (high >= 0 and high < 'Infinity')) not valid;
do $$ begin
  if not exists (select 1 from public.shop_price_points where not (low >= 0 and low < 'Infinity')) then
    alter table public.shop_price_points validate constraint shop_price_points_low_finite_check;
  end if;
  if not exists (select 1 from public.shop_price_points where high is not null and not (high >= 0 and high < 'Infinity')) then
    alter table public.shop_price_points validate constraint shop_price_points_high_finite_check;
  end if;
end $$;

-- ─── 4. Delete's Undo carries in_stock (188's helper, with the new column) ──
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
                                        condition, used_low, refurbished_low, in_stock)
  select coalesce(p.id, gen_random_uuid()), v_user, p.item_id, least(p.checked_at, now()), p.low,
         case when p.high >= 0 and p.high < 'Infinity' then p.high end,
         case when p.offers between 0 and 100000 then p.offers end,
         case when p.currency ~ '^[A-Z]{3}$' then p.currency end, case when p.source in ('prisjakt', 'store') then p.source end,
         case when p.condition in ('new', 'mixed', 'unknown') then p.condition end,
         case when p.used_low >= 0 and p.used_low < 'Infinity' then p.used_low end,
         case when p.refurbished_low >= 0 and p.refurbished_low < 'Infinity' then p.refurbished_low end,
         p.in_stock
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

-- ─── 5. Price figures for many things in one call ────────────────────────────
create or replace function public.shop_price_stats(p_item_ids uuid[])
returns table (
  item_id       uuid,
  currency      text,
  points        integer,
  low_all       numeric,
  high_all      numeric,
  points_60d    integer,
  low_60d       numeric,
  high_60d      numeric,
  last_price    numeric,
  last_in_stock boolean,
  last_at       timestamptz,
  back_in_stock boolean,
  restocked_at  timestamptz,
  spark         numeric[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.cardinality(p_item_ids), 0) > 500 then
    raise exception 'At most 500 things at a time' using errcode = '22023';
  end if;
  return query
  with mine as (
    select distinct i.id
      from public.shop_items i
     where i.id = any (coalesce(p_item_ids, '{}'::uuid[])) and i.user_id = v_user
  ),
  clean as (
    select p.item_id, p.checked_at, p.low, p.currency, p.in_stock
      from public.shop_price_points p
      join mine m on m.id = p.item_id
     where p.user_id = v_user
       and p.condition in ('new', 'unknown')
       and p.low >= 0 and p.low < 'Infinity'
  ),
  latest as (
    select distinct on (c.item_id) c.item_id, c.checked_at, c.low, c.currency, c.in_stock
      from clean c
     order by c.item_id, c.checked_at desc
  ),
  priced as (
    select c.item_id, c.checked_at, c.low
      from clean c
      join latest l on l.item_id = c.item_id
     where c.currency is not distinct from l.currency
  ),
  spans as (
    select pr.item_id,
           count(*)::integer as n_all,
           min(pr.low) as lo_all,
           max(pr.low) as hi_all,
           (count(*) filter (where pr.checked_at > pg_catalog.now() - interval '60 days'))::integer as n_60,
           min(pr.low) filter (where pr.checked_at > pg_catalog.now() - interval '60 days') as lo_60,
           max(pr.low) filter (where pr.checked_at > pg_catalog.now() - interval '60 days') as hi_60
      from priced pr
     group by pr.item_id
  ),
  gone as (
    select c.item_id, max(c.checked_at) as out_at
      from clean c
     where c.in_stock = false and c.checked_at > pg_catalog.now() - interval '30 days'
     group by c.item_id
  ),
  back as (
    select l.item_id,
           (select min(c.checked_at) from clean c
             where c.item_id = l.item_id and c.in_stock and c.checked_at > g.out_at) as since
      from latest l
      join gone g on g.item_id = l.item_id
     where l.in_stock and g.out_at < l.checked_at
  ),
  steps as (
    select pr.item_id,
           pg_catalog.floor(extract(epoch from (pg_catalog.now() - pr.checked_at)) / 432000)::integer as step,
           min(pr.low) as lo
      from priced pr
     where pr.checked_at > pg_catalog.now() - interval '60 days' and pr.checked_at <= pg_catalog.now()
     group by pr.item_id, 2
  ),
  sparks as (
    select s.item_id, array_agg(st.lo order by k.step desc) as line
      from spans s
      cross join pg_catalog.generate_series(0, 11) as k(step)
      left join steps st on st.item_id = s.item_id and st.step = k.step
     group by s.item_id
  )
  select l.item_id, l.currency, s.n_all, s.lo_all, s.hi_all, s.n_60, s.lo_60, s.hi_60,
         l.low, l.in_stock, l.checked_at,
         b.item_id is not null, b.since,
         sp.line
    from latest l
    join spans s on s.item_id = l.item_id
    left join back b on b.item_id = l.item_id
    left join sparks sp on sp.item_id = l.item_id
   order by l.item_id;
end;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.shop_signal_states_rules() from public, anon, authenticated, service_role;
revoke all on function public.shop_signal_snooze(uuid, text, date) from public, anon;
revoke all on function public.shop_signal_dismiss(uuid, text, text) from public, anon;
revoke all on function public.shop_signal_put(uuid, text, jsonb) from public, anon;
revoke all on function public.shop_restore_price_history(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.shop_price_stats(uuid[]) from public, anon;
grant execute on function public.shop_signal_snooze(uuid, text, date) to authenticated;
grant execute on function public.shop_signal_dismiss(uuid, text, text) to authenticated;
grant execute on function public.shop_signal_put(uuid, text, jsonb) to authenticated;
grant execute on function public.shop_restore_price_history(jsonb, jsonb) to authenticated;
grant execute on function public.shop_price_stats(uuid[]) to authenticated;

comment on function public.shop_signal_snooze(uuid, text, date) is
  'Snoozes a Needs-a-look row until a day; answers the row before (null if none) and after, for an exact Undo.';
comment on function public.shop_signal_dismiss(uuid, text, text) is
  'Got it for a Needs-a-look row with this signature (the row returns when it changes); answers before and after.';
comment on function public.shop_signal_put(uuid, text, jsonb) is
  'Puts a Needs-a-look row''s state exactly (Undo); null deletes it (Show again). Answers before and after.';
comment on function public.shop_restore_price_history(jsonb, jsonb) is
  'Delete''s Undo of the price watch and its history: only for the rows that same shop_restore_items call put back (app.shop_restored; a direct call writes nothing), every field checked, the price''s condition (188) and stock (190) too.';
comment on function public.shop_price_stats(uuid[]) is
  'Clean price figures (condition new or unknown) of up to 500 of the caller''s things: lowest/highest all time and in 60 days, the last read, back in stock, a 60-day sparkline.';

select public.owner_lock_apply('public.shop_signal_states');
select public.owner_lock_apply('public.shop_deal_days');
