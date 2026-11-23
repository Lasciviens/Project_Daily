-- 203 — A receipt's discount as stored data, and the memory of which sites gave a product's picture (owner, 23.11.2026).
--
--  1. shop_items.discount_amount / discount_reason: what the receipt took off this thing and why (points, member, campaign,
--     coupon, staff, other). It is a fact about the purchase and changes no sum: `price` stays what was PAID, so Paid, Stats,
--     cost of use and the money chain read the same total as before and a discount is never subtracted twice. The normal
--     price stays in `market_price` ("Price before discount", migration 137: the normal price at the time) — a discount is
--     not "normal price minus paid" (points, a card or an extra coupon may come on top of a lower normal price). The currency
--     is the thing's own price currency. Cleared when the thing is no longer bought, as `market_price` is. Delete's Undo
--     needs nothing: its snapshot is the row as JSON and `shop_restore_items` writes every named column back.
--  2. ai_source_stats: per owner, job and host, how often a page read worked. Used here as job 'shop_picture': `shop-price`'s
--     `read` (asked `for: 'picture'`) notes the outcome through `ai_source_note` (service role only), the app ORDERS the
--     candidates it reads by it and lists it under Stores and rules, where the owner can clear a host (state 'ignored', the one
--     column the browser may write, with its own Undo). It never makes an address: every candidate is an address the call's own
--     web search returned and every read goes through shop-price's guards. The table and function are written exactly as
--     migration 204 (the AI learning) writes them, create-if-not-exists, so whichever runs first leaves the same objects and the
--     other changes nothing. Not audited (a browser change is a `state` toggle with its own Undo; Activity's Undo does not know
--     the bookkeeping columns).
-- Safe to re-run. Changes no existing row. No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── 1. The discount ─────────────────────────────────────────────────────────
alter table public.shop_items
  add column if not exists discount_amount numeric,
  add column if not exists discount_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shop_items_discount_ok' and conrelid = 'public.shop_items'::regclass) then
    alter table public.shop_items add constraint shop_items_discount_ok check (
      (discount_amount is null and discount_reason is null)
      or (discount_amount is not null and discount_reason is not null
          and discount_amount > 0 and discount_amount < 1000000000
          and discount_reason in ('points', 'member', 'campaign', 'coupon', 'staff', 'other'))
    ) not valid;
    alter table public.shop_items validate constraint shop_items_discount_ok;
  end if;
end $$;

-- A thing that is not bought has no purchase to have had a discount (the way 137 clears market_price).
create or replace function public.shop_items_discount_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from 'bought' then
    new.discount_amount := null;
    new.discount_reason := null;
  end if;
  return new;
end $$;
revoke all on function public.shop_items_discount_rules() from public, anon, authenticated, service_role;

drop trigger if exists trg_shop_items_discount on public.shop_items;
create trigger trg_shop_items_discount before insert or update on public.shop_items
  for each row execute function public.shop_items_discount_rules();

-- ─── 2. Source memory (the same objects as 204's section 8) ──────────────────
create table if not exists public.ai_source_stats (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  job              text not null check (job ~ '^[a-z_]{1,40}$'),
  -- A host name only, made by code from a URL it parsed: never a path, a query or a whole address.
  host             text not null check (char_length(host) <= 253 and host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  ok_count         integer not null default 0 check (ok_count between 0 and 100000000),
  fail_count       integer not null default 0 check (fail_count between 0 and 100000000),
  last_ok_at       timestamptz,
  last_fail_at     timestamptz,
  last_reason      text check (last_reason is null or last_reason ~ '^[a-z_]{1,40}$'),
  state            text not null default 'on' check (state in ('on', 'ignored')),
  state_changed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ai_source_stats_one_per_host unique (user_id, job, host)
);
alter table public.ai_source_stats enable row level security;
revoke all on public.ai_source_stats from anon, authenticated;
grant select on public.ai_source_stats to authenticated;
grant update (state) on public.ai_source_stats to authenticated;
grant select, insert, update, delete on public.ai_source_stats to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_source_stats' and policyname = 'Users read own ai_source_stats') then
    create policy "Users read own ai_source_stats" on public.ai_source_stats for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_source_stats' and policyname = 'Users change own ai_source_stats') then
    create policy "Users change own ai_source_stats" on public.ai_source_stats for update to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;

-- A signed-in caller may change `state` and nothing else (the column grant says so; this keeps the bookkeeping): the day it
-- changed is stamped. 204 re-creates the same trigger function for its tables; whichever runs last leaves the same guard.
create or replace function public.ai_source_stats_state() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.state is distinct from old.state then new.state_changed_at := now(); end if;
  return new;
end $$;
revoke all on function public.ai_source_stats_state() from public, anon, authenticated, service_role;
drop trigger if exists trg_ai_source_stats_state on public.ai_source_stats;
create trigger trg_ai_source_stats_state before update on public.ai_source_stats
  for each row execute function public.ai_source_stats_state();

create or replace function public.ai_source_note(p_user uuid, p_job text, p_host text, p_ok boolean, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_user is null or (select auth.uid()) is not null then
    raise exception 'ai_source_note: the service role only' using errcode = '42501';
  end if;
  insert into public.ai_source_stats (user_id, job, host, ok_count, fail_count, last_ok_at, last_fail_at, last_reason)
  values (p_user, p_job, lower(p_host), case when p_ok then 1 else 0 end, case when p_ok then 0 else 1 end,
          case when p_ok then now() end, case when p_ok then null else now() end, p_reason)
  on conflict (user_id, job, host) do update set
    ok_count = least(public.ai_source_stats.ok_count + case when p_ok then 1 else 0 end, 100000000),
    fail_count = least(public.ai_source_stats.fail_count + case when p_ok then 0 else 1 end, 100000000),
    last_ok_at = case when p_ok then now() else public.ai_source_stats.last_ok_at end,
    last_fail_at = case when p_ok then public.ai_source_stats.last_fail_at else now() end,
    last_reason = p_reason, updated_at = now();
end $$;
revoke all on function public.ai_source_note(uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.ai_source_note(uuid, text, text, boolean, text) to service_role;

select public.owner_lock_apply('public.ai_source_stats');
