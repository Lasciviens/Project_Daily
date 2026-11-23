-- A copy of migration 203's section 2 (the Shop receipt branch, 203_shop_receipt_discount_picture_memory.sql): its source
-- memory, the same objects as 204's section 8. verify-db-ai-learning applies it before and after 204 and checks that both
-- orders leave the same database; once 203 is in supabase/migrations, the check reads the real file and fails when this
-- copy differs from it.
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
