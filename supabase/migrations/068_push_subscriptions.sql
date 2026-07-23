-- Web Push — the phone's return channel. A PushSubscription (one per installed
-- PWA / browser) is stored here; the push-send edge function signs a VAPID push
-- to each and the OS shows it on the lock screen even while the app is closed.
--
-- Owner-only RLS (the client inserts its own subscription under its JWT). No
-- audit trigger (churny, low value). Endpoint is unique per user so re-subscribe
-- upserts instead of duplicating.
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'Users manage own push subscriptions'
  ) then
    create policy "Users manage own push subscriptions"
      on public.push_subscriptions for all
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end $$;

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ── Permanent morning-brief cron ──────────────────────────────────────────
-- Fires the push-send edge function daily. pg_cron runs in UTC: 05:00 UTC ≈
-- 07:00 Oslo in summer (06:00 in winter — the DST hour is accepted for a
-- morning nudge). The x-cron-secret is read from Vault at call time (never
-- stored in this file); add PUSH_CRON_SECRET to Vault before/after — a missing
-- secret just makes push-send reject the call (no push, no harm).
--
-- If this block errors, enable the extensions first:
--   Dashboard → Database → Extensions → enable `pg_cron` and `pg_net`.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'lascis-morning-push') then
    perform cron.unschedule('lascis-morning-push');
  end if;
end $$;

select cron.schedule('lascis-morning-push', '0 5 * * *', $cron$
  select net.http_post(
    url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'PUSH_CRON_SECRET'), '')
    ),
    body := jsonb_build_object('trigger', 'morning')
  );
$cron$);
