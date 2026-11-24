-- 207 · trakt_queue_lists — the Queue can never be deleted (owner, 24.11.2026: "This list is to be used by watching list.
-- Since we want it on Trakt as well this is a list. Treat this special. No deleting! Not from trakt not from db not from app.
-- If someday I want to change, it should be on code."; docs/features/media.md → The Queue).
--
-- The Queue is a private Trakt list; the app keeps no copy of its items (Trakt holds them). What the database keeps is the
-- stable server-side mark of WHICH list is the Queue: its Trakt list id, one row per id. `trakt-api` writes the row (when it
-- creates the Queue, or the first time it meets a list named "Queue" with no mark) and refuses `list_delete` for any marked
-- id; the app hides Delete for it and its api refuses too. A name can be changed by anyone on Trakt; the id cannot, so a
-- rename never makes the Queue deletable, and a rule (✦ list) linked to it changes nothing either (the check is by id).
--
-- This table refuses (trigger below), whoever asks — the browser, the assistant, the function's service role, the SQL editor:
--   · DELETE of a row, and UPDATE of any column (re-pointing a mark would free the list it named);
--   · TRUNCATE.
-- The one delete it lets through is the account's own deletion: auth.users ON DELETE CASCADE removes the rows after the
-- account row is gone, so the guard finds no account and lets the cascade finish (deleting an account keeps working).
-- To change the rule, write a migration — that is the "on code" the owner asked for.
--
-- Attacker notes:
--   · The browser and the assistant have no right on the table (revoke below; the assistant has no table catalogue and its
--     read RPC runs with the browser's rights). A forged row is impossible from there; the function writes only an id it
--     read from Trakt's own list of the account's lists.
--   · A row names a Trakt list id (a positive integer), never a URL or a path: trakt-api builds every address itself.
--   · Rows of an old Trakt account (after a reconnect to another one) stay: Trakt list ids are global, so they never name a
--     list of the new account and protect nothing there.
--
-- Not audited (no trg_audit): bookkeeping written only by the function, and Developer → Activity must never be able to undo
-- (delete) a mark. Primary key (user_id, trakt_list_id). Safe to re-run. No BEGIN/COMMIT: the deploy runs it as one transaction.

create table if not exists public.trakt_queue_lists (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trakt_list_id bigint not null check (trakt_list_id > 0),
  created_at    timestamptz not null default now(),
  primary key (user_id, trakt_list_id)
);
alter table public.trakt_queue_lists enable row level security;

-- Service role only, like a token table: no browser grant and no browser policy.
revoke all on public.trakt_queue_lists from anon, authenticated;
grant select, insert, update, delete on public.trakt_queue_lists to service_role;

create or replace function public.trakt_queue_lists_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'The Queue''s mark is never removed (migration 207)' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'The Queue''s mark never changes (migration 207)' using errcode = '42501';
  end if;
  -- DELETE: only the account's own deletion, which reaches here after its auth.users row is gone (the cascade runs as the
  -- table's owner, who can read auth.users). Any other caller finds the account, or cannot read auth.users: refused either way.
  if exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception 'The Queue can''t be deleted (migration 207)' using errcode = '42501';
  end if;
  return old;
end $$;
revoke all on function public.trakt_queue_lists_guard() from public, anon, authenticated;

drop trigger if exists trg_trakt_queue_lists_guard on public.trakt_queue_lists;
create trigger trg_trakt_queue_lists_guard before update or delete on public.trakt_queue_lists
  for each row execute function public.trakt_queue_lists_guard();
drop trigger if exists trg_trakt_queue_lists_no_truncate on public.trakt_queue_lists;
create trigger trg_trakt_queue_lists_no_truncate before truncate on public.trakt_queue_lists
  for each statement execute function public.trakt_queue_lists_guard();

comment on table public.trakt_queue_lists is
  'Which Trakt list is the Queue: its Trakt list id (written only by trakt-api). trakt-api never deletes a marked list; this table refuses delete, update and truncate (207) — only deleting the account removes rows.';

select public.owner_lock_apply('public.trakt_queue_lists');
