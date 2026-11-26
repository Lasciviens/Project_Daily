-- What migration 212 (notifications, Phase 3 B1–B3) meets, on top of scripts/db-tests/one-item/base.sql (auth with a
-- switchable caller, the owner lock, 037/140's audit trigger): pg_cron, Vault and pg_net as far as the timers use them
-- (net.http_post only writes down what it was asked to send), the Shop's items as far as a notice names one, and the
-- REAL 091/101 (psn_tokens) and 119 (media follows) run by verify-db-notifications.mjs after this file, and the sign-in
-- tables as far as 212's settle triggers read them.
create schema if not exists cron;
create table cron.job (jobid serial primary key, jobname text, schedule text, command text);
create or replace function cron.schedule(text, text, text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values ($1, $2, $3) returning jobid::bigint
$$;
create or replace function cron.unschedule(text) returns boolean language sql as $$
  delete from cron.job where jobname = $1 returning true
$$;
create schema if not exists vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
insert into vault.decrypted_secrets values ('PUSH_CRON_SECRET', 'test-cron-secret');
create schema if not exists net;
create table net.sent (n serial primary key, url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, headers jsonb default '{}'::jsonb, body jsonb default '{}'::jsonb) returns bigint
language sql as $$ insert into net.sent (url, headers, body) values (url, headers, body) returning n::bigint $$;

create table if not exists public.shop_items (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title   text not null
);
alter table public.shop_items enable row level security;
create policy own on public.shop_items for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.shop_items to authenticated, service_role;

-- The sign-in tables, as far as 212's settle triggers read them (service role only in the live database).
create table if not exists public.trakt_tokens (user_id uuid primary key references auth.users(id) on delete cascade, refresh_token text not null);
create table if not exists public.strava_tokens (user_id uuid primary key references auth.users(id) on delete cascade, refresh_token text not null);
create table if not exists public.user_calendar_tokens (user_id uuid primary key references auth.users(id) on delete cascade, refresh_token text not null);
create table if not exists public.icloud_credentials (user_id uuid primary key references auth.users(id) on delete cascade, app_password text not null);
