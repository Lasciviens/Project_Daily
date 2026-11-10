-- 187 · Shop: its rules hold for every writer, and Undo puts back what it took (database review, 09.11.2026).
--
-- A review of 137's rules on a throwaway Postgres found writes that break them and Undos that lose data
-- (scripts/db-tests/shop-rules/bugs.sql reproduces each one on 137/138 and passes after this file).
-- Safe to re-run. Changes no row when it runs; adds one column, two indexes, two link checks and a default,
-- drops one index (a duplicate) and re-creates Shop's functions and triggers with these rules:
--
--  1. Delete's Undo (shop_restore_items) puts the rows back first and their parents after (an accessory's
--     item, a model's wish): 137 ordered "parents first" by date, so a case bought before the phone model
--     it was moved under came back before the phone, the rule refused it and both stayed deleted. What a
--     row points at that is gone since — its category, its task (every single-column foreign key of
--     shop_items into the app's tables, from the catalogue), a money link's other end — stays out, as
--     that row's own delete left it; one foreign key error used to refuse the whole Undo. A row pointing
--     at a stranger's row counts it as gone. The chain builder saves through the same function.
--  2. Delete takes a row's price watch and its history (ON DELETE CASCADE): shop_delete_items now keeps
--     them in its snapshot, and shop_restore_items puts them back through shop_restore_price_history
--     (SECURITY DEFINER — the browser has no write on those tables). It writes only for the rows that same
--     Undo just put back — shop_restore_items lists their ids in the transaction-local setting
--     app.shop_restored, which the browser can't set, behind the transaction's own stamp (a value left on
--     a pooled connection never counts) — so a direct call writes nothing; and it checks every field
--     (prices from 0 below infinity, no NaN; counts 0–100 000; no time in the future or made up). Rows of
--     a table added later that point at shop_items are kept too (`more`) and come back with them, one
--     level deep — only as shop_delete_items keeps them, and only where the caller may write them back.
--  3. A rate is "Norges Bank" only when it is Norges Bank's rate of that day as the database has it: a
--     rate a write sends is typed by hand (manual) unless it is exactly that rate — 137 kept a forged rate
--     sent with fx_source 'norges_bank'. Purchase, sale and extra cost alike. A rate a write clears is
--     looked up again at once.
--  4. A thing you have keeps its purchase day: a write that sends bought_at NULL keeps the day it had
--     (137 kept the NULL, and the rate stayed "pending" for good).
--  5. Leaving 'bought' while sold or gone is refused whatever the write sends (137 let status +
--     disposal NULL through), and things sold together are taken back together: a row leaves its sale
--     group (its sale undone, its group changed, the row deleted) only with every other row of it, checked
--     when the transaction ends (shop_undo_sale, Activity Undo and Delete take a whole group in one go).
--  6. shop_undo_sale is the whole inverse of shop_record_sale: the sale writes on the thing sold
--     (sale_undo) which accessories it moved and what it did to the money link, and its Undo moves them
--     back and puts the link back (a link the sale made goes; an amount it changed returns) — each only
--     while it still is as the sale left it, and every record in the group on its own row. Kept
--     accessories must be accessories of the thing sold.
--  7. Money links are checked again whenever one of their things changes (it became an accessory, an
--     errand, not kept, a wish again …), at the end of the transaction; and a link to a fulfilled general
--     wish counts as one to its bought model in the loop check (137 accepted thing → wish + model → thing).
--  8. A general wish stays general while it has models (137 let it become an item, and buying a model
--     then failed); a thing stays an item while it has accessories.
--  9. A row is put back from the keys it names over the table's defaults, never NULL for a missing key,
--     and a generated column is computed (137 inserted every column, so a NOT NULL or generated column
--     added later broke chain saves and old snapshots).
-- 10. Links are web addresses: url and image_url start with https:// or http:// (CHECK, NOT VALID: rows
--     from before are not read now). The rules trigger completes a link written without its scheme
--     (www.elkjop.no/… → https://…) and refuses anything else in url; a picture link that is not a web
--     address is not kept. A NOT VALID check still applies to every later write of an old row, so an old
--     row's link is completed when the row is next written, and one that is no web address at all moves
--     into its notes ("Link: …") instead of blocking the row. Both checks are validated here when no row
--     breaks them.
-- 11. Indexes: shop_price_points (user_id, checked_at) for the sweep's trim, shop_items (user_id,
--     created_at desc, id) for the list's order; 029's idx_shop_items_user goes (134's (user_id, list,
--     status) and the new one start with user_id). shop_items.user_id and shop_categories.user_id take
--     auth.uid() by default, like every other table.
--
-- Functions run as the caller (row level security and the owner lock apply), except
-- shop_restore_price_history and the two checks that run when a transaction ends (deleting an account
-- runs them as Supabase Auth's role, which can't read these tables): SECURITY DEFINER, search_path '',
-- every query scoped to the row's own account. Only identifiers read from the catalogue reach dynamic SQL
-- (%I / regclass); values travel as parameters.

-- ─── Columns, indexes, defaults ──────────────────────────────────────────────
alter table public.shop_items add column if not exists sale_undo jsonb;
alter table public.shop_items drop constraint if exists shop_items_sale_undo_check;
alter table public.shop_items add constraint shop_items_sale_undo_check
  check (sale_undo is null or jsonb_typeof(sale_undo) = 'object');
