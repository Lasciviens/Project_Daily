-- ═══════════════════════════════════════════════════════════════════════════
-- 171 — iCloud Calendar credentials (owner, 29.10.2026: Phase 1, the "Apple
-- check" — can the app write straight into Apple Calendar through iCloud?).
--
-- One row per account: the Apple ID email and its app-specific password, the
-- discovered principal and calendar home, and the Apple check's test calendar
-- with its sync token. A token table (docs/integrations/icloud-caldav.md):
-- written and read only by the `icloud-calendar` edge function with the
-- service role — no browser policy, REVOKE ALL from anon and authenticated,
-- never in ai-proxy's DB_CATALOG. The browser sees only the function's derived
-- status. No trg_audit: a credential never goes into audit_logs.
-- Re-runnable: IF NOT EXISTS, DROP … IF EXISTS before the trigger.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.icloud_credentials (
  user_id            uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  apple_id           text not null,
  app_password       text not null,
  principal_url      text,
  calendar_home_url  text,
  test_calendar_url  text,
  test_sync_token    text,
  last_error         text,
  connected_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.icloud_credentials enable row level security;
revoke all on public.icloud_credentials from anon, authenticated;
grant select, insert, update, delete on public.icloud_credentials to service_role;

drop trigger if exists trg_icloud_credentials_updated_at on public.icloud_credentials;
create trigger trg_icloud_credentials_updated_at
  before update on public.icloud_credentials
  for each row execute function public.update_updated_at();

select public.owner_lock_apply('public.icloud_credentials');
