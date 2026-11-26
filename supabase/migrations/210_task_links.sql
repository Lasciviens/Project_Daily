-- 210 · A task's link to the thing it plans (Phase 3, step A1; plan approved by the owner 25.11.2026 —
-- docs/features/tasks.md → "Linked items"). Data model and moving the existing links only: no completion effects
-- (step A3) and no new screens (step A2).
--
-- A. The link columns on tasks, an "exclusive arc": one nullable foreign key per kind of thing — movie_entry_id
--    (user_movie_entries), tv_entry_id (user_tv_entries; with link_season + link_episode for one episode: both or
--    neither), shop_item_id, wish_item_id, football_plan_id, game_id, book_id — beside 141's hevy_routine_id. A CHECK
--    (num_nonnulls <= 1) lets a task link to at most one thing. ON DELETE SET NULL: deleting the thing keeps the task.
--    source_type / source_id stay as a label, written by the trigger from whichever link is set (the CHECK widened).
-- B. One open plan per thing (owner: "Yes"): a partial unique index per column for tasks not done or cancelled (an
--    episode: per show, season and episode). A done plan allows a new one (a rewatch). Training is left out: a
--    routine is planned every week, so several open sessions of one routine are normal.
-- C. trg_tasks_links (every writer: the sheet, the assistant, a sync, Undo): the linked row must be the task's own
--    user's (IT011 otherwise — a foreign key alone admits another account's id); a title guess of 141 never beats a
--    real link; the label follows the link; an old writer's movie / show label (source_type + source_id) names its
--    entry, so a website from before this migration still links.
-- D. The old back-pointers kept in step both ways for one release (they are NOT dropped): shop_items.task_id,
--    wish_items.promoted_task_id (a wish linked from 'idea' becomes 'planned', as Plan it did), football_plans.task_id.
--    A later cleanup PR removes them.
-- E. app_save_item(p_item, p_link): the one item save (the 1-argument function, unchanged) and its link in the same
--    transaction. p_link = {kind, id[, season, episode]}; an unknown kind, a bad id or another account's row is
--    refused before anything is written. The 1-argument call keeps working (163's app_football_plan, an old website).
-- F. The data move: the old pointers copied into the new columns (counts in the deploy log, no personal data).
--
-- Security (AGENTS.md → the warning): every link id is input — checked for its owner where it enters (the save) and
-- for every writer (the trigger); no link id is ever the target of a write made with outside credentials. The new
-- columns are not in a confirmed Ask AI proposal's column lists (verify-ai-confirm checks it). No new table.
-- Functions are SECURITY INVOKER with search_path '': they act with the caller's rights and row security, and each
-- query is scoped to the task's own user as well.
-- Not in app_undo_links: these are links inside the app (foreign keys), not to an outside copy — Undo puts them back.

-- ── A. The columns and their rules ───────────────────────────────────────────

alter table public.tasks
  add column if not exists movie_entry_id   uuid references public.user_movie_entries(id) on delete set null,
  add column if not exists tv_entry_id      uuid references public.user_tv_entries(id) on delete set null,
  add column if not exists link_season      integer,
  add column if not exists link_episode     integer,
  add column if not exists shop_item_id     uuid references public.shop_items(id) on delete set null,
  add column if not exists wish_item_id     uuid references public.wish_items(id) on delete set null,
  add column if not exists football_plan_id uuid references public.football_plans(id) on delete set null,
  add column if not exists game_id          uuid references public.games(id) on delete set null,
  add column if not exists book_id          uuid references public.books(id) on delete set null;

alter table public.tasks drop constraint if exists tasks_one_link;
alter table public.tasks add constraint tasks_one_link check (num_nonnulls(
  hevy_routine_id, movie_entry_id, tv_entry_id, shop_item_id, wish_item_id, football_plan_id, game_id, book_id) <= 1);

alter table public.tasks drop constraint if exists tasks_link_episode;
alter table public.tasks add constraint tasks_link_episode check (
  (link_season is null and link_episode is null)
  or (tv_entry_id is not null and link_season is not null and link_episode is not null
      and link_season between 0 and 999 and link_episode between 0 and 9999));

alter table public.tasks drop constraint if exists tasks_source_type_check;
alter table public.tasks add constraint tasks_source_type_check check (source_type in (
  'manual', 'movie', 'tv_series', 'media', 'calendar', 'ai', 'training_session', 'project_item',
  'shop_item', 'wish', 'football', 'game', 'book'));

comment on column public.tasks.movie_entry_id is 'The movie this task plans (210). At most one link per task (tasks_one_link); one open plan per movie.';
comment on column public.tasks.tv_entry_id is 'The show this task plans (210); with link_season + link_episode, one episode of it.';
comment on column public.tasks.shop_item_id is 'The shop item this task plans (210). shop_items.task_id is kept in step until the cleanup PR.';
comment on column public.tasks.wish_item_id is 'The wish this task plans (210). wish_items.promoted_task_id is kept in step until the cleanup PR.';
comment on column public.tasks.football_plan_id is 'The match record this task plans (210). football_plans.task_id is kept in step until the cleanup PR.';
comment on column public.tasks.game_id is 'The game this task plans (210).';
comment on column public.tasks.book_id is 'The book this task plans (210).';

-- 155's two vocabularies: the task's labels now include the new kinds (an edit sends its label back unchanged).
create or replace function public.item_task_source(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type is null then 'manual'
    when p_type = 'tv_episode' then 'tv_series'
    when p_type in ('manual', 'movie', 'tv_series', 'media', 'calendar', 'ai', 'training_session', 'project_item',
                    'shop_item', 'wish', 'football', 'game', 'book') then p_type
    else 'manual'
  end
$$;
grant execute on function public.item_task_source(text) to authenticated, service_role;

-- ── C. Whose the linked row is, and the trigger for every writer ─────────────

-- True when the thing of this kind and id is p_user's. The caller's row security applies as well (invoker).
create or replace function public.task_link_ok(p_user uuid, p_kind text, p_id text)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_user is null or p_id is null then return false; end if;
  if p_kind = 'training' then
    return exists (select 1 from public.hevy_routines r where r.id = p_id and r.user_id = p_user);
  end if;
  if p_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  if p_kind = 'movie' then
    return exists (select 1 from public.user_movie_entries e where e.id = p_id::uuid and e.user_id = p_user);
  elsif p_kind = 'tv' then
    return exists (select 1 from public.user_tv_entries e where e.id = p_id::uuid and e.user_id = p_user);
  elsif p_kind = 'shop_item' then
    return exists (select 1 from public.shop_items s where s.id = p_id::uuid and s.user_id = p_user);
  elsif p_kind = 'wish' then
    return exists (select 1 from public.wish_items w where w.id = p_id::uuid and w.user_id = p_user);
  elsif p_kind = 'football' then
    return exists (select 1 from public.football_plans f where f.id = p_id::uuid and f.user_id = p_user);
  elsif p_kind = 'game' then
    return exists (select 1 from public.games g where g.id = p_id::uuid and g.user_id = p_user);
  elsif p_kind = 'book' then
    return exists (select 1 from public.books b where b.id = p_id::uuid and b.user_id = p_user);
  end if;
  return false;
end
$$;
revoke all on function public.task_link_ok(uuid, text, text) from public, anon;
grant execute on function public.task_link_ok(uuid, text, text) to authenticated, service_role;

-- BEFORE INSERT OR UPDATE on tasks. Runs after 141's trg_tasks_link_training (BEFORE triggers run in name order).
create or replace function public.tasks_links()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_other boolean;
begin
  -- An episode goes with its show (a deleted show's SET NULL clears it too).
  if new.tv_entry_id is null then new.link_season := null; new.link_episode := null; end if;

  -- An old writer (a website from before 210): its movie or show label names the entry, when it is the task's
  -- user's and no other open plan holds it.
  if num_nonnulls(new.hevy_routine_id, new.movie_entry_id, new.tv_entry_id, new.shop_item_id, new.wish_item_id,
                  new.football_plan_id, new.game_id, new.book_id) = 0
     and new.source_id is not null and new.source_type in ('movie', 'tv_series')
     and (tg_op = 'INSERT' or (new.source_type, new.source_id) is distinct from (old.source_type, old.source_id)) then
    if new.source_type = 'movie' and public.task_link_ok(new.user_id, 'movie', new.source_id::text) then
      select exists (select 1 from public.tasks x where x.movie_entry_id = new.source_id and x.id <> new.id and x.user_id = new.user_id
                       and x.status not in ('done', 'cancelled')) into v_other;
      if not v_other or new.status in ('done', 'cancelled') then new.movie_entry_id := new.source_id; end if;
    elsif new.source_type = 'tv_series' and public.task_link_ok(new.user_id, 'tv', new.source_id::text) then
      new.tv_entry_id := new.source_id;
    end if;
  end if;

  -- 141's title guess never beats a real link (a task named like a routine that plans a movie).
  if num_nonnulls(new.movie_entry_id, new.tv_entry_id, new.shop_item_id, new.wish_item_id, new.football_plan_id,
                  new.game_id, new.book_id) > 0
     and new.hevy_routine_id is not null and new.source_type in ('manual', 'ai')
     and (tg_op = 'INSERT' or new.hevy_routine_id is distinct from old.hevy_routine_id) then
    new.hevy_routine_id := null;
  end if;

  -- Every link set or changed by this write is the task's own user's (a foreign key admits any account's id).
  if (new.hevy_routine_id is not null and (tg_op = 'INSERT' or new.hevy_routine_id is distinct from old.hevy_routine_id or new.user_id is distinct from old.user_id)
        and not public.task_link_ok(new.user_id, 'training', new.hevy_routine_id))
     or (new.movie_entry_id is not null and (tg_op = 'INSERT' or new.movie_entry_id is distinct from old.movie_entry_id or new.user_id is distinct from old.user_id)
        and not public.task_link_ok(new.user_id, 'movie', new.movie_entry_id::text))
     or (new.tv_entry_id is not null and (tg_op = 'INSERT' or new.tv_entry_id is distinct from old.tv_entry_id or new.user_id is distinct from old.user_id)
        and not public.task_link_ok(new.user_id, 'tv', new.tv_entry_id::text))
     or (new.shop_item_id is not null and (tg_op = 'INSERT' or new.shop_item_id is distinct from old.shop_item_id or new.user_id is distinct from old.user_id)
        and not public.task_link_ok(new.user_id, 'shop_item', new.shop_item_id::text))
     or (new.wish_item_id is not null and (tg_op = 'INSERT' or new.wish_item_id is distinct from old.wish_item_id or new.user_id is distinct from old.user_id)
        and not public.task_link_ok(new.user_id, 'wish', new.wish_item_id::text))
     or (new.football_plan_id is not null and (tg_op = 'INSERT' or new.football_plan_id is distinct from old.football_plan_id or new.user_id is distinct from old.user_id)
        and not public.task_link_ok(new.user_id, 'football', new.football_plan_id::text))
     or (new.game_id is not null and (tg_op = 'INSERT' or new.game_id is distinct from old.game_id or new.user_id is distinct from old.user_id)
        and not public.task_link_ok(new.user_id, 'game', new.game_id::text))
     or (new.book_id is not null and (tg_op = 'INSERT' or new.book_id is distinct from old.book_id or new.user_id is distinct from old.user_id)
        and not public.task_link_ok(new.user_id, 'book', new.book_id::text)) then
    raise exception 'That linked item is not yours, or it is not there any more' using errcode = 'IT011';
  end if;

  -- The label follows the link (141's routine keeps the label it has: training_session, or a guessed manual one).
  if new.movie_entry_id is not null then new.source_type := 'movie'; new.source_id := new.movie_entry_id;
  elsif new.tv_entry_id is not null then new.source_type := 'tv_series'; new.source_id := new.tv_entry_id;
  elsif new.shop_item_id is not null then new.source_type := 'shop_item'; new.source_id := new.shop_item_id;
  elsif new.wish_item_id is not null then new.source_type := 'wish'; new.source_id := new.wish_item_id;
  elsif new.football_plan_id is not null then new.source_type := 'football'; new.source_id := new.football_plan_id;
  elsif new.game_id is not null then new.source_type := 'game'; new.source_id := new.game_id;
  elsif new.book_id is not null then new.source_type := 'book'; new.source_id := new.book_id;
  end if;
  return new;
end
$$;
revoke all on function public.tasks_links() from public, anon;
grant execute on function public.tasks_links() to authenticated, service_role;

drop trigger if exists trg_tasks_links on public.tasks;
create trigger trg_tasks_links
  before insert or update on public.tasks
  for each row execute function public.tasks_links();

-- ── D. The old back-pointers in step, both ways (one release) ────────────────

-- tasks → the old columns. Each write is scoped to the task's own user and is a no-op when already in step, so the
-- two directions stop after one round.
create or replace function public.tasks_links_mirror()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.shop_item_id is not null and old.shop_item_id is distinct from new.shop_item_id then
    update public.shop_items set task_id = null where id = old.shop_item_id and user_id = new.user_id and task_id = new.id;
  end if;
  if new.shop_item_id is not null and (tg_op = 'INSERT' or old.shop_item_id is distinct from new.shop_item_id) then
    update public.shop_items set task_id = new.id
     where id = new.shop_item_id and user_id = new.user_id and task_id is distinct from new.id;
  end if;

  if tg_op = 'UPDATE' and old.wish_item_id is not null and old.wish_item_id is distinct from new.wish_item_id then
    update public.wish_items set promoted_task_id = null where id = old.wish_item_id and user_id = new.user_id and promoted_task_id = new.id;
  end if;
  if new.wish_item_id is not null and (tg_op = 'INSERT' or old.wish_item_id is distinct from new.wish_item_id) then
    -- Plan it turned an idea into a plan (WishesPage before 210); a wish already planned, done or dropped keeps its state.
    update public.wish_items set promoted_task_id = new.id, status = case when status = 'idea' then 'planned' else status end
     where id = new.wish_item_id and user_id = new.user_id and promoted_task_id is distinct from new.id;
  end if;

  if tg_op = 'UPDATE' and old.football_plan_id is not null and old.football_plan_id is distinct from new.football_plan_id then
    update public.football_plans set task_id = null where id = old.football_plan_id and user_id = new.user_id and task_id = new.id;
  end if;
  if new.football_plan_id is not null and (tg_op = 'INSERT' or old.football_plan_id is distinct from new.football_plan_id) then
    update public.football_plans set task_id = new.id
     where id = new.football_plan_id and user_id = new.user_id and task_id is distinct from new.id;
  end if;
  return null;
end
$$;
revoke all on function public.tasks_links_mirror() from public, anon;
grant execute on function public.tasks_links_mirror() to authenticated, service_role;

drop trigger if exists trg_tasks_links_mirror on public.tasks;
create trigger trg_tasks_links_mirror
  after insert or update of shop_item_id, wish_item_id, football_plan_id on public.tasks
  for each row execute function public.tasks_links_mirror();

-- The old columns → tasks (an old website, 163's app_football_plan, the football page's record of a match). The task
-- takes the link when it has none; another open plan of the same thing gives it up (the old pointer names one task).
create or replace function public.task_link_from_old()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_col  text := tg_argv[0];
  v_task uuid;
  v_was  uuid;
  v_can  boolean := false;
begin
  if tg_table_name = 'wish_items' then
    v_task := new.promoted_task_id;
    v_was := case when tg_op = 'UPDATE' then old.promoted_task_id end;
  else
    v_task := new.task_id;
    v_was := case when tg_op = 'UPDATE' then old.task_id end;
  end if;
  if v_task is not distinct from v_was then return null; end if;
  if v_col not in ('shop_item_id', 'wish_item_id', 'football_plan_id') then
    raise exception 'task_link_from_old: unknown column' using errcode = '22023';
  end if;
  -- The task the pointer now names can take the link: open or closed, with no other link of its own (or this one).
  if v_task is not null then
    execute format('select exists (select 1 from public.tasks t where t.id = $1 and t.user_id = $2'
                   || ' and (t.%I = $3 or num_nonnulls(t.hevy_routine_id, t.movie_entry_id, t.tv_entry_id, t.shop_item_id,'
                   || ' t.wish_item_id, t.football_plan_id, t.game_id, t.book_id) = 0))', v_col)
      into v_can using v_task, new.user_id, new.id;
  end if;
  -- Only when the link can move (the pointer cleared, or a task that can take it): never a link lost on the way.
  if v_was is not null and (v_task is null or v_can) then
    execute format('update public.tasks set %I = null where id = $1 and user_id = $2 and %I = $3', v_col, v_col)
      using v_was, new.user_id, new.id;
  end if;
  if v_task is not null and v_can then
    execute format('update public.tasks set %I = null where %I = $1 and user_id = $2 and id <> $3'
                   || ' and status not in (''done'', ''cancelled'')'
                   || ' and exists (select 1 from public.tasks t where t.id = $3 and t.user_id = $2 and t.status not in (''done'', ''cancelled''))',
                   v_col, v_col)
      using new.id, new.user_id, v_task;
    execute format('update public.tasks set %I = $1 where id = $2 and user_id = $3 and %I is null'
                   || ' and num_nonnulls(hevy_routine_id, movie_entry_id, tv_entry_id, shop_item_id, wish_item_id,'
                   || ' football_plan_id, game_id, book_id) = 0', v_col, v_col)
      using new.id, v_task, new.user_id;
  end if;
  return null;
end
$$;
revoke all on function public.task_link_from_old() from public, anon;
grant execute on function public.task_link_from_old() to authenticated, service_role;

drop trigger if exists trg_shop_items_task_link on public.shop_items;
create trigger trg_shop_items_task_link
  after insert or update of task_id on public.shop_items
  for each row execute function public.task_link_from_old('shop_item_id');
drop trigger if exists trg_wish_items_task_link on public.wish_items;
create trigger trg_wish_items_task_link
  after insert or update of promoted_task_id on public.wish_items
  for each row execute function public.task_link_from_old('wish_item_id');
drop trigger if exists trg_football_plans_task_link on public.football_plans;
create trigger trg_football_plans_task_link
  after insert or update of task_id on public.football_plans
  for each row execute function public.task_link_from_old('football_plan_id');

-- ── F. The data move (before the unique indexes; a second run changes nothing) ──
-- The slots' Apple Calendar copies are not re-sent for a label change (their area and content stay the same):
-- 175's own switch, on for this transaction's move only, then off again.
do $$
declare
  n_movie int; n_tv int; n_episode int; n_shop int; n_wish int; n_football int; n_left int;
begin
  perform set_config('app.icloud_readback', 'on', true);

  -- Movies: a movie label whose id is the task's user's entry. Among open tasks of one movie only the newest takes
  -- the link (one open plan per thing); a closed task always does.
  update public.tasks t set movie_entry_id = t.source_id
   where t.source_type = 'movie' and t.source_id is not null and t.movie_entry_id is null
     and num_nonnulls(t.hevy_routine_id, t.tv_entry_id, t.shop_item_id, t.wish_item_id, t.football_plan_id, t.game_id, t.book_id) = 0
     and exists (select 1 from public.user_movie_entries e where e.id = t.source_id and e.user_id = t.user_id)
     and (t.status in ('done', 'cancelled')
          or (t.id = (select x.id from public.tasks x
                       where x.user_id = t.user_id and x.source_type = 'movie' and x.source_id = t.source_id
                         and x.status not in ('done', 'cancelled')
                         and num_nonnulls(x.hevy_routine_id, x.tv_entry_id, x.shop_item_id, x.wish_item_id, x.football_plan_id, x.game_id, x.book_id) = 0
                       order by x.created_at desc nulls last, x.id desc limit 1)
              and not exists (select 1 from public.tasks y where y.movie_entry_id = t.source_id and y.id <> t.id
                                and y.status not in ('done', 'cancelled'))));
  get diagnostics n_movie = row_count;

  -- Shows: every show label whose id is the user's entry.
  update public.tasks t set tv_entry_id = t.source_id
   where t.source_type = 'tv_series' and t.source_id is not null and t.tv_entry_id is null
     and num_nonnulls(t.hevy_routine_id, t.movie_entry_id, t.shop_item_id, t.wish_item_id, t.football_plan_id, t.game_id, t.book_id) = 0
     and exists (select 1 from public.user_tv_entries e where e.id = t.source_id and e.user_id = t.user_id);
  get diagnostics n_tv = row_count;

  -- One episode: from the task's slot (the sheet stamps season and episode there for a single-episode plan, 043);
  -- among open plans of one episode only the newest.
  update public.tasks t set link_season = b.season_number, link_episode = b.episode_number
    from public.time_blocks b
   where b.task_id = t.id and b.user_id = t.user_id and b.source_type = 'tv_episode' and b.source_id = t.tv_entry_id
     and t.tv_entry_id is not null and t.link_episode is null
     and b.season_number between 0 and 999 and b.episode_number between 0 and 9999
     and (t.status in ('done', 'cancelled')
          or (t.id = (select x.id from public.tasks x join public.time_blocks xb on xb.task_id = x.id
                       where x.user_id = t.user_id and x.tv_entry_id = t.tv_entry_id and x.status not in ('done', 'cancelled')
                         and xb.season_number = b.season_number and xb.episode_number = b.episode_number
                       order by x.created_at desc nulls last, x.id desc limit 1)
              and not exists (select 1 from public.tasks y where y.tv_entry_id = t.tv_entry_id and y.id <> t.id
                                and y.link_season = b.season_number and y.link_episode = b.episode_number
                                and y.status not in ('done', 'cancelled'))));
  get diagnostics n_episode = row_count;

  -- Shop, wish, football: the old pointer names the task; a task named by two takes the newest one.
  update public.tasks t set shop_item_id = s.id
    from (select distinct on (task_id) id, task_id, user_id from public.shop_items
           where task_id is not null order by task_id, created_at desc nulls last, id desc) s
   where s.task_id = t.id and s.user_id = t.user_id and t.shop_item_id is null
     and num_nonnulls(t.hevy_routine_id, t.movie_entry_id, t.tv_entry_id, t.wish_item_id, t.football_plan_id, t.game_id, t.book_id) = 0;
  get diagnostics n_shop = row_count;

  update public.tasks t set wish_item_id = w.id
    from (select distinct on (promoted_task_id) id, promoted_task_id, user_id from public.wish_items
           where promoted_task_id is not null order by promoted_task_id, created_at desc nulls last, id desc) w
   where w.promoted_task_id = t.id and w.user_id = t.user_id and t.wish_item_id is null
     and num_nonnulls(t.hevy_routine_id, t.movie_entry_id, t.tv_entry_id, t.shop_item_id, t.football_plan_id, t.game_id, t.book_id) = 0;
  get diagnostics n_wish = row_count;

  update public.tasks t set football_plan_id = f.id
    from (select distinct on (task_id) id, task_id, user_id from public.football_plans
           where task_id is not null order by task_id, created_at desc nulls last, id desc) f
   where f.task_id = t.id and f.user_id = t.user_id and t.football_plan_id is null
     and num_nonnulls(t.hevy_routine_id, t.movie_entry_id, t.tv_entry_id, t.shop_item_id, t.wish_item_id, t.game_id, t.book_id) = 0;
  get diagnostics n_football = row_count;

  -- Old pointers left without the new link (another link on the task, two things naming one task, another account).
  select (select count(*) from public.shop_items s where s.task_id is not null
            and not exists (select 1 from public.tasks t where t.id = s.task_id and t.shop_item_id = s.id))
       + (select count(*) from public.wish_items w where w.promoted_task_id is not null
            and not exists (select 1 from public.tasks t where t.id = w.promoted_task_id and t.wish_item_id = w.id))
       + (select count(*) from public.football_plans f where f.task_id is not null
            and not exists (select 1 from public.tasks t where t.id = f.task_id and t.football_plan_id = f.id))
    into n_left;

  perform set_config('app.icloud_readback', '', true);
  raise notice '210 task links copied: % movie, % show (% with an episode), % shop, % wish, % football; % old pointers kept without a link',
    n_movie, n_tv, n_episode, n_shop, n_wish, n_football, n_left;
end $$;

-- ── B. Indexes: the lookups a delete needs, and one open plan per thing ──────

create index if not exists tasks_movie_entry_id_idx on public.tasks (movie_entry_id) where movie_entry_id is not null;
create index if not exists tasks_tv_entry_id_idx on public.tasks (tv_entry_id) where tv_entry_id is not null;
create index if not exists tasks_shop_item_id_idx on public.tasks (shop_item_id) where shop_item_id is not null;
create index if not exists tasks_wish_item_id_idx on public.tasks (wish_item_id) where wish_item_id is not null;
create index if not exists tasks_football_plan_id_idx on public.tasks (football_plan_id) where football_plan_id is not null;
create index if not exists tasks_game_id_idx on public.tasks (game_id) where game_id is not null;
create index if not exists tasks_book_id_idx on public.tasks (book_id) where book_id is not null;

create unique index if not exists tasks_open_plan_movie on public.tasks (movie_entry_id)
  where movie_entry_id is not null and status not in ('done', 'cancelled');
create unique index if not exists tasks_open_plan_episode on public.tasks (tv_entry_id, link_season, link_episode)
  where link_episode is not null and status not in ('done', 'cancelled');
create unique index if not exists tasks_open_plan_shop on public.tasks (shop_item_id)
  where shop_item_id is not null and status not in ('done', 'cancelled');
create unique index if not exists tasks_open_plan_wish on public.tasks (wish_item_id)
  where wish_item_id is not null and status not in ('done', 'cancelled');
create unique index if not exists tasks_open_plan_football on public.tasks (football_plan_id)
  where football_plan_id is not null and status not in ('done', 'cancelled');
create unique index if not exists tasks_open_plan_game on public.tasks (game_id)
  where game_id is not null and status not in ('done', 'cancelled');
create unique index if not exists tasks_open_plan_book on public.tasks (book_id)
  where book_id is not null and status not in ('done', 'cancelled');

-- ── E. The item save with its link ───────────────────────────────────────────

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
begin
  if p_link is null or jsonb_typeof(p_link) = 'null' then
    return public.app_save_item(p_item);
  end if;
  if v_user is null then
    raise exception 'app_save_item: not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(p_link) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_link) k where k not in ('kind', 'id', 'season', 'episode'))
     or jsonb_typeof(p_link -> 'kind') is distinct from 'string' or jsonb_typeof(p_link -> 'id') is distinct from 'string' then
    raise exception 'app_save_item: a link is {kind, id}' using errcode = '22023';
  end if;
  v_kind := p_link ->> 'kind';
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
  'The item save with its link (210): app_save_item(p_item) and the task''s link to its thing ({kind, id[, season, episode]}), in one transaction. Edit the save itself in app_save_item(jsonb).';