comment on column public.shop_items.sale_undo is
  'What Undo of this sale puts back beside the rows: the accessories it moved and the money link it made or changed. Written by shop_record_sale on the thing sold, read by shop_undo_sale; cleared with the sale.';

create index if not exists idx_shop_price_points_user_checked on public.shop_price_points (user_id, checked_at);
create index if not exists idx_shop_items_user_created on public.shop_items (user_id, created_at desc, id);
drop index if exists public.idx_shop_items_user;

alter table public.shop_items alter column user_id set default auth.uid();
alter table public.shop_categories alter column user_id set default auth.uid();

-- ─── Web links ───────────────────────────────────────────────────────────────
-- A link as stored: one https:// or http:// address (one written without its scheme gets https://), else NULL.
create or replace function public.shop_web_link(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v is null or v = '' or char_length(v) > 2048 or v ~ '[[:cntrl:]]' then null
    when v ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$' then v
    when v ~ '^//[^[:space:]/?#]+[^[:space:]]*$' then 'https:' || v
    when v ~* '^[[:alnum:]-]+(\.[[:alnum:]-]+)+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then 'https://' || v
  end
  from (select pg_catalog.btrim(p) as v) s
$$;

do $$ begin
  alter table public.shop_items add constraint shop_items_url_web_check check (url is null or url ~* '^https?://') not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.shop_items add constraint shop_items_image_url_web_check check (image_url is null or image_url ~* '^https?://') not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  if not exists (select 1 from public.shop_items where url !~* '^https?://') then
    alter table public.shop_items validate constraint shop_items_url_web_check;
  end if;
  if not exists (select 1 from public.shop_items where image_url !~* '^https?://') then
    alter table public.shop_items validate constraint shop_items_image_url_web_check;
  end if;
end $$;

-- ─── The one before-trigger (137's, with 3, 4, 5, 8 and 10) ──────────────────
create or replace function public.shop_items_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p      record;
  v_link text;
begin
  -- 0. Links are web addresses. A link written now: completed (no scheme → https://) or refused. An older
  --    link that never was one: completed, or kept in the notes instead — never a reason to refuse the row.
  if tg_op = 'INSERT' or new.url is distinct from old.url then
    v_link := public.shop_web_link(new.url);
    if v_link is null and nullif(pg_catalog.btrim(new.url), '') is not null then
      raise exception 'A link is one web address (https://…)' using errcode = '23514';
    end if;
    new.url := v_link;
  elsif new.url !~* '^https?://' then
    v_link := public.shop_web_link(new.url);
    if v_link is null then
      new.notes := concat_ws(E'\n', nullif(new.notes, ''), 'Link: ' || new.url);
    end if;
    new.url := v_link;
  end if;
  if tg_op = 'INSERT' or new.image_url is distinct from old.image_url or new.image_url !~* '^https?://' then
    new.image_url := public.shop_web_link(new.image_url);
  end if;

  -- a. A price without a currency: the region's (134's rule), else NOK.
  if new.price is not null and new.currency is null then
    new.currency := case when new.region = 'TR' then 'TRY' else 'NOK' end;
  end if;

  -- a2. A parent's kind is fixed while it has children: a general wish's models, an item's accessories.
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    if old.kind = 'general' and exists (select 1 from public.shop_items c where c.option_for = new.id) then
      raise exception 'A general wish with models stays a general wish — take its models off first' using errcode = '23514';
    end if;
    if old.kind = 'item' and exists (select 1 from public.shop_items c where c.accessory_of = new.id) then
      raise exception 'A thing with accessories stays a thing — take its accessories off first' using errcode = '23514';
    end if;
  end if;

  -- b. Bought: stamped once, and kept while bought (a write that clears it keeps the day). Leaving
  --    'bought' while sold or gone is refused, whatever the write sends — the sale is undone first.
  if new.status = 'bought' then
    if tg_op = 'INSERT' or old.status is distinct from 'bought' then
      new.bought_at := coalesce(new.bought_at, now());
    else
      new.bought_at := coalesce(new.bought_at, old.bought_at);
    end if;
  else
    if tg_op = 'UPDATE' and old.status = 'bought' and old.disposal is not null then
      raise exception 'Undo the sale first — "%" is sold or gone', new.title using errcode = '23514';
    end if;
    new.bought_at := null;
    new.market_price := null;
    new.market_currency := null;
    new.disposal := null;
  end if;

  -- c. Gone: always with a day (today in Oslo when none is sent), never before it was bought. What an
  --    Undo of the sale needs goes with the sale.
  if new.disposal is null then
    new.disposed_on := null;
    new.sale_price := null;
    new.sale_currency := null;
    new.sold_to := null;
    new.sale_group := null;
    new.sale_undo := null;
  else
    new.disposed_on := coalesce(new.disposed_on, (now() at time zone 'Europe/Oslo')::date);
    if new.bought_at is not null and new.disposed_on < public.oslo_day(new.bought_at) then
      raise exception 'It cannot leave (%) before it was bought (%)', new.disposed_on, public.oslo_day(new.bought_at) using errcode = '23514';
    end if;
    if new.sale_price is not null and new.sale_currency is null then
      new.sale_currency := coalesce(new.currency, 'NOK');
    end if;
  end if;

  -- d. The purchase rate: NOK needs none. A rate the write sends (or relabels) is typed by hand —
  --    "Norges Bank" only when it is exactly Norges Bank's rate of that day here (a row put back, a save
  --    undone). Otherwise Norges Bank's rate of the day it was bought, looked up again when the rate is
  --    cleared or the currency or the day changes (NULL until cached: "rate pending", never today's).
  if new.status <> 'bought' or new.price is null then
    new.fx_nok := null;
    new.fx_source := null;
  elsif new.currency = 'NOK' then
    new.fx_nok := 1;
    new.fx_source := 'fixed';
  elsif new.fx_nok is not null and (tg_op = 'INSERT' or new.fx_nok is distinct from old.fx_nok
                                    or new.fx_source is distinct from old.fx_source) then
    new.fx_source := case when new.fx_source = 'norges_bank'
                               and new.fx_nok = public.shop_rate(new.currency, public.oslo_day(new.bought_at))
                          then 'norges_bank' else 'manual' end;
  elsif new.fx_nok is null or tg_op = 'INSERT' or old.status is distinct from 'bought'
        or new.currency is distinct from old.currency
        or public.oslo_day(new.bought_at) is distinct from public.oslo_day(old.bought_at) then
    new.fx_nok := public.shop_rate(new.currency, public.oslo_day(new.bought_at));
    new.fx_source := case when new.fx_nok is null then null else 'norges_bank' end;
  end if;

  -- e. The same for money back, on the day it left.
  if new.sale_price is null then
    new.sale_fx_nok := null;
    new.sale_fx_source := null;
  elsif new.sale_currency = 'NOK' then
    new.sale_fx_nok := 1;
    new.sale_fx_source := 'fixed';
  elsif new.sale_fx_nok is not null and (tg_op = 'INSERT' or new.sale_fx_nok is distinct from old.sale_fx_nok
                                         or new.sale_fx_source is distinct from old.sale_fx_source) then
    new.sale_fx_source := case when new.sale_fx_source = 'norges_bank'
                                    and new.sale_fx_nok = public.shop_rate(new.sale_currency, new.disposed_on)
                               then 'norges_bank' else 'manual' end;
  elsif new.sale_fx_nok is null or tg_op = 'INSERT' or old.sale_price is null
        or new.sale_currency is distinct from old.sale_currency or new.disposed_on is distinct from old.disposed_on then
    new.sale_fx_nok := public.shop_rate(new.sale_currency, new.disposed_on);
    new.sale_fx_source := case when new.sale_fx_nok is null then null else 'norges_bank' end;
  end if;

  -- f. Parents: a model's general wish, an accessory's item — the owner's own, one level deep both
  --    ways; a child without a category takes its parent's.
  if new.option_for is not null and (tg_op = 'INSERT' or new.option_for is distinct from old.option_for) then
    select user_id, kind, category_id into p from public.shop_items where id = new.option_for;
    if not found or p.user_id <> new.user_id or p.kind <> 'general' then
      raise exception 'A model belongs to a general wish of the same owner' using errcode = '23514';
    end if;
    new.category_id := coalesce(new.category_id, p.category_id);
  end if;
  if new.accessory_of is not null and (tg_op = 'INSERT' or new.accessory_of is distinct from old.accessory_of) then
    select user_id, kind, accessory_of as parent, category_id into p from public.shop_items where id = new.accessory_of;
    if not found or p.user_id <> new.user_id or p.kind <> 'item' or p.parent is not null then
      raise exception 'An accessory belongs to an item of the same owner that is not an accessory itself' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.shop_items where accessory_of = new.id) then
      raise exception 'An item with accessories of its own cannot become an accessory' using errcode = '23514';
    end if;
    new.category_id := coalesce(new.category_id, p.category_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shop_items_rules on public.shop_items;
create trigger trg_shop_items_rules
  before insert or update on public.shop_items
  for each row execute function public.shop_items_rules();

-- ─── Extra costs: the rate rule of 3 ─────────────────────────────────────────
create or replace function public.shop_item_costs_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.shop_items where id = new.item_id and user_id = new.user_id) then
    raise exception 'A cost belongs to one of your own items' using errcode = '23514';
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

-- ─── Money links (7) ─────────────────────────────────────────────────────────
-- Why a money link can't stand, or NULL: from one of your things you have or had (not an accessory, not
-- an errand, kept), to another thing or a wish on the wishlist (not an accessory), one owner.
create or replace function public.shop_link_problem(p_from uuid, p_to uuid, p_user uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  f record;
  t record;
begin
  select user_id, list, kind, status, kept, accessory_of into f from public.shop_items where id = p_from;
  select user_id, list, accessory_of into t from public.shop_items where id = p_to;
  if f.user_id is distinct from p_user or t.user_id is distinct from p_user
     or f.list <> 'wishlist' or f.kind <> 'item' or f.status <> 'bought' or not f.kept or f.accessory_of is not null
     or t.list <> 'wishlist' or t.accessory_of is not null then
    return 'A money link goes from one of your things to another thing or a wish (never an accessory, an errand or a thing not yours to keep)';
  end if;
  return null;
end;
$$;

-- Does the money from p_start reach p_target? Along the account's links (leaving out link p_skip) and from
-- a fulfilled general wish to its bought models: a link to the wish counts as a link to the model.
create or replace function public.shop_money_reaches(p_start uuid, p_target uuid, p_user uuid, p_skip uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  with recursive edges(src, dst) as (
    select l.from_id, l.to_id
      from public.shop_item_links l
     where l.user_id = p_user and l.id is distinct from p_skip
    union all
    select w.id, m.id
      from public.shop_items w
      join public.shop_items m on m.option_for = w.id
     where w.user_id = p_user and m.user_id = p_user and w.kind = 'general' and w.status = 'fulfilled'
       and m.status = 'bought' and coalesce(m.disposal, '') <> 'returned'
  ), ahead(id) as (
    select p_start
    union
    select e.dst from ahead a join edges e on e.src = a.id
  )
  select exists (select 1 from ahead where id = p_target)
$$;

create or replace function public.shop_item_links_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_problem text;
begin
  perform pg_advisory_xact_lock(hashtext('shop_item_links:' || new.user_id::text));
  v_problem := public.shop_link_problem(new.from_id, new.to_id, new.user_id);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '23514';
  end if;
  if public.shop_money_reaches(new.to_id, new.from_id, new.user_id, new.id) then
    raise exception 'That link would make a loop' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- A thing changed: every link it is part of must still stand (and a model's wish's links, which count
-- as the model's). Runs when the transaction ends, on the rows as they are then.
create or replace function public.shop_items_links_recheck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  v_problem text;
begin
  perform pg_advisory_xact_lock(hashtext('shop_item_links:' || new.user_id::text));
  for l in
    select k.id, k.from_id, k.to_id, k.user_id
      from public.shop_item_links k
     where k.user_id = new.user_id
       and (k.from_id = new.id or k.to_id = new.id or k.to_id = new.option_for or k.to_id = old.option_for)
  loop
    v_problem := public.shop_link_problem(l.from_id, l.to_id, l.user_id);
    if v_problem is not null then
      raise exception '"%" is in a money chain — take its money link off first (%)', new.title, v_problem using errcode = '23514';
    end if;
    if public.shop_money_reaches(l.to_id, l.from_id, l.user_id, l.id) then
      raise exception '"%" would make its money chain go round in a loop — take a money link off first', new.title using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_shop_items_links_recheck on public.shop_items;
create constraint trigger trg_shop_items_links_recheck
  after update on public.shop_items
  deferrable initially deferred
  for each row
  when (old.list is distinct from new.list or old.kind is distinct from new.kind or old.status is distinct from new.status
        or old.kept is distinct from new.kept or old.accessory_of is distinct from new.accessory_of
        or old.option_for is distinct from new.option_for or old.disposal is distinct from new.disposal)
  execute function public.shop_items_links_recheck();

-- ─── Sale groups stay whole (5) ──────────────────────────────────────────────
-- A row left its sale group (its sale undone, the group changed, or deleted): when the transaction ends,
-- no other row may still be in that group.
create or replace function public.shop_items_sale_group_whole()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.shop_items i where i.user_id = old.user_id and i.sale_group = old.sale_group) then
    if tg_op = 'DELETE' then
      raise exception '"%" was sold together with other things — undo that sale first', old.title using errcode = '23514';
    end if;
    raise exception 'Things sold together are taken back together — undo the whole sale' using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_shop_items_sale_group_left on public.shop_items;
create constraint trigger trg_shop_items_sale_group_left
  after update on public.shop_items
  deferrable initially deferred
  for each row
  when (old.sale_group is not null and old.sale_group is distinct from new.sale_group)
  execute function public.shop_items_sale_group_whole();
drop trigger if exists trg_shop_items_sale_group_deleted on public.shop_items;
create constraint trigger trg_shop_items_sale_group_deleted
  after delete on public.shop_items
  deferrable initially deferred
  for each row
  when (old.sale_group is not null)
  execute function public.shop_items_sale_group_whole();

-- ─── Selling and its Undo (6) ────────────────────────────────────────────────
-- One sale. p_rows: [{"id", "sale_price"}] — the thing first, then the accessories sold with it (each
-- with its share). p_keep: [{"id", "move_to"}] — its accessories kept: moved to another thing, or (null)
-- on their own. p_to / p_to_amount: where the money went (all of it, or an amount in p_currency). Any id
-- that is not one of your things (or not an accessory of the thing, in p_keep) fails the whole sale. What
-- its Undo needs beside the rows is written on the thing (sale_undo).
create or replace function public.shop_record_sale(
  p_rows jsonb, p_disposal text, p_on date, p_currency text, p_sold_to text,
  p_keep jsonb default '[]'::jsonb, p_to uuid default null, p_to_amount numeric default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  g      uuid := case when jsonb_array_length(p_rows) > 1 then gen_random_uuid() else null end;
  r      jsonb;
  main   uuid := (p_rows -> 0 ->> 'id')::uuid;
  n      int;
  v_kept jsonb := '[]'::jsonb;
  v_link jsonb;
  v_was  numeric;
  v_had  boolean := false;
begin
  if main is null then
    raise exception 'Nothing to sell';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_keep, '[]'::jsonb)) loop
    v_kept := v_kept || jsonb_build_array(jsonb_build_object('id', r ->> 'id', 'to', nullif(r ->> 'move_to', '')));
  end loop;
  if p_to is not null then
    select l.amount, true into v_was, v_had from public.shop_item_links l where l.from_id = main and l.to_id = p_to;
    v_link := jsonb_build_object('to', p_to, 'made', not coalesce(v_had, false), 'amount_was', v_was, 'amount', p_to_amount);
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    update public.shop_items
       set disposal = p_disposal, disposed_on = p_on,
           sale_price = nullif(r ->> 'sale_price', '')::numeric,
           sale_currency = case when nullif(r ->> 'sale_price', '') is null then null else p_currency end,
           sold_to = nullif(btrim(coalesce(p_sold_to, '')), ''),
           sale_group = g,
           sale_undo = case when id = main and (jsonb_array_length(v_kept) > 0 or v_link is not null)
                            then jsonb_build_object('kept', v_kept, 'link', v_link) end
     where id = (r ->> 'id')::uuid and status = 'bought' and disposal is null;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'Not one of your things still yours: %', r ->> 'id';
    end if;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_keep, '[]'::jsonb)) loop
    update public.shop_items set accessory_of = nullif(r ->> 'move_to', '')::uuid
     where id = (r ->> 'id')::uuid and accessory_of = main;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'Not one of its accessories: %', r ->> 'id';
    end if;
  end loop;
  if p_to is not null then
    insert into public.shop_item_links (from_id, to_id, amount) values (main, p_to, p_to_amount)
    on conflict (from_id, to_id) do update set amount = excluded.amount;
  end if;
  return g;
