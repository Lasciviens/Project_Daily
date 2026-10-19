-- ═══════════════════════════════════════════════════════════════════════════
-- 163 — Football (owner, 19.10.2026: "lets try. Under Media. One page …
-- possible to enter new teams or new tournaments … to be able to plan these
-- things to my daily day life"; planning: "Subscribe on a team + plan it.
-- So both"). The match data is ESPN's, read by the browser and never stored
-- (docs/integrations/espn.md); the database keeps only what is the owner's:
--
--  A. football_follows — the teams and tournaments followed: kind (team |
--     league), ref (ESPN's team id, or the tournament's slug — it goes into
--     ESPN's URLs, so only letters, digits and . _ -), the name and logo seen
--     when following, a team's own league (its table, club and squad pages)
--     and `subscribed`: a team's coming matches go into the day by
--     themselves (football/footballModel.syncPlan). A tournament can't be
--     subscribed (a whole Champions League in the day is never wanted).
--  B. football_plans — a match in the day: ESPN's event id, its tournament,
--     the task the match became (tasks — the one task table; ON DELETE SET
--     NULL: a deleted item leaves the row with no task, so the subscription
--     never adds that match again; 144's app_delete_rows restores the link
--     on Undo), the kick-off and whether ESPN had fixed it when it was
--     planned (the subscription moves the item when ESPN moves the match),
--     and its origin (the subscription, or "Plan it" by hand).
--  C. app_football_plan(plan, item) — the subscription's door: the item is
--     saved through app_save_item (155: task, slot, Google target) and the
--     plan row written in the SAME transaction, so a match can't be added
--     twice or added without its record. A match already planned is never
--     added again; a move edits only the plan's own task.
--
-- Audit: both tables get trg_audit (the owner's choices and the
-- subscription's writes are undoable from Developer → Activity).
-- Re-runnable: IF NOT EXISTS, the pg_policies guard, DROP … IF EXISTS before
-- every trigger, CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. football_follows ─────────────────────────────────────────────────────
create table if not exists public.football_follows (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('team', 'league')),
  ref         text not null check (ref ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  logo        text check (logo is null or (char_length(logo) <= 500 and logo ~* '^https://')),
  league      text check (league is null or league ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  subscribed  boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint football_follows_team_ref check (kind <> 'team' or ref ~ '^[0-9]{1,12}$'),
  constraint football_follows_subscribe_team check (not subscribed or kind = 'team'),
  constraint football_follows_once unique (user_id, kind, ref)
);
alter table public.football_follows enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'football_follows'
                 and policyname = 'Users manage own football follows') then
    create policy "Users manage own football follows" on public.football_follows for all
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
create index if not exists football_follows_user_order on public.football_follows (user_id, sort_order);
grant select, insert, update, delete on public.football_follows to authenticated;

create or replace function public.football_follows_tidy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  -- A tournament is its own league.
  if new.kind = 'league' then
    new.league := new.ref;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_football_follows_tidy on public.football_follows;
create trigger trg_football_follows_tidy
  before insert or update on public.football_follows
  for each row execute function public.football_follows_tidy();

drop trigger if exists trg_audit on public.football_follows;
create trigger trg_audit
  after insert or update or delete on public.football_follows
  for each row execute function public.log_audit();

-- ── B. football_plans ───────────────────────────────────────────────────────
create table if not exists public.football_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id    text not null check (event_id ~ '^[0-9]{1,20}$'),
  league      text not null check (league ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  task_id     uuid references public.tasks(id) on delete set null,
  kickoff_at  timestamptz not null,
  time_valid  boolean not null default true,
  origin      text not null default 'manual' check (origin in ('subscription', 'manual')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint football_plans_once unique (user_id, event_id)
);
alter table public.football_plans enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'football_plans'
                 and policyname = 'Users manage own football plans') then
    create policy "Users manage own football plans" on public.football_plans for all
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
create index if not exists football_plans_user_kickoff on public.football_plans (user_id, kickoff_at);
create index if not exists football_plans_task on public.football_plans (task_id) where task_id is not null;
grant select, insert, update, delete on public.football_plans to authenticated;

create or replace function public.football_plans_tidy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_id is not null and (tg_op = 'INSERT' or new.task_id is distinct from old.task_id)
     and not exists (select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id) then
    raise exception 'That task is not yours.' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_football_plans_tidy on public.football_plans;
create trigger trg_football_plans_tidy
  before insert or update on public.football_plans
  for each row execute function public.football_plans_tidy();

drop trigger if exists trg_audit on public.football_plans;
create trigger trg_audit
  after insert or update or delete on public.football_plans
  for each row execute function public.log_audit();

-- ── C. app_football_plan ────────────────────────────────────────────────────
-- p_plan: { eventId, league, kickoffAt, timeValid, origin }; p_item: what
-- itemApi.saveItem sends app_save_item (the item with section, today and
-- googleConnected). Without p_item.taskId it adds the match; with it, it moves
-- the plan's own task. Answers app_save_item's answer plus planned: true, or
-- { planned: false, reason } when it changed nothing.
create or replace function public.app_football_plan(p_plan jsonb, p_item jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_event  text := p_plan->>'eventId';
  v_task   uuid;
  v_plan   public.football_plans;
  v_answer jsonb;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if v_event is null or v_event !~ '^[0-9]{1,20}$' then
    raise exception 'That match has no ESPN id.' using errcode = '22023';
  end if;
  begin
    v_task := nullif(p_item->>'taskId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'That task id is not valid.' using errcode = '22023';
  end;

  select * into v_plan from public.football_plans
   where user_id = v_user and event_id = v_event
   for update;

  if v_task is null and v_plan.id is not null then
    -- In the day already, or its item was deleted: never a second time.
    return jsonb_build_object('planned', false, 'reason', case when v_plan.task_id is null then 'deleted' else 'planned' end);
  end if;
  if v_task is not null and (v_plan.id is null or v_plan.task_id is distinct from v_task) then
    return jsonb_build_object('planned', false, 'reason', 'not-this-match');
  end if;

  v_answer := public.app_save_item(p_item);

  insert into public.football_plans (user_id, event_id, league, task_id, kickoff_at, time_valid, origin)
  values (
    v_user, v_event, p_plan->>'league', nullif(v_answer->>'taskId', '')::uuid,
    (p_plan->>'kickoffAt')::timestamptz, coalesce((p_plan->>'timeValid')::boolean, true),
    coalesce(p_plan->>'origin', 'manual')
  )
  on conflict (user_id, event_id) do update
    set task_id = excluded.task_id, league = excluded.league,
        kickoff_at = excluded.kickoff_at, time_valid = excluded.time_valid;

  return v_answer || jsonb_build_object('planned', true);
end;
$$;
grant execute on function public.app_football_plan(jsonb, jsonb) to authenticated;

select public.owner_lock_apply('public.football_follows');
select public.owner_lock_apply('public.football_plans');
