-- "Undo this save" with every watch on its own row (migration 149): run by
-- scripts/verify-db-undo-save.mjs on a second database built from
-- scripts/db-tests/media-watches/base.sql and the real migrations 144, 149,
-- 150 and 151. 149's reconcile trigger is deferred: 151 fires it inside the
-- trial run, so what it changes (watches, Trakt plays) is in the preview.
-- Setup and Trakt-pull writes run as the superuser; saves, previews and
-- undos as `authenticated`, under row level security.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_tx (k text primary key, tx bigint, plan jsonb);
grant all on public.t_tx to authenticated;
create or replace function public.t_tx(p_k text) returns bigint language sql stable as $$ select tx from public.t_tx where k = p_k $$;
grant execute on function public.t_tx(text) to authenticated;
-- The Trakt queue is service-role only: counted for the scenarios here.
create or replace function public.t_count(p_op text) returns int language sql security definer as $$
  select count(*)::int from public.trakt_outbox where op = p_op
$$;
grant execute on function public.t_count(text) to authenticated;
create or replace function public.t_clear() returns void language sql security definer as $$ delete from public.trakt_outbox $$;
grant execute on function public.t_clear() to authenticated;
create or replace function public.t_watch_dates(p_episode int) returns text language sql security definer as $$
  select string_agg(to_char(w.watched_at at time zone 'UTC', 'YYYY-MM-DD'), ',' order by w.watched_at)
  from public.media_watches w
  where w.tv_series_id = '20000000-0000-0000-0000-000000000017' and w.episode_number = p_episode
$$;
grant execute on function public.t_watch_dates(int) to authenticated;

reset role;
insert into public.tv_series (id, tmdb_id, title) values ('20000000-0000-0000-0000-000000000017', 1700, 'Redate show');
insert into public.user_tv_entries (id, user_id, tv_series_id, status) values
  ('21000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000017', 'completed');
-- Its plays, as the Trakt pull wrote them: E1 twice, E2 once.
begin;
select set_config('app.trakt_sync', 'on', true);
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at, trakt_history_id, source) values
  ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000017', 1, 1, '2018-01-01 20:00+00', 7001, 'trakt'),
  ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000017', 1, 1, '2024-01-01 20:00+00', 7002, 'trakt'),
  ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000017', 1, 2, '2019-01-01 20:00+00', 7003, 'trakt');
commit;
select public.t_clear();

-- ── 1. A save from before 149 re-dated the episodes; 149's backfill put
--       their latest watch at that date. Undoing the save moves the episode
--       dates back, and 149's deferred reconcile moves the watches and their
--       Trakt plays with them: the preview must show that. ──────────────────
set role authenticated;
do $$ begin
  -- before 149 nothing turned a date written on the episode into watches
  perform set_config('app.media_watch_cache', 'on', true);
  update public.user_tv_episodes set watched_at = '2026-10-14 12:00+00'
   where tv_series_id = '20000000-0000-0000-0000-000000000017';
  insert into public.t_tx values ('old_redate', txid_current());
end $$;
reset role;
begin;
select set_config('app.trakt_sync', 'on', true);
update public.media_watches w set watched_at = '2026-10-14 12:00+00', trakt_history_id = null, source = 'backfill'
 where w.id in (select distinct on (episode_id) id from public.media_watches
                 where tv_series_id = '20000000-0000-0000-0000-000000000017' order by episode_id, watched_at desc);
commit;
select public.t_clear();
set role authenticated;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('old_redate'));
  perform public.t_ok((p -> 'tables' -> 0 ->> 'revert')::int = 2 and p -> 'drift' = '[]',
                      'the two episodes get their old dates back, exactly ' || (p ->> 'drift'));
  perform public.t_ok(jsonb_array_length(p -> 'side_effects') = 2
                      and (select bool_and(e ->> 't' = 'media_watches' and e ->> 'op' = 'UPDATE' and e -> 'columns' = '["watched_at"]')
                           from jsonb_array_elements(p -> 'side_effects') e),
                      'the deferred reconcile moves each episode''s latest watch, inside the trial run: shown (its Trakt id is bookkeeping) ' || (p ->> 'side_effects'));
  perform public.t_ok(p -> 'outbox' = '[{"n": 2, "s": "trakt", "op": "history_add", "items": null}, {"n": 2, "s": "trakt", "op": "history_remove_play", "items": null}]',
                      'and Trakt gets two single plays removed and two added at the old dates ' || (p ->> 'outbox'));
  perform public.t_ok((p ->> 'needs_confirm')::boolean and public.t_count('history_add') = 0
                      and public.t_watch_dates(1) = '2018-01-01,2026-10-14', 'it needs confirming; the preview changed and queued nothing');
  p := public.app_undo_transaction(public.t_tx('old_redate'), true, p ->> 'confirm');
  perform public.t_ok((p ->> 'applied')::boolean, 'confirmed, the undo runs with the same fingerprint');
