-- 184 · The Trakt sync's own writes are known by who writes them, not by a header any caller can send (the guardian
-- review of PR #595, 02.11.2026; owner go 02.11.2026: "ok do the side task as well").
--
-- 117's trakt_sync_writing() let a write skip the Trakt outbox ("send to Trakt") when the request carried
-- `x-trakt-sync: 1`, so the sync never queues what it just brought in from Trakt. But PostgREST hands EVERY request's
-- headers to the database (request.headers), so a browser session could send that header too and keep its own
-- changes from ever reaching Trakt. The only sender is trakt-api, and it writes with the service role, so the header
-- now counts only on a service-role request: the request's JWT says role service_role, or PostgREST switched to that
-- role (either one; a browser's request is `authenticated` in both, and neither can be forged from a browser). The
-- transaction flag app.trakt_sync — set only by the database's own functions — is unchanged.
--
-- Same name, arguments and result as 117's; no trigger changes (they all call it). Re-runnable (CREATE OR REPLACE).
-- No BEGIN/COMMIT: the deploy runs it as one transaction.

create or replace function public.trakt_sync_writing() returns boolean
language sql
stable
set search_path = ''
as $$
  select (coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-trakt-sync', '') = '1'
          and (coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
               or coalesce(current_setting('role', true), '') = 'service_role'))
      or coalesce(current_setting('app.trakt_sync', true), '') = 'on'
$$;

comment on function public.trakt_sync_writing() is
  'True for a write the Trakt sync made itself (not queued back to Trakt): x-trakt-sync: 1 on a service-role request '
  '(184 — a browser can''t claim it), or a transaction that set app.trakt_sync = ''on''.';
