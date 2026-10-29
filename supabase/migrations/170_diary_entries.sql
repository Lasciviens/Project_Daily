-- ═══════════════════════════════════════════════════════════════════════════
-- 170 — The day's diary (owner, 29.10.2026: "a sub page where I can see what
-- where with whom and when I have eaten, watched, played, trained, planned,
-- done tasks … Like a diary. Also a diary text input where I speak about my
-- day").
--
-- One row per day: the owner's own words about it. What happened that day is
-- read from the app's own data (Personal → Diary), never copied here, so the
-- diary never disagrees with Food, Training, Media or the tasks.
--
-- Audit: trg_audit (the owner's own writing, undoable from Developer →
-- Activity). Re-runnable: IF NOT EXISTS, the pg_policies guard, DROP … IF
-- EXISTS before the triggers.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.diary_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day         date not null,
  body        text not null default '' check (char_length(body) <= 20000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint diary_entries_once unique (user_id, day)
);
alter table public.diary_entries enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'diary_entries'
                 and policyname = 'Users manage own diary entries') then
    create policy "Users manage own diary entries" on public.diary_entries for all
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
-- The unique constraint's index (user_id, day) serves every read.
grant select, insert, update, delete on public.diary_entries to authenticated;
grant select, insert, update, delete on public.diary_entries to service_role;

drop trigger if exists trg_diary_entries_updated_at on public.diary_entries;
create trigger trg_diary_entries_updated_at
  before update on public.diary_entries
  for each row execute function public.update_updated_at();

drop trigger if exists trg_audit on public.diary_entries;
create trigger trg_audit
  after insert or update or delete on public.diary_entries
  for each row execute function public.log_audit();

select public.owner_lock_apply('public.diary_entries');
