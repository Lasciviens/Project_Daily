-- 211 · Linked plans (Phase 3, steps A2–A5; the owner's decisions of 25.11.2026 and "a2-a5 as one pr", 26.11.2026 —
-- docs/features/tasks.md → "Linked items"). Builds on 210's link columns.
--
-- A2. Football's "Plan it" in one transaction: app_save_item(p_item, p_link) also takes a match not recorded yet,
--     {kind: 'football', match: {eventId, league, kickoffAt, timeValid}}: the item, its match record and the task's
--     link are written together (before, the record followed in a second request after the save).
-- A3. What a done plan does, for every writer (the sheet, a row's tick, a sync, Undo):
--     · app-owned kinds — ticking does it once, unticking (reopen or cancel) undoes it, through the ledger
--       task_link_effects (primary key task + effect, so a second tick, a retry or an echo is harmless):
--         a wishlist thing → bought, bought_at = the tick (a purchase draft, A5); a wish → done ("fulfilled");
--         the last open task of a project phase → the phase done. The undo puts back only what the effect set, and
--         only while the row still holds exactly what the effect left there (the owner's own edit is never undone).
--     · synced kinds — the SYNC closes the plan and the app never writes a record of its own (owner: "never write
--       fake records"): a movie watch (media_watches, kind movie) on or after the plan's day closes its movie plan
--       (as 155's rule closes an episode's); a book's reading (reading_page_events) on the plan's day closes its book
--       plan; a game played on the plan's day (games.last_played_at) or whose play time grew closes its game plan
--       (never a plan whose day is still ahead). Training stays Hevy's (141/169, A4). Ticking such a plan by hand only
--       closes the task. Football, work and quick tasks stay hand-ticked.
--     · 141's title guess of a routine no longer touches a task with a real link or a project's task.
-- A4. One training identity: health_workouts.hevy_workout_id names the Hevy workout an Apple Health row is (unique),
--     worked out by the database for every writer — never taken from what a writer sends: written by Hevy
--     (raw.source.identifier 'com.hevyapp.hevy') or, for an older row without a source, named "Traditional Strength
--     Training", and starting within 2 minutes of the Hevy workout (the owner's sample of 25.11.2026: 0–5 s apart;
--     ends differ, so they are ignored). A Watch-only workout (com.apple.health.*) is never linked and never closes a
--     plan. The Watch's device name is never kept: raw.source.name is dropped on every write (and from the rows
--     already there). And 141's candidates take a plan ticked by hand earlier in its week, so the workout done on
--     another day of that week is linked to it (a plan ticked on Monday, trained on Tuesday: one plan, linked).
-- A5. notifications: the smallest server-written table (kind, link kind + id, created_at, read_at, a unique dedupe
--     key per user; no URL column — the screen builds the way to the thing from its kind). Rows come only from
--     notify() (SECURITY DEFINER, service role only) or the ledger's trigger; the browser reads them and sets
--     read_at, nothing else. First kind: shop_bought_draft — "a plan bought this thing: check the purchase" (Shop's
--     Needs a look shows it). Unticking removes the draft (only while it is still an unchanged draft) and the
--     notification.
--
-- Security (AGENTS.md → the warning): a link id is input — checked where it enters (210) and for every writer; no
-- effect makes a call outside the database and no link id is ever the target of a write with outside credentials.
-- The effect triggers are SECURITY DEFINER (they write rows the browser can't: the ledger, notifications) with
-- search_path '' and every query scoped to the row's own user; trigger functions can't be called directly. Ask AI
-- can't tick a task, write a link, the ledger or a notification (verify-ai-confirm). No audit trigger on the ledger
-- or notifications: both are written by the database only (bookkeeping of a task's tick, server messages) and Undo of
-- the tick undoes them through the trigger.

-- ── A2. The item save with a match not recorded yet ──────────────────────────

create or replace function public.app_save_item(p_item jsonb, p_link jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_kind    text;
  v_raw     text;
  v_season  integer;
  v_episode integer;
  v_answer  jsonb;
  v_task    uuid;
  v_status  text;
  v_taken   boolean;
  v_match   jsonb;
  v_event   text;
  v_league  text;
  v_kickoff timestamptz;
  v_plan    public.football_plans;
begin
  if p_link is null or jsonb_typeof(p_link) = 'null' then
    return public.app_save_item(p_item);
  end if;
  if v_user is null then
    raise exception 'app_save_item: not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(p_link) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_link) k where k not in ('kind', 'id', 'season', 'episode', 'match'))
     or jsonb_typeof(p_link -> 'kind') is distinct from 'string' then
    raise exception 'app_save_item: a link is {kind, id}' using errcode = '22023';
  end if;
  v_kind := p_link ->> 'kind';

  -- 211: a match the account has no record of yet — the item, its record and the link in this one transaction.
  if p_link ? 'match' then
    v_match := p_link -> 'match';
    if v_kind <> 'football' or p_link ? 'id' or jsonb_typeof(v_match) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_match) k where k not in ('eventId', 'league', 'kickoffAt', 'timeValid'))
       or jsonb_typeof(v_match -> 'eventId') is distinct from 'string' or jsonb_typeof(v_match -> 'league') is distinct from 'string'
       or jsonb_typeof(v_match -> 'kickoffAt') is distinct from 'string'
       or (v_match ? 'timeValid' and jsonb_typeof(v_match -> 'timeValid') is distinct from 'boolean') then
      raise exception 'app_save_item: a match is {eventId, league, kickoffAt, timeValid}' using errcode = '22023';
    end if;
    v_event := v_match ->> 'eventId';
    v_league := v_match ->> 'league';
    if v_event !~ '^[0-9]{1,20}$' or v_league !~ '^[a-z0-9][a-z0-9._-]{0,59}$' then
      raise exception 'app_save_item: that match has no ESPN id' using errcode = '22023';
    end if;
    begin
      v_kickoff := (v_match ->> 'kickoffAt')::timestamptz;
    exception when others then
      raise exception 'app_save_item: a kick-off is a time' using errcode = '22023';
    end;
    -- 163's lock: one save of a match at a time per account.
    perform pg_advisory_xact_lock(hashtextextended('football_plan:' || v_user::text || ':' || v_event, 0));
    select * into v_plan from public.football_plans where user_id = v_user and event_id = v_event for update;
    if v_plan.task_id is not null and exists (select 1 from public.tasks x where x.id = v_plan.task_id and x.user_id = v_user) then
      raise exception 'This is planned already: open that plan instead' using errcode = 'IT012';
    end if;
    v_answer := public.app_save_item(p_item);
    v_task := nullif(v_answer ->> 'taskId', '')::uuid;
    if v_task is null then
      return v_answer || jsonb_build_object('link', null);
    end if;
    -- The record names the task; 210's trigger links the task to the record (football_plan_id).
    if v_plan.id is null then
      insert into public.football_plans (user_id, event_id, league, task_id, kickoff_at, time_valid, origin)
      values (v_user, v_event, v_league, v_task, v_kickoff, coalesce((v_match ->> 'timeValid')::boolean, true), 'manual')
      returning * into v_plan;
    else
      update public.football_plans
         set task_id = v_task, kickoff_at = v_kickoff, time_valid = coalesce((v_match ->> 'timeValid')::boolean, true), origin = 'manual'
       where id = v_plan.id and user_id = v_user;
    end if;
    if not exists (select 1 from public.tasks x where x.id = v_task and x.user_id = v_user and x.football_plan_id = v_plan.id) then
      raise exception 'That linked item is not yours, or it is not there any more' using errcode = 'IT011';
    end if;
    return v_answer || jsonb_build_object('link', jsonb_build_object('kind', 'football', 'id', v_plan.id::text));
  end if;

  if jsonb_typeof(p_link -> 'id') is distinct from 'string' then
    raise exception 'app_save_item: a link is {kind, id}' using errcode = '22023';
  end if;
  v_raw := p_link ->> 'id';
  if v_kind not in ('movie', 'tv', 'shop_item', 'wish', 'football', 'game', 'book', 'training') then
    raise exception 'app_save_item: unknown link kind' using errcode = '22023';
  end if;
  if v_kind = 'training' then
    if v_raw !~ '^[0-9A-Za-z_-]{1,64}$' then raise exception 'app_save_item: a link id is not valid' using errcode = '22023'; end if;
  elsif v_raw !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'app_save_item: a link id is not valid' using errcode = '22023';
  end if;
  if p_link ? 'season' or p_link ? 'episode' then
    if v_kind <> 'tv' or jsonb_typeof(p_link -> 'season') is distinct from 'number' or jsonb_typeof(p_link -> 'episode') is distinct from 'number'
       or (p_link ->> 'season') !~ '^[0-9]{1,3}$' or (p_link ->> 'episode') !~ '^[0-9]{1,4}$' then
      raise exception 'app_save_item: an episode is a show''s season and episode number' using errcode = '22023';
    end if;
    v_season := (p_link ->> 'season')::integer;
    v_episode := (p_link ->> 'episode')::integer;
  end if;
  -- Before anything is written: the thing is the caller's own.
  if not public.task_link_ok(v_user, v_kind, v_raw) then
    raise exception 'That linked item is not yours, or it is not there any more' using errcode = 'IT011';
  end if;

  v_answer := public.app_save_item(p_item);
  v_task := nullif(v_answer ->> 'taskId', '')::uuid;
  -- A repeating item has no task of its own to link (its days are tasks of the repeat).
  if v_task is null then
    return v_answer || jsonb_build_object('link', null);
  end if;

  select x.status into v_status from public.tasks x where x.id = v_task and x.user_id = v_user;
  if not found then
    raise exception 'This item is not there any more' using errcode = 'IT004';
  end if;
  if v_status not in ('done', 'cancelled') and v_kind <> 'training' then
    select exists (
      select 1 from public.tasks x
       where x.user_id = v_user and x.id <> v_task and x.status not in ('done', 'cancelled')
         and case v_kind
               when 'movie' then x.movie_entry_id = v_raw::uuid
               when 'tv' then v_episode is not null and x.tv_entry_id = v_raw::uuid and x.link_season = v_season and x.link_episode = v_episode
               when 'shop_item' then x.shop_item_id = v_raw::uuid
               when 'wish' then x.wish_item_id = v_raw::uuid
               when 'football' then x.football_plan_id = v_raw::uuid
               when 'game' then x.game_id = v_raw::uuid
               when 'book' then x.book_id = v_raw::uuid
             end) into v_taken;
    if v_taken then
      raise exception 'This is planned already: open that plan instead' using errcode = 'IT012';
    end if;
  end if;

  update public.tasks set
    hevy_routine_id  = case when v_kind = 'training' then v_raw end,
    movie_entry_id   = case when v_kind = 'movie' then v_raw::uuid end,
    tv_entry_id      = case when v_kind = 'tv' then v_raw::uuid end,
    link_season      = case when v_kind = 'tv' then v_season end,
    link_episode     = case when v_kind = 'tv' then v_episode end,
    shop_item_id     = case when v_kind = 'shop_item' then v_raw::uuid end,
    wish_item_id     = case when v_kind = 'wish' then v_raw::uuid end,
    football_plan_id = case when v_kind = 'football' then v_raw::uuid end,
    game_id          = case when v_kind = 'game' then v_raw::uuid end,
    book_id          = case when v_kind = 'book' then v_raw::uuid end
  where id = v_task and user_id = v_user;
  if not found then
    raise exception 'This item is not there any more' using errcode = 'IT004';
  end if;

  return v_answer || jsonb_build_object('link', jsonb_build_object('kind', v_kind, 'id', v_raw));
end
$$;
revoke all on function public.app_save_item(jsonb, jsonb) from public, anon, service_role;
grant execute on function public.app_save_item(jsonb, jsonb) to authenticated;
comment on function public.app_save_item(jsonb, jsonb) is
  'The item save with its link (210): app_save_item(p_item) and the task''s link to its thing ({kind, id[, season, episode]}), in one transaction; 211: a match not recorded yet ({kind: football, match}) gets its record in the same transaction. Edit the save itself in app_save_item(jsonb).';

-- ── A5. notifications (the smallest server-written table) ────────────────────

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('shop_bought_draft')),
  link_kind  text check (link_kind in ('shop_item')),
  link_id    uuid,
  dedupe_key text not null check (char_length(dedupe_key) <= 200 and dedupe_key ~ '^[a-z_]+:[0-9a-f-]{36}$'),
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  constraint notifications_link check ((link_kind is null) = (link_id is null)),
  constraint notifications_once unique (user_id, dedupe_key)
);
alter table public.notifications enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_read_own') then
    create policy notifications_read_own on public.notifications for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_mark_own') then
    create policy notifications_mark_own on public.notifications for update to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
