-- 148: two Google follow-ups (owner, 14.10.2026).
--
-- A. A task that comes from Google Tasks WITHOUT a date is today's work.
--    Before, every import was filed in the Inbox, and Today keeps undated
--    rows of the Today section only (taskRules.onDay), so an undated Google
--    task showed only under Tasks → No date. upsert_task_from_google (145's,
--    otherwise unchanged) now files it under Today:
--    - a new task: section 'today' when Google sends no date, 'inbox' (as
--      before) when it has one — a dated task is on its day by its date;
--    - Google takes the date away from a task still in the Inbox (nobody
--      filed it) → Today; Google gives a date to an undated task in Today →
--      the Inbox (where dated imports go), so a task Google dated for next
--      week leaves today's server-side lists, which read `section = 'today'`;
--    - a task the owner filed elsewhere (Backlog) keeps its section, and a
--      pending outbox row (a local edit not yet on Google) leaves the section
--      alone, like the date.
--    Why the import and not the day read: `google_task_id` is set on every
--    task the app PUSHES to Google too (useCreateTask turns Google sync on
--    whenever Google is connected), so "undated with a google_task_id" would
--    have pulled every undated Backlog task onto Today. Only the import knows
--    a task came from Google. Filing it under Today keeps one meaning of
--    Today — the section — which the app (fetchTasksForDay / onDay) and the
--    server-side lists (phone-gateway ×2, push-send, ai-proxy: section.eq.today)
--    already read, so no read query changes (NEVER_HIDES).
--    Tasks imported before 148 stay in the Inbox: the one-off SQL that moves
--    them is in docs/deploy-checklist.md (the owner runs it).
--
-- B. schedule_blocks.google_calendar_from — the day a repeating plan was added
--    to Google Calendar. Its Google series starts on the plan's first real day
--    on or after this (and effective_from), so Google doesn't show the plan's
--    past weeks; the app's own projection still starts at effective_from.
--    Written with the link (setScheduleBlockCalendarLink), cleared with it;
--    a series linked before 148 (NULL) gets the day of its next push
--    (src/features/calendar/calendarSeries.ts).
--
-- Safe to re-run. Changes no rows.

-- A ───────────────────────────────────────────────────────────────────────────
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
      -- (148) An undated Google task is today's work: the date taken away
      -- from an unfiled (Inbox) task → Today; a date given to an undated
      -- Today task → the Inbox, where dated imports go. Any other section is
      -- the owner's choice and stays.
      section        = case
                         when v_has_pending then section
                         when p_due_date is null and due_date is not null and section = 'inbox' then 'today'
                         when p_due_date is not null and due_date is null and section = 'today' then 'inbox'
                         else section
                       end,
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
    -- (148) Undated → Today (it is today's work); dated → the Inbox, on its day by its date.
    v_user_id, v_title, p_notes, 'personal', case when p_due_date is null then 'today' else 'inbox' end, 'medium',
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

-- The grants 145 set, restated (CREATE OR REPLACE keeps them; a re-run must too).
revoke all on function public.upsert_task_from_google(
  text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.upsert_task_from_google(
  text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid, jsonb
) to service_role;

-- B ───────────────────────────────────────────────────────────────────────────
alter table public.schedule_blocks
  add column if not exists google_calendar_from date;

comment on column public.schedule_blocks.google_calendar_from is
  'The day the plan was added to Google Calendar (148): its series starts on the plan''s first real day on or after this and effective_from, so Google shows no past weeks. NULL while not linked (or linked before 148: set at its next push).';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'schedule_blocks' and column_name = 'google_calendar_from'
  ) then
    raise exception 'Migration 148 assertion failed: schedule_blocks.google_calendar_from is missing';
  end if;
  if (select count(*) from pg_proc where proname = 'upsert_task_from_google' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'Migration 148 assertion failed: expected exactly one upsert_task_from_google';
  end if;
end $$;