end;
$$;

-- Undo a sale: the thing and everything sold with it are yours again; the accessories it moved go back
-- on the thing and the money link is as it was before — each only while still as the sale left it (a
-- later change is kept). sale_undo is written by the sale, but like any column it is input here: a record
-- can only move a row back onto the row that carries it and restore that row's own link. A group can hold
-- more than one record (sold things put in one group by a later write): each is replayed on its own row,
-- the asked-for row's first.
create or replace function public.shop_undo_sale(p_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  g      uuid;
  n      int;
  v_recs jsonb;
  v_rec  jsonb;
  v_main uuid;
  v_undo jsonb;
  k      jsonb;
  v_link jsonb;
  v_to   uuid;
begin
  select sale_group into g from public.shop_items where id = p_id and disposal is not null;
  if not found then
    raise exception 'Not sold or gone';
  end if;
  -- Read before the sale is taken back: that clears every record.
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'undo', i.sale_undo) order by (i.id = p_id) desc, i.id), '[]'::jsonb)
    into v_recs
    from public.shop_items i
   where (i.id = p_id or (g is not null and i.sale_group = g)) and i.sale_undo is not null;
  update public.shop_items set disposal = null where id = p_id or (g is not null and sale_group = g);
  get diagnostics n = row_count;

  for v_rec in select value from jsonb_array_elements(v_recs) loop
    v_main := (v_rec ->> 'id')::uuid;
    v_undo := v_rec -> 'undo';
    continue when jsonb_typeof(v_undo) is distinct from 'object';

    for k in select * from jsonb_array_elements(case when jsonb_typeof(v_undo -> 'kept') = 'array' then v_undo -> 'kept' else '[]'::jsonb end) loop
      begin
        update public.shop_items s set accessory_of = v_main
         where s.id = (k ->> 'id')::uuid
           and s.accessory_of is not distinct from nullif(k ->> 'to', '')::uuid
           and not exists (select 1 from public.shop_item_links l where l.from_id = s.id or l.to_id = s.id);
      exception when check_violation or invalid_text_representation then
        null;  -- it can't be an accessory of the thing again (it has its own now): it stays where it is
      end;
    end loop;

    v_link := v_undo -> 'link';
    if jsonb_typeof(v_link) = 'object' then
      begin
        v_to := (v_link ->> 'to')::uuid;
        if (v_link ->> 'made')::boolean then
          delete from public.shop_item_links l
           where l.from_id = v_main and l.to_id = v_to and l.amount is not distinct from nullif(v_link ->> 'amount', '')::numeric;
        else
          update public.shop_item_links l set amount = nullif(v_link ->> 'amount_was', '')::numeric
           where l.from_id = v_main and l.to_id = v_to and l.amount is not distinct from nullif(v_link ->> 'amount', '')::numeric;
        end if;
      exception when check_violation or invalid_text_representation then
        null;  -- not a link this sale could have written: left as it is
      end;
    end if;
  end loop;
  return n;
