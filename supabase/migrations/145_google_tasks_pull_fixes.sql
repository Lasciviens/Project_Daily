-- 145: Google Tasks pull fixes (owner, 13.10.2026: "I do not see my tasks. No sync.")
--
-- A. Google allows several task lists with the same name. Migration 076 made
--    google_task_lists' titles unique per user (case-insensitive) to stop the
--    app creating "Work" twice — but the mirror must take whatever Google has.
--    With two lists of one name on Google, every Import failed on that index
--    (duplicate key) and the background sync skipped the second list's tasks
--    without a word. The index goes; the app still refuses to CREATE a list
--    whose name exists (googleTaskListsApi.ts), which was the point of 076.
-- B. google_tasks_sync_state.last_full_sync_at: google-tasks-sync re-reads
--    every list in full once a day (and on "Sync now"), so a change it missed
--    in an incremental window (a list that couldn't be read, a task held back
--    by a pending outbox row) comes in within a day instead of never.
-- C. upsert_task_from_google (the pull's one write door), replacing 075's:
--    - keeps Google's read-only `links` (a task made from a Gmail message
--      links to that email) in tasks.google_links — new trailing parameter
--      p_google_links, so the old signature is dropped first (two overloads
--      made PostgREST calls ambiguous once already, see 075);
--    - a task Google reports deleted stays cancelled on every later pull
--      (the old CASE let a re-read tombstone of a completed task flip the
--      cancelled row to done), and a task Google brings back (deleted again
--      false) reopens instead of staying cancelled for ever;
--    - a pending outbox row also protects google_sync_enabled (a task opted
--      out — say it got a Calendar event — was switched back on by a pull
--      that ran before its Google copy was deleted);
--    - a task already done here keeps its own completed_at (Google stamps
--      `completed` when our push arrives — after midnight, the pull moved
--      the task to the next day's Done);
--    - a task Google sends without a title is imported with an empty title
--      instead of failing (tasks.title is NOT NULL);
--    - a call that resolves to no user fails loudly instead of trying to
--      insert a task without an owner.
-- D. set_task_parent_from_google leaves a task with a pending outbox row
--    alone (a local "Set parent…" not yet on Google was reverted by the
--    pull's second pass) and skips writes that change nothing.
--
-- Safe to re-run. Changes no rows.

-- A ───────────────────────────────────────────────────────────────────────────
drop index if exists public.google_task_lists_user_lower_title;

-- B ───────────────────────────────────────────────────────────────────────────
alter table public.google_tasks_sync_state
  add column if not exists last_full_sync_at timestamptz;

comment on column public.google_tasks_sync_state.last_full_sync_at is
  'When google-tasks-sync last read every list in full without an error; it reads in full again once this is a day old.';

-- C ───────────────────────────────────────────────────────────────────────────
drop function if exists public.upsert_task_from_google(
  text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid
);

create or replace function public.upsert_task_from_google(
  p_google_task_id       text,
  p_title                text,
  p_notes                text,
  p_due_date             date,
  p_status               text,
  p_google_updated_at    timestamptz,
  p_google_tasklist_id   uuid        default null,
  p_parent_task_id       uuid        default null,
  p_completed_at         timestamptz default null,
  p_google_etag          text        default null,
  p_google_position      text        default null,
  p_google_web_view_link text        default null,
  p_google_hidden        boolean     default false,
  p_google_deleted       boolean     default false,
  p_user_id              uuid        default null,
  p_google_links         jsonb       default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid    := public.effective_user_id(p_user_id);
  v_title       text    := coalesce(p_title, '');
  v_hidden      boolean := coalesce(p_google_hidden, false);
  v_deleted     boolean := coalesce(p_google_deleted, false);
  v_links       jsonb   := case when jsonb_typeof(p_google_links) = 'array' then p_google_links end;
  v_id          uuid;
  v_has_pending boolean;
begin
  if v_user_id is null then
    raise exception 'upsert_task_from_google: no user (the service role must pass p_user_id)';
  end if;

  -- A write applying Google's own data: the outbox triggers skip it.
  perform set_config('app.google_sync_write', 'true', true);

  select id into v_id from public.tasks
   where user_id = v_user_id and google_task_id = p_google_task_id;

  if v_id is not null then
    -- A local change not yet on Google wins over Google's older copy.
    select exists (select 1 from public.google_tasks_outbox where task_id = v_id)
      into v_has_pending;

    update public.tasks set
      title          = case when not v_has_pending then v_title else title end,
      description    = case when not v_has_pending then p_notes else description end,
      due_date       = case when not v_has_pending then p_due_date else due_date end,
      status         = case
                         when v_deleted then 'cancelled'
                         when v_has_pending then status
                         -- Google brought back a task it had deleted.
                         when google_deleted and status = 'cancelled' then
                           case when p_status = 'completed' then 'done' else 'open' end
                         when p_status = 'completed' then 'done'
                         when status = 'done' then 'open'
                         else status
                       end,
      -- A task already done here keeps its own close time: Google stamps
      -- `completed` when our push reaches it, which can be after midnight.
      completed_at   = case
                         when v_has_pending then completed_at
                         when status = 'done' and p_status = 'completed' and not v_deleted
                              and completed_at is not null then completed_at
                         else p_completed_at
                       end,
      parent_task_id = case when not v_has_pending then p_parent_task_id else parent_task_id end,
      google_tasklist_id   = coalesce(p_google_tasklist_id, google_tasklist_id),
      google_updated_at    = p_google_updated_at,
      google_etag          = coalesce(p_google_etag, google_etag),
      google_position      = coalesce(p_google_position, google_position),
      google_web_view_link = coalesce(p_google_web_view_link, google_web_view_link),
      google_links         = coalesce(v_links, google_links),
      google_hidden        = v_hidden,
      google_deleted       = v_deleted,
      google_sync_enabled  = case when v_has_pending then google_sync_enabled else true end
    where id = v_id;

    return v_id;
  end if;

  -- New to us. A deleted or hidden (cleared, or completed in Google's own
  -- apps) task we have never seen needs no local row.
  if v_deleted or v_hidden then
    return null;
  end if;

  insert into public.tasks (
    user_id, title, description, domain, section, priority, status,
    due_date, source_type, parent_task_id, google_task_id, google_tasklist_id,
    google_updated_at, google_etag, google_position, google_web_view_link, google_links,
    google_hidden, google_deleted, google_sync_enabled, completed_at, sort_order
  ) values (
    v_user_id, v_title, p_notes, 'personal', 'inbox', 'medium',
    case when p_status = 'completed' then 'done' else 'open' end,
    p_due_date, 'manual', p_parent_task_id, p_google_task_id, p_google_tasklist_id,
    p_google_updated_at, p_google_etag, p_google_position, p_google_web_view_link, v_links,
    false, false, true, p_completed_at, 0
  )
  on conflict (user_id, google_task_id) where google_task_id is not null do nothing
  returning id into v_id;

  -- Two runs at once (the cron, the app opening, Sync now) can both see the
  -- task as new: the first insert stands, the second returns its row.
  if v_id is null then
    select id into v_id from public.tasks
     where user_id = v_user_id and google_task_id = p_google_task_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.upsert_task_from_google(
  text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid, jsonb
) from public, anon, authenticated;
-- Only the sync function (service role) calls it: the browser's own pull was
-- removed, and a SECURITY DEFINER write open to every signed-in account would
-- step past the owner lock (139).
grant execute on function public.upsert_task_from_google(
  text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid, jsonb
) to service_role;

-- D ───────────────────────────────────────────────────────────────────────────
create or replace function public.set_task_parent_from_google(
  p_task_id uuid, p_parent_task_id uuid, p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.google_sync_write', 'true', true);
  update public.tasks t set parent_task_id = p_parent_task_id
   where t.id = p_task_id
     and t.user_id = public.effective_user_id(p_user_id)
     and t.parent_task_id is distinct from p_parent_task_id
     and not exists (select 1 from public.google_tasks_outbox o where o.task_id = t.id);
end;
$$;

revoke all on function public.set_task_parent_from_google(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_task_parent_from_google(uuid, uuid, uuid) to service_role;
