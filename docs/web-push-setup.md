# Web Push setup — morning brief on the lock screen

**What you get:** every morning a short notification lands on your phone's lock
screen — today's open tasks and the next training session (plus a wish period
that starts today, and any film/show release reminders that are due), **sent by
the server while the app is closed**. Tapping it opens Home. iOS delivery is
best-effort (it may be a few minutes late). The iOS rules behind this are in
[`iphone-web-integration.md`](iphone-web-integration.md).

Architecture: `push_subscriptions` table + `push-send` edge function (VAPID) +
the pg_cron job `lascis-morning-push` that calls it daily. The service worker
(`public/push-sw.js`) shows the notification.

---

## Your one-time steps

1. **Generate VAPID keys** (any machine with Node):
   ```
   npx web-push generate-vapid-keys
   ```
   Copy the **Public Key** and **Private Key**.

2. **Supabase → Edge Functions → Secrets** — `push-send` reads these from its
   environment. Add four:
   | name | value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | the public key |
   | `VAPID_PRIVATE_KEY` | the private key |
   | `VAPID_SUBJECT` | the site's URL, `https://lasciviens.github.io/Project_Daily/` (the default when unset), or `mailto:` + a non-work address — never a work e-mail |
   | `PUSH_CRON_SECRET` | a fresh `openssl rand -hex 24` |

3. **Supabase Vault** — the cron job is SQL, so it reads its copy of the cron
   secret from Vault, not from the function's environment. Add
   `PUSH_CRON_SECRET` there with **the same value** as in step 2, e.g. in the
   SQL Editor:
   ```sql
   select vault.create_secret('<the same PUSH_CRON_SECRET>', 'PUSH_CRON_SECRET');
   ```
   If the two values differ, `push-send` answers the cron with 401 and no push
   goes out.

4. **Client build variable** — add `VITE_VAPID_PUBLIC_KEY` = the **public** key
   as a GitHub Actions **Variable** (repo **Settings → Secrets and variables →
   Actions → Variables**), then deploy once so the built app has it: **Actions →
   Deploy → Run workflow** on `main` (or merge anything). The public key is safe
   to expose; the private one stays in the Edge Function secrets only.

5. **Migration `068`** creates `push_subscriptions` and schedules the daily
   cron. It is older than the automatic deploy (which only runs migrations
   numbered above 140), so it was run by hand. To check:
   `select to_regclass('public.push_subscriptions');` returns the table name
   when it ran. If it returns null, run `068_push_subscriptions.sql` in the SQL
   Editor; if it errors on `pg_cron`/`pg_net`, enable both in **Dashboard →
   Database → Extensions** and run it again.

6. **`push-send` needs no step.** Every merge to `main` deploys it, with JWT
   verification off as set in `supabase/config.toml` (the cron sends a shared
   secret, not a Supabase JWT).

7. **On the iPhone** — open the app as an **installed PWA** (Safari → Share →
   **Add to Home Screen**, if it isn't already) → tap **More** in the tab bar →
   **Turn on notifications** → **Allow**. A toast says "Notifications enabled ✓".
   On a computer the same row is in the avatar menu (top right) and on
   **Settings → Appearance → Notifications**.

---

## Test it right now (don't wait for morning)
In the SQL Editor (replace the secret with your `PUSH_CRON_SECRET`):
```sql
select net.http_post(
  url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/push-send',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<YOUR PUSH_CRON_SECRET>'),
  body := jsonb_build_object('trigger','morning')
);
```
The notification should reach your phone within seconds to minutes. `push-send`
returns `{ok, sent, pruned, reminders}` — `sent > 0` means it hit a live
subscription.

## Notes
- Works only in the **home-screen-installed PWA** (not a Safari tab), iOS 16.4+.
- Supplement reminders (migration `160`, `docs/features/supplements.md`): a second job,
  `lascis-supplement-reminders`, runs every 15 minutes and calls `push-send` with
  `{trigger:'supplements'}` only when a dose's reminder is due — same secret, same
  subscriptions, nothing more to set up. To see it run (read only):
  `select start_time, status, return_message from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'lascis-supplement-reminders') order by start_time desc limit 5;`
- Timing: the cron is `'0 7 * * *'` = **07:00 UTC ≈ 09:00 Oslo in summer
  (CEST) / 08:00 in winter (CET)**. To change it, re-run
  `cron.schedule('lascis-morning-push', '<expr>', …)`.
- Changing `PUSH_CRON_SECRET`: change it in **both** places — the Edge Function
  secret and Vault. The cron reads Vault each time it runs; the function reads
  its environment.
- A subscription belongs to a login (migration `140`): `push-send` sends only to
  rows whose login session still exists (older unstamped rows: seen in the last
  60 days). Signing out deletes this device's subscription and signs every
  device out, so after a sign-out sign in again and, on the device you signed
  out from, turn notifications on again.
- Expired subscriptions are pruned automatically (`push-send` deletes a row on
  404/410).
