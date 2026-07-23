# Web Push setup — morning brief on the lock screen

**What you get:** every morning a "🌅 Günaydın" notification lands on your phone's
lock screen — **server-sent while you sleep**, no app-open needed. Tapping it
opens the app. iOS delivery is best-effort (may be a few minutes late).

Architecture: `push_subscriptions` table + `push-send` edge function (VAPID) +
a pg_cron job that fires it daily. Service worker shows the notification.

---

## Your one-time steps

1. **Generate VAPID keys** (any machine with Node):
   ```
   npx web-push generate-vapid-keys
   ```
   Copy the **Public Key** and **Private Key**.

2. **Supabase → Vault (Edge Function secrets)** — add four:
   | name | value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | the public key |
   | `VAPID_PRIVATE_KEY` | the private key |
   | `VAPID_SUBJECT` | `mailto:furkan.hamdemir@power.no` |
   | `PUSH_CRON_SECRET` | a fresh `openssl rand -hex 24` (the cron uses it) |

3. **Client build env** — add `VITE_VAPID_PUBLIC_KEY` = the **public** key where
   the other `VITE_` vars live (GitHub → repo **Settings → Secrets and variables
   → Actions → Variables**), then re-run the deploy so the built app has it.
   (The public key is safe to expose; the private one stays in Vault only.)

4. **Apply migration `068`** (Dashboard → SQL Editor). It creates
   `push_subscriptions` and schedules the daily cron. If it errors on
   `pg_cron`/`pg_net`, enable both in **Dashboard → Database → Extensions**, then
   re-run.

5. **Deploy the `push-send` edge function** (Enforce JWT Verification → **OFF**).

6. **On the iPhone** — open the app as an **installed PWA** (Safari → Share →
   *Ana Ekrana Ekle*, if not already) → **⚙ Settings → Bildirimler →
   🔔 Bildirimleri aç** → allow. Done.

---

## Test it right now (don't wait for morning)
In SQL Editor (replace the secret with your `PUSH_CRON_SECRET`):
```sql
select net.http_post(
  url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/push-send',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<YOUR PUSH_CRON_SECRET>'),
  body := jsonb_build_object('trigger','morning')
);
```
The notification should reach your phone within seconds–minutes. `push-send`
returns `{ok, sent, pruned}` — `sent > 0` means it hit a live subscription.

## Notes
- Works only on the **home-screen-installed PWA** (not a Safari tab), iOS 16.4+.
- Timing: the cron runs **05:00 UTC ≈ 07:00 Oslo (summer) / 06:00 (winter)**. To
  change it, re-run `cron.schedule('lascis-morning-push', '<expr>', …)`.
- Changing `PUSH_CRON_SECRET`: just update it in Vault — the cron reads it from
  Vault at call time, no re-migration needed.
- Expired subscriptions are auto-pruned (push-send deletes on 404/410).