create index if not exists notifications_user_created on public.notifications (user_id, created_at desc);
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;
comment on table public.notifications is
  '211: server-written notices (kind + the thing by link kind and id; never a URL). Written only by notify() and the plan-effect trigger; the browser reads them and sets read_at.';

-- One notice, once (its dedupe key): the trigger's and the service role's door. Never granted to the browser.
create or replace function public.notify(p_user uuid, p_kind text, p_link_kind text, p_link_id uuid, p_dedupe text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then return null; end if;
  insert into public.notifications (user_id, kind, link_kind, link_id, dedupe_key)
  values (p_user, p_kind, p_link_kind, p_link_id, p_dedupe)
  on conflict (user_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.notify(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, text, uuid, text) to service_role;

-- ── A3. The ledger and the app-owned effects ─────────────────────────────────

create table if not exists public.task_link_effects (
  task_id    uuid not null references public.tasks(id) on delete cascade,
  effect     text not null check (effect in ('shop_bought', 'wish_done', 'phase_done')),
  user_id    uuid not null references auth.users(id) on delete cascade,
  target_id  uuid not null,
  before     jsonb not null,
  after      jsonb not null,
  created_at timestamptz not null default now(),
  primary key (task_id, effect)
);
alter table public.task_link_effects enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_link_effects' and policyname = 'task_link_effects_read_own') then
    create policy task_link_effects_read_own on public.task_link_effects for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;
create index if not exists task_link_effects_user on public.task_link_effects (user_id, created_at desc);
revoke all on public.task_link_effects from anon, authenticated;
grant select on public.task_link_effects to authenticated;
grant select, insert, update, delete on public.task_link_effects to service_role;
comment on table public.task_link_effects is
  '211: what a done plan did to its thing, once per task and effect (a second tick or an echo adds nothing); reopening the task undoes it while the thing still holds what the effect left. Written only by trg_tasks_link_effects.';

-- The purchase facts a draft is compared on (an owner's edit of any of them makes it the owner's purchase).
-- Missing columns read as null, so the list survives an older or newer Shop schema.
create or replace function public.shop_draft_facts(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, p_row -> k), '{}'::jsonb)
    from unnest(array['status', 'bought_at', 'price', 'currency', 'url', 'notes', 'title', 'return_by', 'warranty_until',
                      'kept', 'disposal', 'bought_channel', 'arrived_on', 'store_id', 'list', 'kind']) k
$$;
revoke all on function public.shop_draft_facts(jsonb) from public, anon;
grant execute on function public.shop_draft_facts(jsonb) to authenticated, service_role;

-- A plan's own day: its slot's date, else its due day (141's rule); null when undated.
create or replace function public.task_plan_day(p_task uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id), t.due_date)
    from public.tasks t where t.id = p_task
$$;
revoke all on function public.task_plan_day(uuid) from public, anon;
grant execute on function public.task_plan_day(uuid) to authenticated, service_role;

create or replace function public.tasks_link_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at    timestamptz;
  v_row   jsonb;
  e       public.task_link_effects;
  v_phase public.project_phases;
begin
  if new.user_id is null or not exists (select 1 from auth.users u where u.id = new.user_id) then return null; end if;

  -- ── Done: each effect once ──
  if new.status = 'done' and old.status is distinct from 'done' then
    v_at := coalesce(new.completed_at, now());

    -- A wishlist thing (not a quick-list errand, a general wish, or a thing already bought): bought, as a draft.
    if new.shop_item_id is not null then
      select to_jsonb(s) into v_row from public.shop_items s
       where s.id = new.shop_item_id and s.user_id = new.user_id
         and s.list = 'wishlist' and s.kind = 'item' and s.status = 'wishlist';
      if v_row is not null and not exists (select 1 from public.task_link_effects x where x.task_id = new.id and x.effect = 'shop_bought') then
        update public.shop_items set status = 'bought', bought_at = v_at
         where id = new.shop_item_id and user_id = new.user_id;
        insert into public.task_link_effects (task_id, effect, user_id, target_id, before, after)
        select new.id, 'shop_bought', new.user_id, s.id,
               jsonb_build_object('status', v_row -> 'status', 'bought_at', v_row -> 'bought_at'),
               public.shop_draft_facts(to_jsonb(s))
          from public.shop_items s where s.id = new.shop_item_id and s.user_id = new.user_id
        on conflict (task_id, effect) do nothing;
        perform public.notify(new.user_id, 'shop_bought_draft', 'shop_item', new.shop_item_id, 'shop_bought:' || new.id::text);
      end if;
    end if;

    -- A wish: fulfilled.
    if new.wish_item_id is not null then
      select to_jsonb(w) into v_row from public.wish_items w
       where w.id = new.wish_item_id and w.user_id = new.user_id and w.status in ('idea', 'planned');
      if v_row is not null and not exists (select 1 from public.task_link_effects x where x.task_id = new.id and x.effect = 'wish_done') then
        update public.wish_items set status = 'done' where id = new.wish_item_id and user_id = new.user_id;
        insert into public.task_link_effects (task_id, effect, user_id, target_id, before, after)
        values (new.id, 'wish_done', new.user_id, new.wish_item_id,
                jsonb_build_object('status', v_row -> 'status'), jsonb_build_object('status', 'done'))
        on conflict (task_id, effect) do nothing;
      end if;
    end if;

    -- A project phase: done when this was its last open task.
    if new.project_phase_id is not null then
      select * into v_phase from public.project_phases p
       where p.id = new.project_phase_id and p.user_id = new.user_id and p.status <> 'done';
      if v_phase.id is not null
         and not exists (select 1 from public.tasks x where x.project_phase_id = new.project_phase_id and x.user_id = new.user_id
                           and x.id <> new.id and x.status not in ('done', 'cancelled'))
         and not exists (select 1 from public.task_link_effects x where x.task_id = new.id and x.effect = 'phase_done') then
        update public.project_phases set status = 'done' where id = v_phase.id and user_id = new.user_id;
        insert into public.task_link_effects (task_id, effect, user_id, target_id, before, after)
        select new.id, 'phase_done', new.user_id, p.id, jsonb_build_object('status', v_phase.status),
               jsonb_build_object('status', p.status, 'done_at', p.done_at)
          from public.project_phases p where p.id = v_phase.id
        on conflict (task_id, effect) do nothing;
      end if;
    end if;
    return null;
  end if;

  -- ── Reopened or cancelled after done: undo each effect once, only what it set and still holds ──
  if old.status = 'done' and new.status is distinct from 'done' then
    for e in select * from public.task_link_effects x where x.task_id = new.id and x.user_id = new.user_id loop
      if e.effect = 'shop_bought' then
        update public.shop_items s
           set status = e.before ->> 'status', bought_at = (e.before ->> 'bought_at')::timestamptz
         where s.id = e.target_id and s.user_id = e.user_id
           and public.shop_draft_facts(to_jsonb(s)) = e.after;
        delete from public.notifications n
         where n.user_id = e.user_id and n.dedupe_key = 'shop_bought:' || new.id::text;
      elsif e.effect = 'wish_done' then
        update public.wish_items w set status = e.before ->> 'status'
         where w.id = e.target_id and w.user_id = e.user_id and w.status = e.after ->> 'status';
      elsif e.effect = 'phase_done' then
        update public.project_phases p set status = e.before ->> 'status'
         where p.id = e.target_id and p.user_id = e.user_id and p.status = 'done'
           and p.done_at is not distinct from (e.after ->> 'done_at')::timestamptz;
      end if;
      delete from public.task_link_effects x where x.task_id = e.task_id and x.effect = e.effect;
    end loop;
  end if;
  return null;
end
$$;
revoke all on function public.tasks_link_effects() from public, anon, authenticated;

drop trigger if exists trg_tasks_link_effects on public.tasks;
create trigger trg_tasks_link_effects
  after update of status on public.tasks
  for each row when (old.status is distinct from new.status and (old.status = 'done' or new.status = 'done'))
  execute function public.tasks_link_effects();

-- ── A3. Synced kinds: the sync closes the plan ───────────────────────────────

-- A plan of this thing still to do whose day the record falls on (or after, for a movie), closed at the record's
-- time. Undated: from the day it was made. Shared by the three triggers below; every query is the user's own.
create or replace function public.close_linked_plans(p_user uuid, p_col text, p_id uuid, p_day date, p_at timestamptz, p_on_or_after boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_col not in ('movie_entry_id', 'book_id', 'game_id') then
    raise exception 'close_linked_plans: unknown column' using errcode = '22023';
  end if;
  if p_user is null or p_id is null or p_day is null then return 0; end if;
  execute format(
    'update public.tasks t set status = ''done'', completed_at = $4
      where t.user_id = $1 and t.%I = $2 and t.status in (''open'', ''in_progress'', ''waiting'')
        and case when public.task_plan_day(t.id) is null then (t.created_at at time zone ''Europe/Oslo'')::date <= $3
                 when $5 then public.task_plan_day(t.id) <= $3
                 else public.task_plan_day(t.id) = $3 end', p_col)
    using p_user, p_id, p_day, coalesce(p_at, now()), p_on_or_after;
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function public.close_linked_plans(uuid, text, uuid, date, timestamptz, boolean) from public, anon, authenticated;

-- A movie watched (149's rule for the day: an unknown date written in the app = today, one from Trakt none).
create or replace function public.media_watch_closes_movie_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.movie_entry_id is null then return null; end if;
  perform public.close_linked_plans(new.user_id, 'movie_entry_id', new.movie_entry_id, public.media_watch_plan_day(new.watched_at),
    case when new.watched_at >= timestamptz '1971-01-01 00:00:00+00' then new.watched_at end, true);
  return null;
end
$$;
revoke all on function public.media_watch_closes_movie_plan() from public, anon, authenticated;
drop trigger if exists trg_media_watch_closes_movie_plan on public.media_watches;
create trigger trg_media_watch_closes_movie_plan after insert on public.media_watches
  for each row when (new.kind = 'movie') execute function public.media_watch_closes_movie_plan();

-- A book read on the plan's day (Kobo / KOReader's page rows).
create or replace function public.reading_closes_book_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.close_linked_plans(new.user_id, 'book_id', new.book_id, (new.started_at at time zone 'Europe/Oslo')::date, new.started_at, false);
  return null;
end
$$;
revoke all on function public.reading_closes_book_plan() from public, anon, authenticated;
drop trigger if exists trg_reading_closes_book_plan on public.reading_page_events;
create trigger trg_reading_closes_book_plan after insert on public.reading_page_events
  for each row execute function public.reading_closes_book_plan();

-- A game played (Steam, PSN, RP6 / ES-DE write these): on the plan's day, or its play time grew since the plan was
-- made — never a plan whose day is still ahead.
create or replace function public.game_play_closes_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Oslo')::date;
begin
  if new.last_played_at is distinct from old.last_played_at and new.last_played_at is not null
     and new.last_played_at <= now() + interval '1 day' then
    perform public.close_linked_plans(new.user_id, 'game_id', new.id, (new.last_played_at at time zone 'Europe/Oslo')::date, new.last_played_at, false);
  end if;
  if coalesce(new.play_seconds, 0) > coalesce(old.play_seconds, 0) then
    update public.tasks t set status = 'done', completed_at = now()
     where t.user_id = new.user_id and t.game_id = new.id and t.status in ('open', 'in_progress', 'waiting')
       and t.created_at <= now()
       and coalesce(public.task_plan_day(t.id), (t.created_at at time zone 'Europe/Oslo')::date) <= v_today;
  end if;
  return null;
end
$$;
revoke all on function public.game_play_closes_plan() from public, anon, authenticated;
drop trigger if exists trg_game_play_closes_plan on public.games;
create trigger trg_game_play_closes_plan after update of last_played_at, play_seconds on public.games
  for each row execute function public.game_play_closes_plan();

-- ── A3. 141's title guess: never a task with a real link or a project's task ──

create or replace function public.tasks_link_training()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r_id text;
  n    int;
begin
  if tg_op = 'UPDATE' and old.status = 'done' and new.status <> 'done'
     and new.hevy_workout_id is not distinct from old.hevy_workout_id then
    new.hevy_workout_id := null;
  end if;

  if tg_op = 'INSERT' then
    if new.hevy_routine_id is not null then return new; end if;
  elsif new.hevy_routine_id is distinct from old.hevy_routine_id
     or (new.title, new.domain, new.source_type, new.source_id)
        is not distinct from (old.title, old.domain, old.source_type, old.source_id) then
    return new;
  end if;

  if new.source_type = 'training_session' and new.source_id is not null then
    select r.id into r_id from public.hevy_routines r
     where lower(r.id) = new.source_id::text and r.user_id = new.user_id;
  elsif ((new.source_type in ('manual', 'ai') and new.domain = 'personal')
         or (new.source_type = 'training_session' and new.source_id is null))
        -- 211: a task that plans something else, or a project's task, is never guessed into a training session.
        and num_nonnulls(new.movie_entry_id, new.tv_entry_id, new.shop_item_id, new.wish_item_id, new.football_plan_id,
                         new.game_id, new.book_id) = 0
        and new.project_id is null then
    select min(r.id), count(*) into r_id, n from public.hevy_routines r
     where r.user_id = new.user_id
       and lower(btrim(r.title)) = lower(btrim(new.title));
    if n <> 1 then r_id := null; end if;
  end if;
  new.hevy_routine_id := r_id;
  return new;
end;
$$;

-- ── A4. One training identity ────────────────────────────────────────────────

alter table public.health_workouts
  add column if not exists hevy_workout_id text references public.hevy_workouts(id) on delete set null;
create unique index if not exists health_workouts_hevy_workout_key
  on public.health_workouts (hevy_workout_id) where hevy_workout_id is not null;
comment on column public.health_workouts.hevy_workout_id is
  '211: the Hevy workout this Apple Health row is (Hevy wrote it, or an older strength row without a source, starting within 2 minutes). Worked out by trg_health_workouts_hevy for every writer; a Watch-only workout is never linked.';

-- The Hevy workout an Apple row is, or null: Hevy's own row (or an older "Traditional Strength Training" without a
-- source) starting within 2 minutes; the nearest start no other Apple row holds.
create or replace function public.health_workout_hevy_match(p_user uuid, p_self text, p_name text, p_start timestamptz, p_raw jsonb)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_src text := case when jsonb_typeof(p_raw -> 'source') = 'object' then p_raw -> 'source' ->> 'identifier' end;
  v_id  text;
begin
  if p_user is null or p_start is null then return null; end if;
  if v_src is not null and v_src <> 'com.hevyapp.hevy' then return null; end if;
  if v_src is null and p_name is distinct from 'Traditional Strength Training' then return null; end if;
  select h.id into v_id from public.hevy_workouts h
   where h.user_id = p_user and h.start_time between p_start - interval '2 minutes' and p_start + interval '2 minutes'
     and not exists (select 1 from public.health_workouts x where x.hevy_workout_id = h.id and x.id is distinct from p_self)
   order by abs(extract(epoch from h.start_time - p_start)), h.id
   limit 1;
  return v_id;
end
$$;
revoke all on function public.health_workout_hevy_match(uuid, text, text, timestamptz, jsonb) from public, anon;
grant execute on function public.health_workout_hevy_match(uuid, text, text, timestamptz, jsonb) to authenticated, service_role;

-- BEFORE INSERT OR UPDATE on health_workouts: the device name goes; the link is the database's (a writer's value is
-- never taken: a link still true is kept, else the rule decides).
create or replace function public.health_workouts_hevy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(new.raw -> 'source') = 'object' and new.raw -> 'source' ? 'name' then
    new.raw := jsonb_set(new.raw, '{source}', (new.raw -> 'source') - 'name');
  elsif jsonb_typeof(new.raw -> 'source') = 'string' then
    new.raw := new.raw - 'source';
  end if;
  if tg_op = 'UPDATE' and old.hevy_workout_id is not null
     and public.health_workout_hevy_match(new.user_id, new.id, new.name, new.start_time, new.raw) is not distinct from old.hevy_workout_id then
    new.hevy_workout_id := old.hevy_workout_id;
  elsif tg_op = 'UPDATE' and old.hevy_workout_id is not null
     and exists (select 1 from public.hevy_workouts h where h.id = old.hevy_workout_id and h.user_id = new.user_id
                   and h.start_time between new.start_time - interval '2 minutes' and new.start_time + interval '2 minutes')
     and (case when jsonb_typeof(new.raw -> 'source') = 'object' then new.raw -> 'source' ->> 'identifier' end = 'com.hevyapp.hevy'
          or (jsonb_typeof(new.raw -> 'source') is distinct from 'object' and new.name = 'Traditional Strength Training')) then
    new.hevy_workout_id := old.hevy_workout_id;
  else
    new.hevy_workout_id := public.health_workout_hevy_match(new.user_id, new.id, new.name, new.start_time, new.raw);
  end if;
  return new;
end
$$;
revoke all on function public.health_workouts_hevy() from public, anon, authenticated;
drop trigger if exists trg_health_workouts_hevy on public.health_workouts;
create trigger trg_health_workouts_hevy
  before insert or update on public.health_workouts
  for each row execute function public.health_workouts_hevy();

-- A Hevy workout synced (or moved): the Apple rows near it that have no link look again.
create or replace function public.hevy_workout_links_health()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.start_time is null then return null; end if;
  update public.health_workouts h set hevy_workout_id = null
   where h.user_id = new.user_id and h.hevy_workout_id is null
     and h.start_time between new.start_time - interval '2 minutes' and new.start_time + interval '2 minutes';
  return null;
end
$$;
revoke all on function public.hevy_workout_links_health() from public, anon, authenticated;
drop trigger if exists trg_hevy_workout_links_health on public.hevy_workouts;
create trigger trg_hevy_workout_links_health
  after insert or update of start_time on public.hevy_workouts
  for each row execute function public.hevy_workout_links_health();

-- The rows already there: the device name dropped, each linked by the rule (oldest first, a second run changes
-- nothing). The count goes to the deploy log (no personal data).
do $$
declare
  r record;
  n_linked int;
begin
  for r in select h.id from public.health_workouts h order by h.start_time nulls last, h.id loop
    update public.health_workouts set synced_at = synced_at where id = r.id;
  end loop;
  select count(*) into n_linked from public.health_workouts where hevy_workout_id is not null;
  raise notice '211 Apple Health workouts linked to their Hevy workout: %', n_linked;
end $$;

-- 169's candidates: a plan of a routine ticked by hand earlier in its week is a candidate too, so the workout done
-- on another day of that week is linked to it (step 3 takes a plan still to do first).
create or replace function public.training_plan_candidates(p_user uuid, p_day date)
returns table (id uuid, routine text, status text, plan_day date, created_at timestamptz)
language sql
stable
set search_path = public
as $$
  select c.id, c.routine, c.status, c.plan_day, c.created_at
    from (
      select t.id, t.hevy_routine_id as routine, t.created_at, t.first_plan_date,
             case when t.status <> 'cancelled' then t.status
                  when t.closed_reason = 'missed' then 'missed'
                  else 'skipped' end as status,
             coalesce((select min(b.date) from time_blocks b where b.task_id = t.id), t.due_date) as plan_day
        from tasks t
       where t.user_id = p_user
         and t.hevy_workout_id is null
         and (t.hevy_routine_id is not null or t.source_type = 'training_session')
         and (t.status in ('open', 'in_progress', 'waiting', 'done')
              or (t.status = 'cancelled' and t.closed_reason = 'missed')
              or (t.status = 'cancelled' and t.hevy_routine_id is not null
                  and exists (select 1 from training_skips k where k.task_id = t.id)))
    ) c
   where c.plan_day between p_day - 6 and p_day
     and p_day <= coalesce(c.first_plan_date, c.plan_day) + 6
     and (c.status <> 'done' or c.plan_day = p_day or c.routine is not null)
$$;
revoke all on function public.training_plan_candidates(uuid, date) from public, anon, authenticated;

-- 169's rule; 211: step 3 offers a session still to do before one ticked by hand.
create or replace function public.hevy_workout_completes_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w_day date;
  t_id  uuid;
  n     int;
begin
  if new.start_time is null then return new; end if;
  if exists (select 1 from tasks where hevy_workout_id = new.id) then return new; end if;
  w_day := (new.start_time at time zone 'Europe/Oslo')::date;

  if new.routine_id is not null then
    select c.id into t_id from training_plan_candidates(new.user_id, w_day) c
     where c.routine = new.routine_id and c.plan_day = w_day
     order by case c.status when 'done' then 3 when 'skipped' then 2 when 'missed' then 1 else 0 end, c.created_at
     limit 1;
  end if;

  if t_id is null and new.routine_id is not null then
    select t.id into t_id
      from tasks t join hevy_workouts w on w.id = t.hevy_workout_id
     where t.user_id = new.user_id
       and t.hevy_routine_id = new.routine_id
       and w.routine_id is distinct from new.routine_id
       and coalesce((select min(b.date) from time_blocks b where b.task_id = t.id), t.due_date) = w_day
     order by t.created_at
     limit 1;
    if t_id is not null then
      update tasks
         set hevy_workout_id = new.id,
             completed_at    = coalesce(new.end_time, new.start_time)
       where id = t_id;
      return new;
    end if;
  end if;

  if t_id is null and new.routine_id is not null then
    select c.id into t_id from training_plan_candidates(new.user_id, w_day) c
     where c.routine = new.routine_id and c.plan_day < w_day
     order by (c.status = 'done'), (c.status = 'skipped'), c.plan_day desc, c.created_at
     limit 1;
  end if;

  if t_id is null then
    select min(c.id::text)::uuid, count(*) into t_id, n
      from training_plan_candidates(new.user_id, w_day) c
     where c.plan_day = w_day and c.status in ('open', 'in_progress', 'waiting', 'done')
       and (new.routine_id is null or c.routine is null);
    if n <> 1 then t_id := null; end if;
  end if;

  if t_id is not null then
    update tasks
       set hevy_workout_id = new.id,
           completed_at    = case when status = 'done' then completed_at
                                  else coalesce(new.end_time, new.start_time) end,
           status          = 'done'
     where id = t_id and hevy_workout_id is null;
  end if;
  return new;
end;
$$;

select public.owner_lock_apply('public.notifications');
select public.owner_lock_apply('public.task_link_effects');
