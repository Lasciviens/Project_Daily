-- 208 · icloud_invite_test_actions — the invite test's daily cap (25.11.2026; docs/integrations/icloud-caldav.md →
-- The invite test).
--
-- The invite test (Settings → Subscriptions, the Invite test card) makes one event in the owner's Personal iCloud
-- calendar that invites 1–2 addresses, so iCloud emails them in the owner's name. Send, Rewrite and Remove guest can each
-- make iCloud send mail, so the icloud-calendar function counts them here, before anything goes to iCloud: at most 5 a day
-- (Oslo's day) per account, whatever the browser asks. Delete is not counted (it must always be able to clean up).
--
-- One row per counted action: who, which action, when. Nothing else — no address, no event, no URL.
--
-- Attacker notes:
--   · The browser and the assistant have no right on the table or the two functions (revoke below; the assistant has no
--     table catalogue and its read RPC runs with the browser's rights). A stolen session can't read the count, add rows or
--     delete them to reset the cap; it can only call the function, which reserves a row before every counted action.
--   · icloud_invite_test_reserve takes a per-account advisory lock for its transaction, so two calls at once can't both
--     pass the count. SECURITY INVOKER (only the service role may call it), search_path ''.
--
-- Not audited (no trg_audit): bookkeeping written only by the function, and Developer → Activity must never be able to undo
-- (delete) a counted action and reset the cap. Safe to re-run. No BEGIN/COMMIT: the deploy runs it as one transaction.

create table if not exists public.icloud_invite_test_actions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action     text not null check (action in ('send', 'rewrite', 'remove')),
  created_at timestamptz not null default now()
);
alter table public.icloud_invite_test_actions enable row level security;

create index if not exists icloud_invite_test_actions_user_created_idx on public.icloud_invite_test_actions (user_id, created_at);

-- Service role only, like a token table: no browser grant and no browser policy.
revoke all on public.icloud_invite_test_actions from anon, authenticated;
grant select, insert, update, delete on public.icloud_invite_test_actions to service_role;

-- Reserves one counted action for the account: its count today (1–5) when it went in, null when the day's 5 are used.
create or replace function public.icloud_invite_test_reserve(p_user uuid, p_action text) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_since timestamptz := date_trunc('day', now() at time zone 'Europe/Oslo') at time zone 'Europe/Oslo';
  v_used  integer;
begin
  if p_user is null or p_action is null or p_action not in ('send', 'rewrite', 'remove') then
    raise exception 'icloud_invite_test_reserve: an account and send, rewrite or remove' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('icloud_invite_test:' || p_user::text, 0));
  select count(*) into v_used from public.icloud_invite_test_actions where user_id = p_user and created_at >= v_since;
  if v_used >= 5 then
    return null;
  end if;
  insert into public.icloud_invite_test_actions (user_id, action) values (p_user, p_action);
  return v_used + 1;
end $$;
revoke all on function public.icloud_invite_test_reserve(uuid, text) from public, anon, authenticated;
grant execute on function public.icloud_invite_test_reserve(uuid, text) to service_role;

-- The account's counted actions today (Oslo's day), for the card.
create or replace function public.icloud_invite_test_used(p_user uuid) returns integer
language sql stable security invoker set search_path = '' as $$
  select count(*)::integer from public.icloud_invite_test_actions
   where user_id = p_user and created_at >= date_trunc('day', now() at time zone 'Europe/Oslo') at time zone 'Europe/Oslo'
$$;
revoke all on function public.icloud_invite_test_used(uuid) from public, anon, authenticated;
grant execute on function public.icloud_invite_test_used(uuid) to service_role;

comment on table public.icloud_invite_test_actions is
  'The invite test''s counted actions (send, rewrite, remove), written only by icloud-calendar through icloud_invite_test_reserve: at most 5 a day (Oslo) per account (208).';

select public.owner_lock_apply('public.icloud_invite_test_actions');
