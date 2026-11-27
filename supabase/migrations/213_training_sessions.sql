-- 213 · Training sessions: a workout done a day or two early, or swapped with another session of the week, completes
-- its own session (Training redesign PR 2 of 3; the owner's go of 27.11.2026, "Yes" to the sessions proposal).
--
-- The owner (27.11.2026): "MISSED SESSIONS … this is not working as it should … Missed sessions, sessions I did but in
-- different days.. What I actually should do". 141/167/211 matched a workout only to a session of its routine planned
-- on the workout's day or up to six days BEFORE it: a workout done early never closed its session (it read "Today",
-- then "Not logged yet", then was skipped "Not done within 7 days" while the workout showed as unplanned), and a swap
-- (Lower A done on Upper A's day) left both sessions open. docs/training/science.md S20: a session done within ±2 days
-- of its planned day counts as that session ("moved"); S22/S23: the swapped-out session stays to do and becomes next.
--
-- A workout of a routine now completes, in this order (hevy_workout_completes_plan):
--   1. its routine's session on the workout's day (141, unchanged);
--   2. its routine's session on the workout's day that another workout holds — a stand-in with another routine or none
--      (141), or (new) one of its own routine done on another day: the workout of the session's own day wins, and the
--      freed workout looks again (training_workout_relink);
--   3. its routine's session within the window (training_plan_candidates, widened): planned up to 2 days AFTER the
--      workout (done early, S20) or up to 6 days before it, and never after the session's own week — its first day and
--      the next six (167, the owner's rule: the outer limit for a late workout; S20's ±2 is only the early side). The
--      nearest first; a session still to do before one ticked by hand or skipped; on a tie the older (it ends sooner);
--   4. (new) a swap: its routine's session still to do 3–6 days after the workout, when the workout's day had a
--      session of ANOTHER routine of the current program still to do (training_swap_plan) — the swapped-out session
--      stays open (the week view shows it "Did Lower A instead" and it becomes next);
--   5. 141's stand-in where a routine is missing (unchanged).
-- A workout still completes ONLY a session of its own routine (167: "A workout just represents itself") — a swap never
-- closes the other routine's session. One workout closes one session (the unique index on tasks.hevy_workout_id and the
-- "already linked" check), and every query is the workout's own user's.
--
-- 166's recheck (a session moved) keeps a workout that still fits by the same windows: up to 2 days before the
-- session's new day (or 3–6 days before it when that day was a swap day) and up to its week's last day; a session to
-- do is offered its routine's untaken workouts from 6 days before its day.
--
-- Security (AGENTS.md → the warning). What each input could do if an attacker wrote it, and why it can't:
--   · hevy_workouts — written by the Hevy syncs (service role); the browser can INSERT (Check workouts with Hevy's
--     Undo, 182) but only rows of its own account (RLS) and never UPDATE. A forged row of one's own account can close
--     only that account's own sessions — what a tick by hand already does. Every query here is scoped to the
--     workout's user_id; the trigger functions can't be called directly.
--   · tasks / time_blocks — the browser writes them: a session's day, its routine (owner-checked, 210's task_link_ok),
--     its first day. They move which of the SAME account's sessions a workout closes, never another account's.
--   · tasks.hevy_workout_id — the browser could write another account's workout id (a foreign key admits any account's
--     id): that would block that workout from ever closing its owner's session (the "already linked" check and the
--     unique index see it). New here: trg_tasks_workout_owner refuses a workout of another account for every writer
--     (23503, as 192/210's ownership checks: a restore retries once its parent is back).
--   · current_program_routines — the browser writes it (084): it only decides whether a day counts as a swap day for
--     that account's own workouts and sessions.
--   · No call leaves the database; no stored value becomes the target of a write made with outside credentials.
-- SECURITY DEFINER functions: search_path '', every query scoped to the row's own user, no grant to the browser.
--
-- No new table. Re-runnable: CREATE OR REPLACE, DROP TRIGGER IF EXISTS; the backfill links only workouts no session
-- holds, so a second run changes nothing. No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ── 1. The window: up to 2 days early, up to 6 days late, never after the session's own week ─────────────────────
create or replace function public.training_plan_candidates(p_user uuid, p_day date)
returns table (id uuid, routine text, status text, plan_day date, created_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select c.id, c.routine, c.status, c.plan_day, c.created_at
    from (
      select t.id, t.hevy_routine_id as routine, t.created_at, t.first_plan_date,
             case when t.status <> 'cancelled' then t.status
                  when t.closed_reason = 'missed' then 'missed'
                  else 'skipped' end as status,
             coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id and b.user_id = t.user_id), t.due_date) as plan_day
        from public.tasks t
       where t.user_id = p_user
         and t.hevy_workout_id is null
         and (t.hevy_routine_id is not null or t.source_type = 'training_session')
         and (t.status in ('open', 'in_progress', 'waiting', 'done')
              or (t.status = 'cancelled' and t.closed_reason = 'missed')
              or (t.status = 'cancelled' and t.hevy_routine_id is not null
                  and exists (select 1 from public.training_skips k where k.task_id = t.id and k.user_id = t.user_id)))
    ) c
   where c.plan_day between p_day - 6 and p_day + 2
     and p_day <= coalesce(c.first_plan_date, c.plan_day) + 6
     and (c.status <> 'done' or c.plan_day = p_day or c.routine is not null)