end;
$$;

-- ─── Delete with Undo (1, 2, 9) ──────────────────────────────────────────────
-- The columns a snapshot row can be written back to (not generated, not an always-identity), that the row
-- names (a key it lacks takes the column's default; a NOT NULL column sent as null too), less p_skip.
create or replace function public.shop_named_columns(p_table regclass, p_row jsonb, p_skip text[] default '{}')
returns text
language sql
stable
set search_path = ''
as $$
  select string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum)
    from pg_catalog.pg_attribute a
   where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
     and a.attgenerated = '' and a.attidentity <> 'a'
     and p_row ? a.attname::text
     and not (a.attname::text = any (p_skip))
     and not (a.attnotnull and jsonb_typeof(p_row -> a.attname::text) = 'null')
$$;

-- Deletes the rows and returns everything needed to put them back: their links and costs, their price
-- watch and history (which the delete takes with it), the children whose parent pointer it empties, and
-- the rows of any later table that points at shop_items (`more`). A table whose rows the caller may not
-- read, or could not put back (no INSERT where the delete takes its rows, no UPDATE of the column where
-- it empties it), is named in `hidden` instead: its rows go with the delete and don't come back with
-- Undo — a table whose rows must come back gets its own restore in shop_restore_items, as the price
-- watch has.
create or replace function public.shop_delete_items(p_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  snap     jsonb;
  v_more   jsonb := '[]'::jsonb;
  v_hidden jsonb := '[]'::jsonb;
  v_rows   jsonb;
  r        record;
begin
  select jsonb_build_object(
    'v', 2,
    'items', coalesce((select jsonb_agg(to_jsonb(i)) from public.shop_items i where i.id = any (p_ids)), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(to_jsonb(l)) from public.shop_item_links l where l.from_id = any (p_ids) or l.to_id = any (p_ids)), '[]'::jsonb),
    'costs', coalesce((select jsonb_agg(to_jsonb(c)) from public.shop_item_costs c where c.item_id = any (p_ids)), '[]'::jsonb),
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'accessory_of', i.accessory_of, 'option_for', i.option_for))
                          from public.shop_items i
                          where not (i.id = any (p_ids)) and (i.accessory_of = any (p_ids) or i.option_for = any (p_ids))), '[]'::jsonb),
    'watches', coalesce((select jsonb_agg(to_jsonb(w)) from public.shop_price_watch w where w.item_id = any (p_ids)), '[]'::jsonb),
    'points', coalesce((select jsonb_agg(to_jsonb(p) order by p.checked_at) from public.shop_price_points p where p.item_id = any (p_ids)), '[]'::jsonb)
  ) into snap;

  for r in
    select c.conrelid::regclass as tbl, cc.relname::text as name, a.attname::text as col, c.confdeltype as action
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class cc on cc.oid = c.conrelid
      join pg_catalog.pg_namespace ns on ns.oid = cc.relnamespace and ns.nspname = 'public'
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.shop_items'::regclass and array_length(c.conkey, 1) = 1
       and c.confdeltype in ('c', 'n')
       and cc.relname not in ('shop_items', 'shop_item_links', 'shop_item_costs', 'shop_price_watch', 'shop_price_points')
     order by cc.relname, a.attname
  loop
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %s x where x.%I = any ($1)', r.tbl, r.col)
        into v_rows using p_ids;
      if jsonb_array_length(v_rows) = 0 then
        null;
      elsif (case r.action when 'c' then pg_catalog.has_table_privilege(r.tbl, 'INSERT')
                           else pg_catalog.has_column_privilege(r.tbl, r.col, 'UPDATE') end) then
        v_more := v_more || jsonb_build_array(jsonb_build_object(
          'table', r.name, 'col', r.col, 'action', case r.action when 'c' then 'deleted' else 'emptied' end, 'rows', v_rows));
      else
        v_hidden := v_hidden || to_jsonb(r.name);
      end if;
    exception when insufficient_privilege then
      v_hidden := v_hidden || to_jsonb(r.name);
    end;
  end loop;

  delete from public.shop_items where id = any (p_ids);
  return snap || jsonb_build_object('more', v_more, 'hidden', v_hidden);
