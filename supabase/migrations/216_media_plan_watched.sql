-- 216 · A done movie or episode plan is a watch (owner, 28.11.2026: "A task is linke to a movie and with is marked as
-- completed than movie will be watched No?" — "Yes build it, and send to Trakt too"; then "Tv episodes too!! Make the
-- development there as well"). For movies and single episodes this reverses part of the owner's decision of 25.11.2026
-- (211: "the sync closes the plan and the app never writes a fake record"); a plan of a whole show marks the show's
-- next episode (owner, asked "should ticking a whole-show plan mark the show's next episode watched?": "Yes"); games,
-- books and training stay as 211 left them. docs/features/tasks.md → "Linked plans".
--
-- A. 211's A3 ledger gains two app-owned effects, movie_watched and episode_watched. Ticking a task that plans a movie (tasks.movie_entry_id)
--    — from any writer: Daily, the item screen, the phone, a Google Tasks pull, Undo — writes ONE watch of that movie
--    (media_watches, kind movie, source app), dated at the tick (completed_at, never in the future), exactly the row the
--    Media page's "watched" writes. 149's triggers do the rest: the movie's cache (watched_at, repeat_count), a
--    Wishlist / Upcoming film Completed (and a rewatch round ended), and the Trakt outbox (history_add at the watch's
--    own date — the drain sends it). Any other status (Watching, Paused, Dropped) becomes Completed, as the Media
--    page's Completed does.
--    No watch is written (and nothing goes in the ledger) when:
--      · the ledger already holds this task's watch (a second tick, a retry, an echo: 211's primary key);
--      · the movie already has a watch dated on the tick's day (Oslo) — the owner marked it on the Media page or on
--        Trakt and the sync brought it in: that watch is the record. (Marked on Trakt and not pulled yet: trakt-api's
--        drain reads the title's Trakt history before it sends this watch and drops the add when Trakt already has a
--        play that day — docs/integrations/trakt.md);
--      · the Trakt sync is writing (trakt_sync_writing()), or another trigger closed the plan (pg_trigger_depth() > 1:
--        a watch closed it through 211's close_linked_plans, so the watch is already there).
--    An episode (tasks.tv_entry_id + link_season + link_episode; 210) is the same effect, episode_watched — for a plan
--    of the whole show (no episode) the show's next episode, decided at the tick by show_next_episode() and recorded in
--    the ledger (the untick never works it out again; none → nothing is written, the plan just closes; and nothing when
--    any episode of the show already has a watch on the tick's day — that watch is the evening's record): one
--    media_watches row of that episode (kind episode — 149 makes its user_tv_episodes row on a first watch), dated at the
--    tick, which is what the Media page's checkbox (a first watch) and Watched again (one more) end up writing; 149's
--    cache keeps the episode's date and plays, 050's trigger the show's next-episode pointer, and the outbox sends
--    history_add as one episode of the show (the shows / seasons / episodes shape). The show moves on as the Trakt sync
--    would set it (traktSyncPlan's statusFor, so the app and Trakt agree): Completed once every aired regular episode by
--    the stored TMDB data has a watch, else Watching (from Wishlist, Upcoming, Paused or Watching); started_at is set
--    when empty, finished_at when Completed. Dropped, Completed and a rewatch round (149's cache ends it) stay.
--    043/155's rule (a watch of a planned episode removes its slots dated on or before the watch) keeps the TICKED
--    task's own slot: the plan is done, and its slot is its record of when it was planned (Daily shows it there; an
--    untick finds it in place). The effect names its task in a transaction-local setting stamped with the transaction
--    id (app.plan_tick, plan_tick_task()); any other slot of that episode follows the rule as before.
-- B. Unticking (reopen, or cancel after done) undoes it once, only while the watch is still the one the tick wrote —
--    same id, same date (a Trakt link the sync added since is fine: trakt_history_id is the sync's alone). Then the
--    watch is deleted (149's trigger queues history_remove_play for that one play: by its trakt_history_id, written
--    only by the sync, else the exact second), and the movie's previous status comes back only while it is still the
--    status the tick left. A watch the owner re-dated or deleted, or a status the owner changed, is left as it is.
--    Watching / Paused / Dropped come back through Paused, so 161's guard never reads Completed → Watching as a new
--    rewatch round; a rewatch round comes back with its own number and start. An episode's untick deletes its watch
--    the same way (149: the episode row stays, not watched, when it was its last watch — never the whole episode's
--    Trakt remove) and puts back the show's status, dates and rewatch round, only while the show still has exactly the
--    status and dates the tick left. A close time before 1971 writes no watch (Trakt's "unknown date" is the epoch), and
--    a tick put back by Undo with its own completed_at dates the watch there (capped at now).
--
-- Security (AGENTS.md → the warning): the movie or show id is input — checked for every writer by 210's trigger, and
-- read here only as the task's own user's row. Nothing here calls outside the database. The ledger is written only by
-- this trigger (no browser write); the watch the untick deletes is named by the ledger, scoped to the user and the
-- movie or episode,
-- and the Trakt play it removes is chosen by trakt-api from trakt_history_id (the sync's alone — 149's before trigger
-- drops any other writer's value) or the exact second, never from a browser-writable value. SECURITY DEFINER (it
-- writes the ledger) with search_path '' and every query scoped to the task's own user; a trigger function can't be
-- called directly. The slot marker (app.plan_tick) is honoured only with this transaction's id and can only spare one
-- slot from deletion; the browser can't set it (PostgREST exposes no set_config) and plan_tick_task() is not granted to
-- it. The episode slot rule's functions now run with search_path '' and every query scoped to the watch's own user.
-- No new column, so nothing for Ask AI's confirmed columns (verify-ai-confirm); no new table.

-- ── The ledger's effects ─────────────────────────────────────────────────────

alter table public.task_link_effects drop constraint if exists task_link_effects_effect_check;
alter table public.task_link_effects add constraint task_link_effects_effect_check
  check (effect in ('shop_bought', 'wish_done', 'phase_done', 'movie_watched', 'episode_watched'));
comment on table public.task_link_effects is
  '211: what a done plan did to its thing, once per task and effect (a second tick or an echo adds nothing); reopening the task undoes it while the thing still holds what the effect left. 216: movie_watched / episode_watched — the watch a done movie or episode plan wrote (after: watch_id, watched_at, status; an episode also season, episode). Written only by trg_tasks_link_effects.';

-- ── 043/155's slot rule keeps the ticked plan's own slot ─────────────────────

-- The task whose tick is writing an episode watch in THIS transaction (app.plan_tick = '<task id>:<txid>', set only by
-- tasks_link_effects), else null. A value from another transaction, or any other shape, is ignored. It can only spare
-- that one task's slot from the cleanup below — never delete, close or write anything.
create or replace function public.plan_tick_task()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v text := coalesce(current_setting('app.plan_tick', true), '');
begin
  if v !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]+$' then return null; end if;
  if split_part(v, ':', 2) <> txid_current()::text then return null; end if;
  return split_part(v, ':', 1)::uuid;
end
$$;
revoke all on function public.plan_tick_task() from public, anon, authenticated;

-- 155's media_watch_cleans_planned_block: the same rule (a watch of a planned episode closes that episode's open plans
-- and removes their slots dated on or before the watch), minus the ticked task's own slot; search_path '' and every
-- query scoped to the watch's own user.
create or replace function public.media_watch_cleans_planned_block() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_entry uuid;
  v_day   date := public.media_watch_plan_day(new.watched_at);
  v_keep  uuid := public.plan_tick_task();
begin
  if v_day is null or to_regclass('public.time_blocks') is null or not public.link_rule_enabled('episode_watched_cleans_block') then return null; end if;
  select tv_entry_id into v_entry from public.user_tv_episodes where id = new.episode_id and user_id = new.user_id;
  if v_entry is null then return null; end if;
  -- 155: the planned episode's task is done (before its slot goes).
  update public.tasks t set status = 'done'
   where t.user_id = new.user_id and t.status in ('open', 'in_progress', 'waiting')
     and t.id in (select b.task_id from public.time_blocks b
                   where b.user_id = new.user_id and b.source_type = 'tv_episode' and b.source_id = v_entry
                     and b.season_number = new.season_number and b.episode_number = new.episode_number
                     and b.date <= v_day and b.task_id is not null);
  delete from public.time_blocks b
   where b.user_id = new.user_id
     and b.source_type = 'tv_episode'
     and b.source_id = v_entry
     and b.season_number = new.season_number
     and b.episode_number = new.episode_number
     and b.date <= v_day
     and b.task_id is distinct from v_keep;
  return null;
end;
$$;
revoke all on function public.media_watch_cleans_planned_block() from public, anon, authenticated;

-- 043's rule for an episode's first watch (its row inserted), as 155 left it — the same step and the same exception.
create or replace function public.cleanup_block_on_episode_watched() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_day  date := public.media_watch_plan_day(new.watched_at);
  v_keep uuid := public.plan_tick_task();
begin
  if v_day is not null and public.link_rule_enabled('episode_watched_cleans_block') then
    -- 155: the planned episode's task is done (before its slot goes).
    update public.tasks t set status = 'done'
     where t.user_id = new.user_id and t.status in ('open', 'in_progress', 'waiting')
       and t.id in (select b.task_id from public.time_blocks b
                     where b.user_id = new.user_id and b.source_type = 'tv_episode' and b.source_id = new.tv_entry_id
                       and b.season_number = new.season_number and b.episode_number = new.episode_number
                       and b.date <= v_day and b.task_id is not null);
    delete from public.time_blocks b
     where b.user_id = new.user_id
       and b.source_type = 'tv_episode'
       and b.source_id = new.tv_entry_id
       and b.season_number = new.season_number
       and b.episode_number = new.episode_number
       and b.date <= v_day
       and b.task_id is distinct from v_keep;
  end if;
  return new;
end;
$$;
revoke all on function public.cleanup_block_on_episode_watched() from public, anon, authenticated;

-- ── A show's next episode (a plan of the whole show) ─────────────────────────

-- The episode the app shows as next up (useNextEpisode's rule), from the server's own data: the first aired regular
-- episode by the stored TMDB data (161's media_aired_episodes: seasons 1 … the last aired, so the season rolls over)
-- after 050's pointer (current_season / current_episode — the latest watched; 0 = none yet, so S1E1) that has no watch;
-- in a rewatch round, the first aired one with no watch since the round started (149's rule). None (no row) when every
-- aired episode is watched, nothing aired yet, or the show has no stored TMDB data — never a guess. Only the given user's
-- show; not the browser's to call.
create or replace function public.show_next_episode(p_entry uuid, p_user uuid)
returns table (season_number integer, episode_number integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  e public.user_tv_entries;
begin
  select * into e from public.user_tv_entries s where s.id = p_entry and s.user_id = p_user;
  if e.id is null or e.tv_series_id is null or not public.media_tmdb_known(e.tv_series_id) then return; end if;
  return query
    select a.season_number, a.episode_number
      from public.media_aired_episodes(e.tv_series_id) a
     where case when e.rewatch_round is not null and e.rewatch_started_at is not null then true
                when coalesce(e.current_episode, 0) <= 0 then true
                else (a.season_number, a.episode_number) > (e.current_season, e.current_episode) end
       and not exists (select 1 from public.media_watches w
                        where w.user_id = p_user and w.kind = 'episode' and w.tv_series_id = e.tv_series_id
                          and w.season_number = a.season_number and w.episode_number = a.episode_number
                          and (e.rewatch_round is null or e.rewatch_started_at is null
                               or w.watched_at >= e.rewatch_started_at
                               or (w.source = 'app' and w.created_at >= e.rewatch_started_at)))
     order by a.season_number, a.episode_number
     limit 1;
end
$$;
revoke all on function public.show_next_episode(uuid, uuid) from public, anon, authenticated;

-- ── The effects (211's function; the movie and episode parts are 216's) ──────

create or replace function public.tasks_link_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at      timestamptz;
  v_row     jsonb;
  e         public.task_link_effects;
  v_phase   public.project_phases;
  v_movie   public.user_movie_entries;
  v_show    public.user_tv_entries;
  v_tick    timestamptz;
  v_season  integer;
  v_episode integer;
  v_watch   uuid;
  v_watched timestamptz;
  v_status  text;
  v_back    text;
  v_restore boolean;
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
        -- Its state as the effect left it, with its clock: a wish the owner marked done again by hand is the owner's.
        insert into public.task_link_effects (task_id, effect, user_id, target_id, before, after)
        select new.id, 'wish_done', new.user_id, w.id, jsonb_build_object('status', v_row -> 'status'),
               jsonb_build_object('status', w.status, 'updated_at', to_jsonb(w) -> 'updated_at')
          from public.wish_items w where w.id = new.wish_item_id and w.user_id = new.user_id
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

    -- 216 · A movie: watched, dated at the tick (never in the future) — once, and not when a watch is its record already.
    if new.movie_entry_id is not null and pg_trigger_depth() = 1 and not public.trakt_sync_writing()
       and not exists (select 1 from public.task_link_effects x where x.task_id = new.id and x.effect = 'movie_watched') then
      v_at := date_trunc('second', least(v_at, now()));
      select * into v_movie from public.user_movie_entries m
       where m.id = new.movie_entry_id and m.user_id = new.user_id
       for update;
      -- A close time before 1971 is no tick time (Trakt's "unknown date" is the epoch): no watch is pushed for it.
      if v_movie.id is not null and v_at >= timestamptz '1971-01-02 00:00:00+00'
         and not exists (select 1 from public.media_watches w
                          where w.movie_entry_id = v_movie.id and w.user_id = new.user_id and w.kind = 'movie'
                            and w.watched_at >= timestamptz '1971-01-01 00:00:00+00'
                            and (w.watched_at at time zone 'Europe/Oslo')::date = (v_at at time zone 'Europe/Oslo')::date) then
        insert into public.media_watches (user_id, kind, movie_entry_id, watched_at)
        values (new.user_id, 'movie', v_movie.id, v_at)
        returning id, watched_at into v_watch, v_watched;
        -- 149's cache made a Wishlist / Upcoming film Completed or ended its rewatch round; any other status is made
        -- Completed the way the Media page's Completed does.
        update public.user_movie_entries set status = 'completed'
         where id = v_movie.id and user_id = new.user_id and status <> 'completed';
        insert into public.task_link_effects (task_id, effect, user_id, target_id, before, after)
        select new.id, 'movie_watched', new.user_id, m.id,
               jsonb_build_object('status', v_movie.status, 'rewatch_round', v_movie.rewatch_round,
                                  'rewatch_started_at', v_movie.rewatch_started_at),
               jsonb_build_object('watch_id', v_watch, 'watched_at', v_watched, 'status', m.status)
          from public.user_movie_entries m where m.id = v_movie.id and m.user_id = new.user_id
        on conflict (task_id, effect) do nothing;
      end if;
    end if;

    -- 216 · One episode of a show — the plan's own, or for a plan of the whole show the show's next episode, decided now
    -- and recorded (owner: "Yes") — watched, dated at the tick: the movie's rules. Its own slot stays (plan_tick_task).
    if new.tv_entry_id is not null and pg_trigger_depth() = 1 and not public.trakt_sync_writing()
       and not exists (select 1 from public.task_link_effects x where x.task_id = new.id and x.effect = 'episode_watched') then
      v_tick := date_trunc('second', least(coalesce(new.completed_at, now()), now()));
      select * into v_show from public.user_tv_entries s
       where s.id = new.tv_entry_id and s.user_id = new.user_id
       for update;
      v_season := new.link_season;
      v_episode := new.link_episode;
      if v_show.id is not null and v_season is null and v_episode is null then
        select n.season_number, n.episode_number into v_season, v_episode from public.show_next_episode(v_show.id, new.user_id) n;
      end if;
      if v_show.id is not null and v_show.tv_series_id is not null and v_tick >= timestamptz '1971-01-02 00:00:00+00'
         and v_season is not null and v_episode is not null
         and not exists (select 1 from public.media_watches w
                          where w.user_id = new.user_id and w.kind = 'episode' and w.tv_series_id = v_show.tv_series_id
                            -- A whole-show plan: any episode of the show watched that day is the evening's record.
                            and (new.link_season is null or (w.season_number = v_season and w.episode_number = v_episode))
                            and w.watched_at >= timestamptz '1971-01-01 00:00:00+00'
                            and (w.watched_at at time zone 'Europe/Oslo')::date = (v_tick at time zone 'Europe/Oslo')::date) then
        perform set_config('app.plan_tick', new.id::text || ':' || txid_current()::text, true);
        insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at)
        values (new.user_id, 'episode', v_show.tv_series_id, v_season, v_episode, v_tick)
        returning id, watched_at into v_watch, v_watched;
        perform set_config('app.plan_tick', '', true);
        -- The show moves on as the Trakt sync would set it (traktSyncPlan's statusFor), so the app and Trakt agree:
        -- Completed once every aired regular episode by the stored TMDB data has a watch (161's media_all_aired_watched),
        -- else Watching (a Wishlist, Upcoming or Paused show too); started_at set when empty, finished_at when Completed.
        -- Dropped, Completed and a rewatch round (149's cache ends it) are left as they are.
        update public.user_tv_entries s
           set status = t.target,
               started_at = coalesce(s.started_at, v_tick),
               finished_at = case when t.target = 'completed' then coalesce(s.finished_at, v_tick) else s.finished_at end
          from (select case when public.media_all_aired_watched(v_show.id) then 'completed' else 'watching' end as target) t
         where s.id = v_show.id and s.user_id = new.user_id
           and s.status in ('wishlist', 'upcoming', 'paused', 'watching') and s.rewatch_round is null
           and (s.status <> t.target or s.started_at is null or (t.target = 'completed' and s.finished_at is null));
        insert into public.task_link_effects (task_id, effect, user_id, target_id, before, after)
        select new.id, 'episode_watched', new.user_id, s.id,
               jsonb_build_object('status', v_show.status, 'rewatch_round', v_show.rewatch_round,
                                  'rewatch_started_at', v_show.rewatch_started_at,
                                  'started_at', to_jsonb(v_show.started_at), 'finished_at', to_jsonb(v_show.finished_at)),
               jsonb_build_object('watch_id', v_watch, 'watched_at', v_watched, 'status', s.status,
                                  'started_at', to_jsonb(s.started_at), 'finished_at', to_jsonb(s.finished_at),
                                  'season', v_season, 'episode', v_episode, 'next', new.link_season is null)
          from public.user_tv_entries s where s.id = v_show.id and s.user_id = new.user_id
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
         where w.id = e.target_id and w.user_id = e.user_id and w.status = e.after ->> 'status'
           and (to_jsonb(w) -> 'updated_at') is not distinct from (e.after -> 'updated_at');
      elsif e.effect = 'phase_done' then
        update public.project_phases p set status = e.before ->> 'status'
         where p.id = e.target_id and p.user_id = e.user_id and p.status = 'done'
           and p.done_at is not distinct from (e.after ->> 'done_at')::timestamptz;
      elsif e.effect = 'movie_watched' then
        -- 216 · Only the watch the tick wrote, still at its date (a Trakt link added by the sync since is fine).
        v_watch := null;
        select w.id into v_watch from public.media_watches w
         where w.id = (e.after ->> 'watch_id')::uuid and w.user_id = e.user_id and w.kind = 'movie'
           and w.movie_entry_id = e.target_id
           and w.watched_at is not distinct from (e.after ->> 'watched_at')::timestamptz
         for update;
        if v_watch is not null then
          select m.status into v_status from public.user_movie_entries m
           where m.id = e.target_id and m.user_id = e.user_id
           for update;
          v_back := e.before ->> 'status';
          v_restore := v_status is not distinct from (e.after ->> 'status') and v_back is distinct from v_status;
          -- Through Paused: 161's guard would read Completed → Watching as a new rewatch round.
          if v_restore and v_back in ('watching', 'paused', 'dropped') then
            update public.user_movie_entries set status = 'paused'
             where id = e.target_id and user_id = e.user_id and status <> 'paused';
          end if;
          delete from public.media_watches where id = v_watch and user_id = e.user_id;
          if v_restore and v_back in ('watching', 'paused', 'dropped') then
            update public.user_movie_entries
               set status = v_back,
                   rewatch_round = (e.before ->> 'rewatch_round')::integer,
                   rewatch_started_at = (e.before ->> 'rewatch_started_at')::timestamptz
             where id = e.target_id and user_id = e.user_id;
          elsif v_restore and v_back = 'upcoming' then
            -- 149's cache put a film with no watch left on Wishlist; it was Upcoming.
            update public.user_movie_entries set status = 'upcoming'
             where id = e.target_id and user_id = e.user_id and status = 'wishlist'
               and not exists (select 1 from public.media_watches w where w.movie_entry_id = e.target_id and w.user_id = e.user_id);
          end if;
        end if;
      elsif e.effect = 'episode_watched' then
        -- 216 · Only the episode watch the tick wrote, still at its date; a rewatch round it finished comes back.
        v_watch := null;
        select w.id into v_watch from public.media_watches w
         where w.id = (e.after ->> 'watch_id')::uuid and w.user_id = e.user_id and w.kind = 'episode'
           and w.season_number = (e.after ->> 'season')::integer and w.episode_number = (e.after ->> 'episode')::integer
           and w.tv_series_id = (select s.tv_series_id from public.user_tv_entries s where s.id = e.target_id and s.user_id = e.user_id)
           and w.watched_at is not distinct from (e.after ->> 'watched_at')::timestamptz
         for update;
        if v_watch is not null then
          -- The show exactly as the tick left it (status and dates, compared as times — never as text, which follows
          -- the session's time zone), or the owner's since.
          select (s.status is not distinct from (e.after ->> 'status')
                  and s.started_at is not distinct from (e.after ->> 'started_at')::timestamptz
                  and s.finished_at is not distinct from (e.after ->> 'finished_at')::timestamptz)
            into v_restore
            from public.user_tv_entries s where s.id = e.target_id and s.user_id = e.user_id
           for update;
          delete from public.media_watches where id = v_watch and user_id = e.user_id;
          if coalesce(v_restore, false)
             and (e.before ->> 'status' is distinct from e.after ->> 'status'
                  or (e.before ->> 'started_at')::timestamptz is distinct from (e.after ->> 'started_at')::timestamptz
                  or (e.before ->> 'finished_at')::timestamptz is distinct from (e.after ->> 'finished_at')::timestamptz) then
            -- Completed → Watching / Paused / Dropped through Paused, as the movie's: when the tick's watch was not the
            -- episode's only one every aired episode still has a watch, and 161's guard would read Completed → Watching
            -- as a new rewatch round.
            if e.after ->> 'status' = 'completed' and e.before ->> 'status' in ('watching', 'paused', 'dropped') then
              update public.user_tv_entries s set status = 'paused'
               where s.id = e.target_id and s.user_id = e.user_id and s.status <> 'paused';
            end if;
            update public.user_tv_entries s
               set status = e.before ->> 'status',
                   rewatch_round = (e.before ->> 'rewatch_round')::integer,
                   rewatch_started_at = (e.before ->> 'rewatch_started_at')::timestamptz,
                   started_at = case when e.before ? 'started_at' then (e.before ->> 'started_at')::timestamptz else s.started_at end,
                   finished_at = case when e.before ? 'finished_at' then (e.before ->> 'finished_at')::timestamptz else s.finished_at end
             where s.id = e.target_id and s.user_id = e.user_id;
          end if;
        end if;
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

-- ── C. A watch closes a show's plan with no slot of its episode (owner, 28.11.2026) ──
-- Asked "should a Trakt watch also complete whole-show items, and episode items with no date?", the owner: "Yes it
-- should complete that task as well." 155's rule closes an episode plan only through its slot; this closes, for a
-- watch from the Media page or a Trakt pull (never the tick's own — plan_tick_task()), the user's open plan of that
-- exact episode with no slot, and the open plan of the whole show, at the watch's time: the movie's day rule (211) —
-- on or after the plan's day, an undated plan counting from the day it was made, a watch from before the plan was made
-- closing nothing, and a Trakt watch with no date closing nothing (149's media_watch_plan_day). Closing is not a tick:
-- no watch and no ledger row is written — the plan's tick effect sees another trigger's write (pg_trigger_depth() > 1)
-- and stays out, so a reopen has nothing to undo. Every query is the watch's own user's.
create or replace function public.media_watch_closes_show_plans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
  v_day   date := public.media_watch_plan_day(new.watched_at);
  v_at    timestamptz := case when new.watched_at >= timestamptz '1971-01-01 00:00:00+00' then new.watched_at end;
begin
  if v_day is null or public.plan_tick_task() is not null then return null; end if;
  select e.id into v_entry from public.user_tv_entries e
   where e.user_id = new.user_id and e.tv_series_id = new.tv_series_id;
  if v_entry is null then return null; end if;
  update public.tasks t set status = 'done', completed_at = coalesce(v_at, now())
   where t.user_id = new.user_id and t.tv_entry_id = v_entry and t.status in ('open', 'in_progress', 'waiting')
     and ((t.link_season is null and t.link_episode is null)
          or (t.link_season = new.season_number and t.link_episode = new.episode_number
              and not exists (select 1 from public.time_blocks b where b.task_id = t.id and b.user_id = t.user_id)))
     and (v_at is null or v_at >= t.created_at)
     and case when public.task_plan_day(t.id) is null then (t.created_at at time zone 'Europe/Oslo')::date <= v_day
              else public.task_plan_day(t.id) <= v_day end;
  return null;
end
$$;
revoke all on function public.media_watch_closes_show_plans() from public, anon, authenticated;
drop trigger if exists trg_media_watch_closes_show_plans on public.media_watches;
create trigger trg_media_watch_closes_show_plans after insert on public.media_watches
  for each row when (new.kind = 'episode') execute function public.media_watch_closes_show_plans();