$$;
revoke all on function public.training_plan_candidates(uuid, date) from public, anon, authenticated;

-- ── 2. A swap day ─────────────────────────────────────────────────────────────────────────────────────────────
-- p_day had a session of ANOTHER routine of the account's current program (084: current_program_routines), and
-- p_routine is in that program too. p_open: only a session still to do counts (a workout syncing); false = any
-- session planned that day (166's recheck keeping a link the sync made).
create or replace function public.training_swap_day(p_user uuid, p_routine text, p_day date, p_open boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_user is not null and p_routine is not null and p_day is not null
     and exists (select 1 from public.current_program_routines r where r.user_id = p_user and r.routine_id = p_routine)
     and exists (
       select 1
         from public.tasks q
         join public.current_program_routines qr on qr.user_id = q.user_id and qr.routine_id = q.hevy_routine_id
        where q.user_id = p_user
          and q.hevy_routine_id is not null
          and q.hevy_routine_id <> p_routine
          and coalesce((select min(b.date) from public.time_blocks b where b.task_id = q.id and b.user_id = q.user_id), q.due_date) = p_day
          and (not p_open
               or (q.hevy_workout_id is null
                   and (q.status in ('open', 'in_progress', 'waiting') or (q.status = 'cancelled' and q.closed_reason = 'missed')))))
$$;
revoke all on function public.training_swap_day(uuid, text, date, boolean) from public, anon, authenticated;

-- The session a swap completes: p_routine's session still to do, planned 3–6 days after p_day (closer ones are
-- step 3's), inside its own week, when p_day is a swap day. The nearest first.
create or replace function public.training_swap_plan(p_user uuid, p_routine text, p_day date)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id
    from (
      select t.id, t.created_at, t.first_plan_date,
             coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id and b.user_id = t.user_id), t.due_date) as plan_day
        from public.tasks t
       where t.user_id = p_user
         and t.hevy_routine_id = p_routine
         and t.hevy_workout_id is null
         and t.status in ('open', 'in_progress', 'waiting')
    ) c
   where c.plan_day between p_day + 3 and p_day + 6
     and p_day <= coalesce(c.first_plan_date, c.plan_day) + 6
     and public.training_swap_day(p_user, p_routine, p_day, true)
   order by c.plan_day, c.created_at, c.id
   limit 1
$$;
revoke all on function public.training_swap_plan(uuid, text, date) from public, anon, authenticated;

-- ── 3. A workout synced: the session it completes ─────────────────────────────────────────────────────────────
create or replace function public.hevy_workout_completes_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  w_day  date;
  t_id   uuid;
  freed  text;
  n      int;