end;
$$;

-- The price watch and its history of the rows Delete's Undo just put back. Those tables are written by
-- shop-price only (the browser has no write on them), so this writes only for the rows this same
-- shop_restore_items call re-inserted — it lists their ids in the transaction-local setting
-- app.shop_restored, which the browser can't set (PostgREST exposes no set_config; 185 refuses it in the
-- read query and 189 watches it there), so a direct call writes nothing. The list counts only with this
-- transaction's own stamp (its id and start time) in front: a value left on a pooled connection by an
-- earlier request never matches. Then it checks what it is given: the caller's own account on every row,
-- web links only, a price from 0 below infinity (NaN sorts above infinity, so it goes too), a count from
-- 0 to 100 000, no time in the future and none made up — a watch or a point without its time is left out
-- (least(NULL, now()) would make it "checked just now", and the sweep would skip a forged "blocked" one) —
-- at most the newest 20 000 points.
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
                                       offers, currency, in_stock, was, return_days, last_ok_at, prev_low, prev_at)
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
         case when w.prev_at is null then null else least(w.prev_at, now()) end
    from jsonb_populate_recordset(null::public.shop_price_watch, coalesce(p_watches, '[]'::jsonb)) w
   where w.item_id = any (v_back) and w.checked_at is not null
     and exists (select 1 from public.shop_items i where i.id = w.item_id and i.user_id = v_user)
  on conflict (item_id) do nothing;
  get diagnostics k = row_count;
  n := n + k;
  insert into public.shop_price_points (id, user_id, item_id, checked_at, low, high, offers, currency, source)
  select coalesce(p.id, gen_random_uuid()), v_user, p.item_id, least(p.checked_at, now()), p.low,
         case when p.high >= 0 and p.high < 'Infinity' then p.high end,
         case when p.offers between 0 and 100000 then p.offers end,
         case when p.currency ~ '^[A-Z]{3}$' then p.currency end, case when p.source in ('prisjakt', 'store') then p.source end
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

