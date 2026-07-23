// push-send — signs a VAPID Web Push to every stored subscription and delivers
// it to the phone's lock screen even while the PWA is closed. Two callers:
//   • the pg_cron 'lascis-morning-push' job (x-cron-secret === PUSH_CRON_SECRET,
//     acts as the single user HEVY_USER_ID) — builds a short morning summary.
//   • a browser (user JWT) with an explicit { title, body } — ad-hoc send.
// verify_jwt = false (config.toml): the cron path is a shared secret, not a JWT.
// Expired/gone subscriptions (404/410) are pruned automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>
const todayUTC = () => new Date().toISOString().slice(0, 10)
const dateFromTodayUTC = (d: number) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:furkan.hamdemir@power.no'
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

// Short, notification-sized morning summary (title + body). Deterministic — no
// AI, so it's instant and reliable. User-scoped (service role bypasses RLS).
async function buildMorning(userId: string): Promise<{ title: string; body: string }> {
  const today = todayUTC()
  let tasksLine = 'bugün planlı iş yok'
  try {
    const { data } = await supabase.from('tasks')
      .select('title')
      .eq('user_id', userId).or(`section.eq.today,due_date.eq.${today}`)
      .neq('status', 'cancelled').neq('status', 'done')
      .order('due_time', { ascending: true }).limit(3)
    const n = data?.length ?? 0
    if (n) tasksLine = `${n} açık iş · ${(data as AnyRecord[]).map(t => t.title).slice(0, 2).join(', ')}`
  } catch { /* skip */ }
  let trLine = ''
  try {
    const { data } = await supabase.from('time_blocks')
      .select('title, date')
      .eq('user_id', userId).eq('category', 'training')
      .gte('date', today).lte('date', dateFromTodayUTC(3))
      .order('date', { ascending: true }).limit(1)
    if (data?.[0]) trLine = ` · 💪 ${(data[0] as AnyRecord).title}`
  } catch { /* skip */ }
  return { title: '🌅 Günaydın', body: `${tasksLine}${trLine}` }
}

async function sendToAll(userId: string, payload: AnyRecord): Promise<{ sent: number; pruned: number }> {
  const { data: subs } = await supabase.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth').eq('user_id', userId)
  let sent = 0, pruned = 0
  for (const s of (subs ?? []) as AnyRecord[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      )
      sent++
    } catch (e) {
      const code = (e as AnyRecord)?.statusCode
      if (code === 404 || code === 410) { await supabase.from('push_subscriptions').delete().eq('id', s.id); pruned++ }
    }
  }
  return { sent, pruned }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ ok: false, error: 'VAPID keys not configured' }, 503)

  // ── Auth: cron secret (single user) OR a browser JWT ──
  const cronSecret = Deno.env.get('PUSH_CRON_SECRET')
  const given = req.headers.get('x-cron-secret')
  let userId: string | null = null
  if (cronSecret && given === cronSecret) {
    userId = Deno.env.get('HEVY_USER_ID') ?? null
  } else {
    const authHeader = req.headers.get('authorization')
    if (authHeader) {
      const { data } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
      userId = data?.user?.id ?? null
    }
  }
  if (!userId) return json({ ok: false, error: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as AnyRecord
  // url is scope-relative — the service worker prepends registration.scope
  // (…/Project_Daily/), so the hash route resolves under the PWA base.
  const payload = body.trigger === 'morning'
    ? { ...(await buildMorning(userId)), url: '#/home' }
    : { title: String(body.title ?? 'Lasci\'s Board'), body: String(body.body ?? ''), url: String(body.url ?? '#/home') }

  try {
    const res = await sendToAll(userId, payload)
    return json({ ok: true, ...res })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