begin
  if new.start_time is null then return new; end if;
  -- Already linked (a re-sync of the same workout): nothing to do — one workout, one session.
  if exists (select 1 from public.tasks where hevy_workout_id = new.id) then return new; end if;
  w_day := (new.start_time at time zone 'Europe/Oslo')::date;

  -- 1. Its routine's session on the workout's day: one to do first, then one closed as missed, one skipped (done
  --    inside its week after all), one ticked by hand.
  if new.routine_id is not null then
    select c.id into t_id from public.training_plan_candidates(new.user_id, w_day) c
     where c.routine = new.routine_id and c.plan_day = w_day
     order by case c.status when 'done' then 3 when 'skipped' then 2 when 'missed' then 1 else 0 end, c.created_at
     limit 1;
  end if;

  -- 2. Its routine's session that day held by another workout: a stand-in of another routine or none (141), or one of
  --    its own routine done on another day (early or late) — the session's own day wins. The freed workout looks again.
  if t_id is null and new.routine_id is not null then
    select t.id, w.id into t_id, freed
      from public.tasks t join public.hevy_workouts w on w.id = t.hevy_workout_id and w.user_id = t.user_id
     where t.user_id = new.user_id
       and t.hevy_routine_id = new.routine_id
       and (w.routine_id is distinct from new.routine_id
            or (w.start_time at time zone 'Europe/Oslo')::date is distinct from w_day)
       and coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id and b.user_id = t.user_id), t.due_date) = w_day
     order by t.created_at
     limit 1;
    if t_id is not null then
      update public.tasks
         set hevy_workout_id = new.id,
             completed_at    = coalesce(new.end_time, new.start_time)
       where id = t_id and user_id = new.user_id;
      perform public.training_workout_relink(freed);
      return new;
    end if;
  end if;

  -- 3. Its routine's session within the window: up to 2 days later (done early) or earlier in that session's week
  --    (done late). The nearest first; one to do before one ticked by hand or skipped; on a tie the older.
  if t_id is null and new.routine_id is not null then
    select c.id into t_id from public.training_plan_candidates(new.user_id, w_day) c
     where c.routine = new.routine_id and c.plan_day <> w_day
     order by (c.status = 'done'), (c.status = 'skipped'), abs(c.plan_day - w_day), c.plan_day, c.created_at
     limit 1;
  end if;

  -- 4. A swap: done on a day another routine of the program was planned, its own session later that week.
  if t_id is null and new.routine_id is not null then
    t_id := public.training_swap_plan(new.user_id, new.routine_id, w_day);
  end if;

  -- 5. A stand-in only where a routine is missing: the one session to do that day, when the workout has no routine or
  --    that session has none.
  if t_id is null then
    select min(c.id::text)::uuid, count(*) into t_id, n
      from public.training_plan_candidates(new.user_id, w_day) c
     where c.plan_day = w_day and c.status in ('open', 'in_progress', 'waiting', 'done')
       and (new.routine_id is null or c.routine is null);
    if n <> 1 then t_id := null; end if;
  end if;

  if t_id is not null then
    update public.tasks
       set hevy_workout_id = new.id,
           completed_at    = case when status = 'done' then completed_at
                                  else coalesce(new.end_time, new.start_time) end,
           status          = 'done'
     where id = t_id and user_id = new.user_id and hevy_workout_id is null;
  end if;
  return new;
end;
$$;
revoke all on function public.hevy_workout_completes_plan() from public, anon, authenticated;

-- ── 4. 166's relink: a workout looks again where a session of its own routine may take it ─────────────────────
-- Only where its OWN routine has a session for it (steps 1–4 above); the stand-in (step 5) runs only when a workout
-- syncs. Writing hevy_workouts (read-only for the browser, 182) re-runs the trigger above.
create or replace function public.training_workout_relink(p_workout text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w     public.hevy_workouts%rowtype;
  v_day date;
begin
  if p_workout is null then return; end if;
  select * into w from public.hevy_workouts where id = p_workout;
  if not found or w.routine_id is null or w.start_time is null then return; end if;
  if exists (select 1 from public.tasks where hevy_workout_id = w.id) then return; end if;
  v_day := (w.start_time at time zone 'Europe/Oslo')::date;
  if exists (select 1 from public.training_plan_candidates(w.user_id, v_day) c where c.routine = w.routine_id)
     or exists (select 1 from public.tasks t join public.hevy_workouts o on o.id = t.hevy_workout_id and o.user_id = t.user_id
                 where t.user_id = w.user_id and t.hevy_routine_id = w.routine_id
                   and (o.routine_id is distinct from w.routine_id
                        or (o.start_time at time zone 'Europe/Oslo')::date is distinct from v_day)
                   and coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id and b.user_id = t.user_id), t.due_date) = v_day)
     or public.training_swap_plan(w.user_id, w.routine_id, v_day) is not null then
    update public.hevy_workouts set routine_id = routine_id where id = w.id and user_id = w.user_id;
  end if;
end;
$$;
revoke all on function public.training_workout_relink(text) from public, anon, authenticated;

