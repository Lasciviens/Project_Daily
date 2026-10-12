-- 143: a closed task leaves Work's focus, whoever closed it.
--
-- Work's Focus strip listed every task with is_focused = true. Only Work's own
-- Done button cleared the flag, so a task ticked off on Daily or Home, by a
-- Google Tasks pull or by the assistant stayed in the strip as a finished task
-- (owner, 12.10.2026: "the Focus strip keeps finished tasks"). Now the
-- database clears the flag whenever a task is done or cancelled, for every
-- writer, and the tasks closed before this are cleared once.
--
-- Reopening a task does not bring its focus back: focus is a choice made
-- about work still to do.

create or replace function public.tasks_closed_clears_focus()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('done', 'cancelled') and new.is_focused then
    new.is_focused := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_closed_clears_focus on public.tasks;
create trigger trg_tasks_closed_clears_focus
  before insert or update of status, is_focused on public.tasks
  for each row execute function public.tasks_closed_clears_focus();

update public.tasks
set is_focused = false
where is_focused and status in ('done', 'cancelled');
