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

// en-GB day+month ("1 Dec"), used only when a wish carries no period_label.
const dayMon = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const periodRange = (a: string, b: string | null) => (b ? `${dayMon(a)} – ${dayMon(b)}` : `From ${dayMon(a)}`)
const seasonEmoji = (d: string) =>
  ['❄️', '❄️', '🌸', '🌸', '🌸', '☀️', '☀️', '☀️', '🍂', '🍂', '🍂', '❄️'][Number(d.slice(5, 7)) - 1] ?? '📅'
// WindowChips writes period_label WITH its own season emoji ("❄️ This winter"),
// so a stored label already carries one — strip any leading non-letter run before
// prepending seasonEmoji or the line renders the emoji twice.
const labelText = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').trim()

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
  // A wish period opening is announced ONCE, on the day period_start lands on
  // today — a wish list is a memory, not a to-do, so repeating it every day of
  // a three-month season would turn the morning push into a nag and get it
  // muted. Purely additive: the tasks query above is untouched.
  let wishLine = ''
  try {
    // Missing table (069 not applied) → { data: null, error } — never throws,
    // so the null-check, not the catch, is what keeps the brief alive.
    const { data } = await supabase.from('wish_items')
      .select('period_label, period_start, period_end')
      .eq('user_id', userId).eq('period_start', today)
      .in('status', ['idea', 'planned']).limit(50)
    // Two wishes sharing a period become ONE line, keyed by how the period is
    // named. A row with no label of its own can only be described by its dates,
    // which does not fit "<name> starts today" — hence the two phrasings.
    const groups = new Map<string, { n: number; named: boolean }>()
    for (const w of (data ?? []) as AnyRecord[]) {
      const named = !!labelText(w.period_label ?? '')
      const key   = named ? labelText(w.period_label) : periodRange(w.period_start, w.period_end)
      const prev  = groups.get(key)
      groups.set(key, { n: (prev?.n ?? 0) + 1, named })
    }
    wishLine = [...groups].slice(0, 2)
      .map(([key, { n, named }]) => {
        const what = named ? `${key} starts today` : `A new period starts today (${key})`
        return ` · ${seasonEmoji(today)} ${what} — ${n} thing${n === 1 ? '' : 's'} on your list`
      })
      .join('')
  } catch { /* skip */ }
  return { title: '🌅 Günaydın', body: `${tasksLine}${trLine}${wishLine}` }
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