-- ── 5. 169's recheck with the same windows ──────────────────────────────────────────────────────────────────
create or replace function public.training_task_recheck(p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t       public.tasks%rowtype;
  o       public.hevy_workouts%rowtype;
  v_day   date;
  v_last  date;
  v_wday  date;
  v_today date := (now() at time zone 'Europe/Oslo')::date;
  w       record;
begin
  select * into t from public.tasks where id = p_task;
  if not found or not (t.hevy_routine_id is not null or t.source_type = 'training_session') then return; end if;
  -- 141's planned day: its slot's date, else its due day.
  v_day := coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id and b.user_id = t.user_id), t.due_date);
  if v_day is null then return; end if;
  -- The last day a workout still completes it: six days on, inside its week (167).
  v_last := least(v_day + 6, coalesce(t.first_plan_date, v_day) + 6);

  -- 3. The workout no longer fits — not from 2 days before the day (3–6 before on a swap day) to the last day, or of
  --    another routine (167): the link goes. A session that workout closed is to do again; one ticked by hand stays
  --    done. The workout may be another session's of its own routine.
  if t.hevy_workout_id is not null then
    select * into o from public.hevy_workouts where id = t.hevy_workout_id and user_id = t.user_id;
    v_wday := (o.start_time at time zone 'Europe/Oslo')::date;
    if v_wday is null or v_wday > v_last or v_wday < v_day - 6
       or (v_wday < v_day - 2 and not (t.hevy_routine_id is not null and o.routine_id = t.hevy_routine_id
                                       and public.training_swap_day(t.user_id, t.hevy_routine_id, v_wday, false)))
       or (t.hevy_routine_id is not null and o.routine_id is not null and o.routine_id <> t.hevy_routine_id) then
      update public.tasks
         set hevy_workout_id = null,
             status = case when status = 'done' and completed_at is not distinct from coalesce(o.end_time, o.start_time)
                           then 'open' else status end
       where id = t.id and user_id = t.user_id;
      perform public.training_workout_relink(o.id);
      select * into t from public.tasks where id = p_task;
    end if;
  end if;

  -- 4. To do: the workouts of its own routine no session took, from 6 days before its day to its last day (up to
  --    today), oldest first — each looks again, and the trigger decides which session it completes.
  if t.hevy_workout_id is null and t.hevy_routine_id is not null and t.status in ('open', 'in_progress', 'waiting') and v_day - 6 <= v_today then
    for w in
      select hw.id from public.hevy_workouts hw
       where hw.user_id = t.user_id
         and hw.routine_id = t.hevy_routine_id
         and hw.start_time is not null
         and (hw.start_time at time zone 'Europe/Oslo')::date between v_day - 6 and least(v_last, v_today)
         and not exists (select 1 from public.tasks x where x.hevy_workout_id = hw.id)
       order by hw.start_time, hw.id
    loop
      perform public.training_workout_relink(w.id);
    end loop;
  end if;
end;
$$;
revoke all on function public.training_task_recheck(uuid) from public, anon, authenticated;
comment on function public.training_task_recheck(uuid) is
  '166/167/169/213: a training task''s Hevy workout link checked against its day — a workout that no longer fits (from 2 days before the day, 3–6 on a swap day, to 6 days after, inside the session''s week) or of another routine is unlinked (a session it closed is to do again; a hand tick stays); a session to do is offered the workouts of its own routine no session took.';

-- ── 6. A session's workout is its own account's ───────────────────────────────────────────────────────────────
create or replace function public.tasks_workout_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hevy_workout_id is not null
     and (tg_op = 'INSERT' or new.hevy_workout_id is distinct from old.hevy_workout_id or new.user_id is distinct from old.user_id)
     and not exists (select 1 from public.hevy_workouts w where w.id = new.hevy_workout_id and w.user_id = new.user_id) then
    raise exception 'A session can only be linked to a workout of its own account' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.tasks_workout_owner() from public, anon, authenticated;
-- After 141's trg_tasks_link_training (BEFORE triggers run in name order), which may clear the link on a reopen.
drop trigger if exists trg_tasks_workout_owner on public.tasks;
create trigger trg_tasks_workout_owner
  before insert or update of hevy_workout_id, user_id on public.tasks
  for each row execute function public.tasks_workout_owner();

-- ── 7. The workouts of the last two weeks that no session holds look again (the new windows) ──────────────────
-- Oldest first; one that finds nothing stays as it is, so a second run changes nothing. The count goes to the deploy
-- log (no personal data).
do $$
declare
  r       record;
  n_after int;
  n_before int;
begin
  select count(*) into n_before from public.tasks where hevy_workout_id is not null;
  for r in
    select w.id from public.hevy_workouts w
     where w.routine_id is not null and w.start_time >= now() - interval '14 days'
       and not exists (select 1 from public.tasks t where t.hevy_workout_id = w.id)
     order by w.start_time, w.id
  loop
    perform public.training_workout_relink(r.id);
  end loop;
  select count(*) into n_after from public.tasks where hevy_workout_id is not null;
  raise notice '213 training sessions newly completed by a workout of the last 14 days: %', n_after - n_before;
end $$;
