-- ═══════════════════════════════════════════════════════════════════════════
-- 164 — A sleep night the owner confirmed is complete (owner, 16.10.2026:
-- "The night of 17.10.2026 – 18.10.2026 may be incomplete … this is nice
-- feature. But what if the data is correct? How do I avoid this message for
-- this specific date? … NOT TEMP Solution!!").
--
-- Health → Sleep flags a night whose start looks cut off by a late Health
-- Auto Export delivery (src/features/health/sleepCompleteness.ts). When the
-- data is right after all — a really late night — the owner says so once:
-- one row per night (its wake day, the day the night is filed under), and the
-- note never comes back for it on any device. A confirmed night is a complete
-- night: it also counts in the "usual start" the next nights are judged by.
-- Deleting the row (Undo) brings the note back.
--
-- Audit: trg_audit (the owner's own choice, undoable from Developer →
-- Activity). Re-runnable: IF NOT EXISTS, the pg_policies guard, DROP … IF
-- EXISTS before the trigger.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sleep_night_confirmations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- The wake day the night is filed under (sleepNightKey: sleepEnd's date).
  night_date  date not null,
  created_at  timestamptz not null default now(),
  constraint sleep_night_confirmations_once unique (user_id, night_date)
);
alter table public.sleep_night_confirmations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sleep_night_confirmations'
                 and policyname = 'Users manage own sleep night confirmations') then
    create policy "Users manage own sleep night confirmations" on public.sleep_night_confirmations for all
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
-- The unique constraint's index (user_id, night_date) serves every read.
grant select, insert, delete on public.sleep_night_confirmations to authenticated;

drop trigger if exists trg_audit on public.sleep_night_confirmations;
create trigger trg_audit
  after insert or update or delete on public.sleep_night_confirmations
  for each row execute function public.log_audit();

select public.owner_lock_apply('public.sleep_night_confirmations');