end $$;
do $$
begin
  perform public.t_ok(public.t_watch_dates(1) = '2018-01-01,2024-01-01' and public.t_watch_dates(2) = '2019-01-01',
                      'every watch is back on its old date');
  perform public.t_ok((select bool_and(case episode_number when 1 then date_trunc('second', watched_at) = '2024-01-01 20:00+00' and repeat_count = 1
                                                          else date_trunc('second', watched_at) = '2019-01-01 20:00+00' and repeat_count = 0 end)
                       from public.user_tv_episodes where tv_series_id = '20000000-0000-0000-0000-000000000017'),
                      'and the episodes'' cache columns are right (latest watch, plays − 1)');
  perform public.t_ok(public.t_count('history_remove_play') = 2 and public.t_count('history_add') = 2 and public.t_count('history_remove') = 0,
                      'Trakt got what the preview said: single plays, never a whole episode');
end $$;
select public.t_clear();

-- ── 2. A watch re-dated in the app (149), undone: its Trakt link is
--       bookkeeping, so the undo is "exactly as before" ───────────────────
do $$ begin
  update public.media_watches set watched_at = '2026-10-15 12:00+00'
   where tv_series_id = '20000000-0000-0000-0000-000000000017' and episode_number = 1 and watched_at = '2018-01-01 20:00+00';
  insert into public.t_tx values ('redate', txid_current());
end $$;
select public.t_clear();
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('redate'));
  perform public.t_ok(p -> 'drift' = '[]' and p -> 'side_effects' = '[]',
                      'its lost Trakt id and source are bookkeeping: no "not exactly as before" ' || (p ->> 'drift') || (p ->> 'side_effects'));
  perform public.t_ok(not exists (select 1 from jsonb_array_elements(p -> 'tables') t where t -> 'columns' ?| array['trakt_history_id', 'source']),
                      'and they are never put back');
  perform public.t_ok(p -> 'outbox' = '[{"n": 1, "s": "trakt", "op": "history_add", "items": null}, {"n": 1, "s": "trakt", "op": "history_remove_play", "items": null}]',
                      'Trakt: that one play moved back ' || (p ->> 'outbox'));
  p := public.app_undo_transaction(public.t_tx('redate'), true, p ->> 'confirm');
  perform public.t_ok(public.t_watch_dates(1) = '2018-01-01,2024-01-01', 'the watch is back on its date');
end $$;
select public.t_clear();

-- ── 3. Undoing a first watch removes the whole episode on Trakt: named ────
do $$ begin
  insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at)
  values ('episode', '20000000-0000-0000-0000-000000000017', 1, 3, '2026-10-01 20:00+00');
  insert into public.t_tx values ('first_watch', txid_current());
end $$;
select public.t_clear();
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('first_watch'));
  perform public.t_ok(p -> 'outbox' = '[{"n": 1, "s": "trakt", "op": "history_remove", "items": ["Redate show S01E03"]}]',
                      'undoing the episode''s first watch removes every play of it on Trakt: the item is named ' || (p ->> 'outbox'));
  perform public.t_ok((p ->> 'needs_confirm')::boolean, 'and it needs confirming');
end $$;

-- ── 4. A trial run's SET CONSTRAINTS ALL IMMEDIATE ends with it ───────────
do $$
declare v_before int := (select count(*) from public.media_watches where tv_series_id = '20000000-0000-0000-0000-000000000017' and episode_number = 2);
begin
  perform public.app_undo_transaction(public.t_tx('first_watch'));
  -- the old writer's way: one more play written on the episode, turned into a watch at commit
  update public.user_tv_episodes set repeat_count = repeat_count + 1
   where tv_series_id = '20000000-0000-0000-0000-000000000017' and episode_number = 2;
  perform public.t_ok((select count(*) from public.media_watches where tv_series_id = '20000000-0000-0000-0000-000000000017' and episode_number = 2) = v_before,
                      'after a preview, 149''s reconcile is still deferred to the end of the transaction');
end $$;
do $$
begin
  perform public.t_ok((select count(*) from public.media_watches where tv_series_id = '20000000-0000-0000-0000-000000000017' and episode_number = 2) = 2,
                      'and it ran at commit');
end $$;
reset role;
