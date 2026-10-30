-- ═══════════════════════════════════════════════════════════════════════════
-- 172 — Calendar settings and the app's iCloud calendars (owner, 29.10.2026:
-- Phase 2a of docs/features/calendar-plan.md — "Add those to the settings as
-- well, and other settings that you are coding but I couldn't change without
-- asking you").
--
-- calendar_prefs: one row per account, the owner's calendar settings as a
-- JSON document (prefs.areas.<area> = name, emoji, colour, default alert,
-- on/off; read and checked by src/features/calendar/areas/calendarAreas.ts).
-- The browser reads and writes it (owner policy); audited, so Developer →
-- Activity can undo a change (one row per account, keyed by user_id).
--
-- icloud_credentials.area_calendars: where each area's calendar lives in
-- iCloud ({ "<area>": { "url": … } }), written only by the icloud-calendar
-- function with the service role — the table stays service-only (171).
-- icloud_credentials.password_sealed: derived, so the card can say the stored
-- password is encrypted without anyone reading it.
-- Re-runnable: IF NOT EXISTS, the pg_policies guard, DROP … IF EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.calendar_prefs (
  user_id    uuid primary key not null default auth.uid() references auth.users(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.calendar_prefs enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_prefs'
      and policyname = 'Users manage own calendar prefs'
  ) then
    create policy "Users manage own calendar prefs" on public.calendar_prefs
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
-- Nobody signed out uses the app (the owner lock): anon gets nothing, also where the
-- project still hands new tables to the API roles by default.
revoke all on public.calendar_prefs from anon;
grant select, insert, update, delete on public.calendar_prefs to authenticated;
grant select, insert, update, delete on public.calendar_prefs to service_role;

drop trigger if exists trg_audit on public.calendar_prefs;
create trigger trg_audit after insert or update or delete on public.calendar_prefs
  for each row execute function public.log_audit();
drop trigger if exists trg_calendar_prefs_updated_at on public.calendar_prefs;
create trigger trg_calendar_prefs_updated_at before update on public.calendar_prefs
  for each row execute function public.update_updated_at();

comment on table public.calendar_prefs is
  'Calendar settings that sync across devices (docs/features/calendar-plan.md). prefs.areas.<training|work|personal|media|football> = { name, emoji, color, alertMinutes, enabled }. One row per user.';

alter table public.icloud_credentials add column if not exists area_calendars jsonb not null default '{}'::jsonb;
-- Whether the stored app-specific password is sealed (AES-GCM, ICLOUD_ENC_KEY):
-- the status shows it without the function reading the password itself.
alter table public.icloud_credentials add column if not exists password_sealed boolean
  generated always as (left(app_password, 7) = 'enc:v1:') stored;

select public.owner_lock_apply('public.calendar_prefs');