-- Puts back what shop_delete_items returned — or saves a chain built in the app, which is the same shape:
-- rows with known ids and their links. One transaction under the caller's own row level security; every
-- trigger checks what comes back, and anything refused leaves nothing. The rows first (from the keys
-- they name), then their parents, costs, links, the children the delete unlinked, the price history and
-- the rows of later tables. A link that is no web address (only rows from before 187 have one) goes back
-- into the notes. What a row points at that is gone since (its category, its task, a money link's other
-- end) is left out, as that row's own delete left it — never a reason to refuse the Undo. A snapshot
-- from before 187 (no watches, points or more) is put back as far as it goes.
create or replace function public.shop_restore_items(p_snapshot jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r       jsonb;
  c       jsonb;
  m       jsonb;
  f       jsonb;
  v_fks   jsonb;
  v_there boolean;
  v_cols  text;
  v_url   text;
  v_id    uuid;
  v_ids   uuid[] := '{}';
  v_par   uuid;
  v_tbl   regclass;
  v_col   text;
  v_pk    text;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception 'Not a Shop snapshot' using errcode = '22023';
  end if;

  -- shop_items' single-column foreign keys into the app's own tables, from the catalogue (its category,
  -- its task, any added later); its own parents come in step 2, and auth.users is not the app's.
  select coalesce(jsonb_agg(jsonb_build_object('col', a.attname, 'ref', k.confrelid::oid, 'refcol', ra.attname)), '[]'::jsonb)
    into v_fks
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    join pg_catalog.pg_attribute ra on ra.attrelid = k.confrelid and ra.attnum = k.confkey[1]
    join pg_catalog.pg_class rc on rc.oid = k.confrelid
    join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace and rn.nspname = 'public'
   where k.contype = 'f' and k.conrelid = 'public.shop_items'::regclass and array_length(k.conkey, 1) = 1
     and k.confrelid <> 'public.shop_items'::regclass;

  -- 1. The rows, without their parents (a parent may come later in the list). A foreign key whose row is
  --    gone since — or one the caller can't see, which is not theirs — comes back empty (as that row's
  --    delete empties it, SET NULL). A table the caller may not read at all: its foreign key decides.
  for r in select value from jsonb_array_elements(coalesce(p_snapshot -> 'items', '[]'::jsonb)) loop
    if jsonb_typeof(r) <> 'object' then
      raise exception 'Not a Shop row' using errcode = '22023';
    end if;
    v_url := nullif(btrim(r ->> 'url'), '');
    if v_url is not null and public.shop_web_link(v_url) is null then
      r := r || jsonb_build_object('url', null, 'notes', concat_ws(E'\n', nullif(r ->> 'notes', ''), 'Link: ' || v_url));
    end if;
    for f in select value from jsonb_array_elements(v_fks) loop
      continue when nullif(r ->> (f ->> 'col'), '') is null
                 or not pg_catalog.has_column_privilege((f ->> 'ref')::oid, f ->> 'refcol', 'SELECT');
      execute format('select exists (select 1 from %s t where t.%I = (select x.%I from jsonb_populate_record(null::public.shop_items, $1) x))',
                     (f ->> 'ref')::oid::regclass, f ->> 'refcol', f ->> 'col')
        into v_there using r;
      if not v_there then
        r := jsonb_set(r, array[f ->> 'col'], 'null'::jsonb);
      end if;
    end loop;
    v_cols := public.shop_named_columns('public.shop_items'::regclass, r, array['accessory_of', 'option_for']);
    if v_cols is null then
      raise exception 'Not a Shop row' using errcode = '22023';
    end if;
    execute format('insert into public.shop_items (%s) select %s from jsonb_populate_record(null::public.shop_items, $1) returning id',
                   v_cols, v_cols)
      into v_id using r;
    v_ids := v_ids || v_id;
  end loop;

  -- 2. Their parents, now that every row is back. A parent that is gone for good (deleted since) leaves
  --    the row on its own; one the rules refuse stops everything.
  for r in select value from jsonb_array_elements(coalesce(p_snapshot -> 'items', '[]'::jsonb)) loop
    v_par := coalesce(nullif(r ->> 'accessory_of', '')::uuid, nullif(r ->> 'option_for', '')::uuid);
    continue when v_par is null or not exists (select 1 from public.shop_items where id = v_par);
    update public.shop_items
       set accessory_of = nullif(r ->> 'accessory_of', '')::uuid, option_for = nullif(r ->> 'option_for', '')::uuid
     where id = (r ->> 'id')::uuid;
  end loop;
  -- A general wish that came back is fulfilled exactly while one of its models is bought.
  perform public.shop_recompute_wish(i.id) from public.shop_items i where i.id = any (v_ids) and i.kind = 'general';

  -- 3. Costs and links (a link that exists again is skipped, and so is one whose other end is gone since:
  --    that thing's delete took the link with it).
  for r in select value from jsonb_array_elements(coalesce(p_snapshot -> 'costs', '[]'::jsonb)) loop
    v_cols := public.shop_named_columns('public.shop_item_costs'::regclass, r);
    if v_cols is null then
      raise exception 'Not a Shop cost' using errcode = '22023';
    end if;
    execute format('insert into public.shop_item_costs (%s) select %s from jsonb_populate_record(null::public.shop_item_costs, $1)',
                   v_cols, v_cols) using r;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_snapshot -> 'links', '[]'::jsonb)) loop
    v_cols := public.shop_named_columns('public.shop_item_links'::regclass, r);
    if v_cols is null then
      raise exception 'Not a Shop link' using errcode = '22023';
    end if;
    continue when not exists (select 1 from public.shop_items i where i.id = (r ->> 'from_id')::uuid)
               or not exists (select 1 from public.shop_items i where i.id = (r ->> 'to_id')::uuid);
    execute format('insert into public.shop_item_links (%s) select %s from jsonb_populate_record(null::public.shop_item_links, $1) on conflict do nothing',
                   v_cols, v_cols) using r;
  end loop;

  -- 4. Children the delete only unlinked: their parent back, while they are still on their own and can be
  --    a child again (no money link of their own, the rules allow it) — else they stay as they are.
  for c in select value from jsonb_array_elements(coalesce(p_snapshot -> 'children', '[]'::jsonb)) loop
    begin
      update public.shop_items s
         set accessory_of = nullif(c ->> 'accessory_of', '')::uuid,
             option_for   = nullif(c ->> 'option_for', '')::uuid
       where s.id = (c ->> 'id')::uuid and s.accessory_of is null and s.option_for is null
         and (nullif(c ->> 'accessory_of', '') is null
              or not exists (select 1 from public.shop_item_links l where l.from_id = s.id or l.to_id = s.id));
    exception when check_violation or foreign_key_violation then
      null;
    end;
  end loop;

  -- 5. The price watch and its history — of the rows step 1 put back only: the helper writes for the ids
  --    in this transaction-local setting, which lives just for the call (the browser can't set it), behind
  --    this transaction's stamp (the helper checks it is its own transaction's).
  if jsonb_array_length(coalesce(p_snapshot -> 'watches', '[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(p_snapshot -> 'points', '[]'::jsonb)) > 0 then
    perform pg_catalog.set_config('app.shop_restored',
      pg_catalog.txid_current()::text || '/' || extract(epoch from pg_catalog.now())::text || '|' || pg_catalog.array_to_string(v_ids, ','), true);
    perform public.shop_restore_price_history(p_snapshot -> 'watches', p_snapshot -> 'points');
    perform pg_catalog.set_config('app.shop_restored', '', true);
  end if;

  -- 6. Rows of later tables that point at shop_items: deleted ones back, emptied pointers back (while
  --    still empty). Only what shop_delete_items keeps: a table that really points at shop_items with a
  --    foreign key that deletes (deleted) or empties (emptied), never one of Shop's own five. A row the
  --    caller may not write back (no grant — shop_delete_items names such a table in `hidden`, but an
  --    older or forged snapshot may still carry it — or its table's own row level security refuses it),
  --    or whose other links are gone since, stays out; the rest of the Undo goes on.
  for m in select value from jsonb_array_elements(coalesce(p_snapshot -> 'more', '[]'::jsonb)) loop
    v_tbl := to_regclass(format('public.%I', m ->> 'table'));
    v_col := m ->> 'col';
    continue when v_tbl is null or not exists (
      select 1 from pg_catalog.pg_constraint k
        join pg_catalog.pg_class cc on cc.oid = k.conrelid
        join pg_catalog.pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       where k.contype = 'f' and k.conrelid = v_tbl and k.confrelid = 'public.shop_items'::regclass
         and array_length(k.conkey, 1) = 1 and a.attname::text = v_col
         and k.confdeltype = case m ->> 'action' when 'deleted' then 'c' when 'emptied' then 'n' end
         and cc.relname not in ('shop_items', 'shop_item_links', 'shop_item_costs', 'shop_price_watch', 'shop_price_points'));
    for r in select value from jsonb_array_elements(coalesce(m -> 'rows', '[]'::jsonb)) loop
      begin
        if m ->> 'action' = 'deleted' then
          v_cols := public.shop_named_columns(v_tbl, r);
          continue when v_cols is null;
          execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) on conflict do nothing',
                         v_tbl, v_cols, v_cols, v_tbl) using r;
        else
          select a.attname::text into v_pk
            from pg_catalog.pg_index x join pg_catalog.pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
           where x.indrelid = v_tbl and x.indisprimary and x.indnatts = 1;
          continue when v_pk is null;
          execute format('update %s t set %I = ($1 ->> %L)::uuid where t.%I::text = ($1 ->> %L) and t.%I is null',
                         v_tbl, v_col, v_col, v_pk, v_pk, v_col) using r;
        end if;
      exception when insufficient_privilege or foreign_key_violation then
        null;  -- this row stays out: the caller may not write it there, or what it points at is gone
      end;
    end loop;
  end loop;
end;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.shop_web_link(text) from public, anon;
revoke all on function public.shop_link_problem(uuid, uuid, uuid) from public, anon;
revoke all on function public.shop_money_reaches(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.shop_named_columns(regclass, jsonb, text[]) from public, anon;
revoke all on function public.shop_restore_price_history(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.shop_record_sale(jsonb, text, date, text, text, jsonb, uuid, numeric) from public, anon;
revoke all on function public.shop_undo_sale(uuid) from public, anon;
revoke all on function public.shop_delete_items(uuid[]) from public, anon;
revoke all on function public.shop_restore_items(jsonb) from public, anon;
revoke all on function public.shop_items_links_recheck() from public, anon, authenticated, service_role;
revoke all on function public.shop_items_sale_group_whole() from public, anon, authenticated, service_role;
grant execute on function public.shop_web_link(text) to authenticated, service_role;
grant execute on function public.shop_link_problem(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.shop_money_reaches(uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.shop_named_columns(regclass, jsonb, text[]) to authenticated;
grant execute on function public.shop_restore_price_history(jsonb, jsonb) to authenticated;
grant execute on function public.shop_record_sale(jsonb, text, date, text, text, jsonb, uuid, numeric) to authenticated;
grant execute on function public.shop_undo_sale(uuid) to authenticated;
grant execute on function public.shop_delete_items(uuid[]) to authenticated;
grant execute on function public.shop_restore_items(jsonb) to authenticated;

comment on function public.shop_restore_items(jsonb) is
  'Puts back a shop_delete_items snapshot (rows, then parents, costs, links, unlinked children, price history, later tables) or saves a chain built in the app — one transaction, as the caller.';
comment on function public.shop_restore_price_history(jsonb, jsonb) is
  'Delete''s Undo of the price watch and its history: only for the rows that same shop_restore_items call put back (app.shop_restored; a direct call writes nothing), every field checked.';
