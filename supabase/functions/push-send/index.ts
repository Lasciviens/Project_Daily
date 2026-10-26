// push-send — signs a VAPID Web Push to every stored subscription and delivers
// it to the phone's lock screen even while the PWA is closed. Two callers:
//   • the pg_cron 'lascis-morning-push' job (x-cron-secret === PUSH_CRON_SECRET,
//     acts as the single user HEVY_USER_ID) — builds a short morning summary.
//   • the pg_cron 'lascis-supplement-reminders' job (same secret, migration
//     160, every 15 minutes and only when one is due) — { trigger: 'supplements' }
//     sends the supplement doses not taken yet.
//   • a browser (user JWT) with an explicit { title, body } — ad-hoc send.
// verify_jwt = false (config.toml): the cron path is a shared secret, not a JWT.
// Expired/gone subscriptions (404/410) are pruned automatically.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import webpush from 'npm:web-push@3.6.7'

// <supabase-keys>
// Supabase's new API keys (sb_secret_… / sb_publishable_…) arrive as JSON
// dictionaries keyed by name; the legacy JWT keys are the fallback until the
// owner switches them off (docs/backend/environment.md). Same in every
// function (scripts/verify-supabase-keys.cjs).
function supabaseKey(newVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(newVar) ?? '{}') as Record<string, unknown>
    const key = keys.default ?? Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  } catch { /* not set or not JSON: the legacy key */ }
  return Deno.env.get(legacyVar) ?? ''
}
const serviceKey = () => supabaseKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = () => supabaseKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
// </supabase-keys>

// Owner lock (security audit 10.10.2026, migration 139): this function serves
// only the owner (HEVY_USER_ID) and accounts listed in app_allowed_users (for
// example a test account). The owner never needs the table, so the check also
// works before migration 139 is applied.
async function isAppUser(userId: string): Promise<boolean> {
  if (userId === Deno.env.get('HEVY_USER_ID')) return true
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())
  const { data, error } = await admin.from('app_allowed_users').select('user_id').eq('user_id', userId).maybeSingle()
  return !error && !!data
}

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

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
// RFC 8292 takes an https: URL as the subject too (web-push 3.6.7 accepts
// https: and mailto:) — the public site, never a personal address in the repo.
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://lasciviens.github.io/Project_Daily/'
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
    // A skipped (cancelled) or already trained (done) session is not one to
    // come (migration 142: skipping a session cancels its task).
    const { data } = await supabase.from('time_blocks')
      .select('title, date, task:tasks(status)')
      .eq('user_id', userId).eq('category', 'training')
      .gte('date', today).lte('date', dateFromTodayUTC(3))
      .order('date', { ascending: true }).limit(10)
    const next = (data as AnyRecord[] ?? []).find(b => !['cancelled', 'done'].includes(b.task?.status))
    if (next) trLine = ` · 💪 ${next.title}`
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
  // Today's supplement doses not taken yet (migration 160; before it the RPC
  // is missing and the line is left out).
  let suppLine = ''
  try {
    const { data } = await supabase.rpc('supplement_doses', { p_user: userId, p_from: osloToday(), p_to: osloToday() })
    const open = ((data ?? []) as AnyRecord[]).filter(d => d.status === 'due' || d.status === 'upcoming')
    if (open.length) {
      const names = open.slice(0, 3).map(d => `${d.title} ${String(d.dose_time).slice(0, 5)}`).join(', ')
      suppLine = ` · 💊 ${names}${open.length > 3 ? ` +${open.length - 3}` : ''}`
    }
  } catch { /* skip */ }
  return { title: '🌅 Günaydın', body: `${tasksLine}${trLine}${wishLine}${suppLine}` }
}

// ── Supplement reminders (migration 160) ───────────────────────────────────
// The day is Oslo's (the doses' clock), never UTC.
const osloToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo' })

// Hand-mirrored from src/features/supplements/supplementReminder.ts (Deno can't
// import it; scripts/verify-supplement-doses.cjs compares the two) — change both.
// <supplement-reminders>
export interface ReminderDose {
  schedule_id: string
  title:       string
  dose_label:  string
  dose_date:   string
  dose_time:   string
}

/** The address a reminder opens: Food · Today with the dose sheet (one dose, or `due` = the day's open doses). */
export function doseLink(date: string, scheduleId?: string | null, time?: string | null): string {
  const q = new URLSearchParams({ dose: scheduleId || 'due', day: date })
  if (scheduleId && time) q.set('at', time.slice(0, 5))
  return `#/recipes?${q.toString()}`
}

/** The push for the doses due now, or null when none is. */
export function supplementReminder(doses: readonly ReminderDose[]): { title: string; body: string; url: string; tag: string; renotify: true } | null {
  if (doses.length === 0) return null
  const at = (d: ReminderDose) => String(d.dose_time).slice(0, 5)
  const what = (d: ReminderDose) => `${d.title} ${d.dose_label}`
  if (doses.length === 1) {
    const d = doses[0]
    return {
      title: `💊 ${what(d)} not taken yet (${at(d)})`,
      body: 'Tap to take it, skip it or snooze it.',
      url: doseLink(d.dose_date, d.schedule_id, at(d)),
      tag: 'supplement-reminder',
      renotify: true,
    }
  }
  return {
    title: `💊 ${doses.length} supplements not taken yet`,
    body: doses.map(d => `${what(d)} (${at(d)})`).join(' · '),
    url: doseLink(doses[0].dose_date),
    tag: 'supplement-reminder',
    renotify: true,
  }
}
// </supplement-reminders>

/** The doses whose reminder is due, stamped as reminded by the claim (one run
 *  at a time), as ONE notification. Missing RPC (before 160) → nothing. */
async function sendSupplementReminders(userId: string): Promise<{ sent: number; doses: number }> {
  const { data, error } = await supabase.rpc('supplement_reminders_claim', { p_user: userId })
  if (error) {
    console.error('supplement_reminders_claim failed:', error.message)
    return { sent: 0, doses: 0 }
  }
  const doses = (data ?? []) as ReminderDose[]
  const msg = supplementReminder(doses)
  if (!msg) return { sent: 0, doses: 0 }
  const res = await sendToAll(userId, msg)
  return { sent: res.sent, doses: doses.length }
}

// ── Release reminders (migration 122) ──────────────────────────────────────
// Hand-mirrored from src/features/media/reminders/reminderRules.ts (Deno can't
// import it; scripts/verify-media-reminders.cjs checks that file) — change both.
const daysUntil = (today: string, release: string) =>
  Math.round((Date.parse(`${release}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
function dueReminder(r: AnyRecord, today: string): { daysLeft: number; marks: number[] } | null {
  const left = daysUntil(today, String(r.release_date))
  if (left < 0) return null
  const offsets = (r.offsets ?? []) as number[], sent = (r.sent_offsets ?? []) as number[]
  const passed = offsets.filter(o => left <= o && !sent.includes(o))
  return passed.length ? { daysLeft: left, marks: passed } : null
}
const ddmmyyyy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
function reminderText(title: string, daysLeft: number, release: string): { title: string; body: string } {
  if (daysLeft <= 0) return { title: `🎬 ${title} is out today`, body: `Released ${ddmmyyyy(release)}` }
  const weeks = Math.round(daysLeft / 7)
  const when = daysLeft === 1 ? 'tomorrow' : daysLeft >= 28 ? 'in about a month' : daysLeft >= 7 ? `in ${weeks} week${weeks === 1 ? '' : 's'}` : `in ${daysLeft} days`
  return { title: `🎬 ${title} comes out ${when}`, body: `Release date ${ddmmyyyy(release)}` }
}

/** One push per title due today; marks what was sent so nothing repeats. Missing table → nothing. */
async function sendReleaseReminders(userId: string): Promise<number> {
  const today = todayUTC()
  const { data } = await supabase.from('media_release_reminders')
    .select('id, media_type, tmdb_id, title, release_date, offsets, sent_offsets')
    .eq('user_id', userId).gte('release_date', today).lte('release_date', dateFromTodayUTC(31)).limit(200)
  let n = 0
  for (const r of (data ?? []) as AnyRecord[]) {
    const due = dueReminder(r, today)
    if (!due) continue
    const msg = reminderText(String(r.title), due.daysLeft, String(r.release_date))
    const res = await sendToAll(userId, { ...msg, url: '#/media' })
    if (!res.sent) continue
    n++
    await supabase.from('media_release_reminders')
      .update({ sent_offsets: [...new Set([...(r.sent_offsets ?? []), ...due.marks])] }).eq('id', r.id)
  }
  return n
}

// Only devices still signed in get the brief (security audit 10.10.2026): a
// row stamped with a login session needs that session to still exist; an
// unstamped (older) row needs the app to have opened within 60 days.
// push_live_subscriptions() is migration 140; before it exists, every row.
async function liveSubscriptions(userId: string): Promise<AnyRecord[]> {
  const live = await supabase.rpc('push_live_subscriptions', { p_user: userId })
  if (!live.error) return (live.data ?? []) as AnyRecord[]
  console.error('push_live_subscriptions failed, sending to every row:', live.error.message)
  const { data } = await supabase.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth').eq('user_id', userId)
  return (data ?? []) as AnyRecord[]
}

// Only the browsers' own push services: a stored endpoint is otherwise any
// address this function would POST to (security audit 10.10.2026).
// Apple (iOS/macOS Safari), Google (Chrome, Edge on Android), Mozilla, Microsoft.
function isPushService(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    if (u.protocol !== 'https:' || u.port) return false
    const h = u.hostname.toLowerCase()
    return h === 'web.push.apple.com' || h.endsWith('.push.apple.com')
      || h === 'fcm.googleapis.com' || h === 'android.googleapis.com'
      || h === 'updates.push.services.mozilla.com' || h.endsWith('.push.services.mozilla.com')
      || h.endsWith('.notify.windows.com')
  } catch { return false }
}

async function sendToAll(userId: string, payload: AnyRecord): Promise<{ sent: number; pruned: number }> {
  const subs = (await liveSubscriptions(userId)).filter(s => {
    const ok = isPushService(String(s.endpoint ?? ''))
    if (!ok) console.error('push-send: skipped a subscription that is not a browser push service')
    return ok
  })
  let sent = 0, pruned = 0
  for (const s of subs) {
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

// Constant-time secret check (security review 26.10.2026): both sides are
// hashed to the same length first, so the answer time shows neither the
// secret's length nor how much of it matched. Never log either value.
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([hash(given), hash(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ ok: false, error: 'VAPID keys not configured' }, 503)

  // ── Auth: cron secret (single user) OR a browser JWT ──
  const cronSecret = Deno.env.get('PUSH_CRON_SECRET')
  const given = req.headers.get('x-cron-secret')
  let userId: string | null = null
  const viaCron = !!cronSecret && await sameSecret(given ?? '', cronSecret)
  if (viaCron) {
    userId = Deno.env.get('HEVY_USER_ID') ?? null
  } else {
    const authHeader = req.headers.get('authorization')
    if (authHeader) {
      const { data } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
      userId = data?.user?.id ?? null
      if (userId && !(await isAppUser(userId))) return json({ ok: false, error: 'forbidden' }, 403)
    }
  }
  if (!userId) return json({ ok: false, error: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as AnyRecord

  // The supplement reminder job (only the cron: a run stamps what it reminds of).
  if (body.trigger === 'supplements') {
    if (!viaCron) return json({ ok: false, error: 'forbidden' }, 403)
    try {
      return json({ ok: true, ...(await sendSupplementReminders(userId)) })
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500)
    }
  }

  // url is scope-relative — the service worker prepends registration.scope
  // (…/Project_Daily/), so the hash route resolves under the PWA base.
  const payload = body.trigger === 'morning'
    ? { ...(await buildMorning(userId)), url: '#/home' }
    : { title: String(body.title ?? 'Lasci\'s Board'), body: String(body.body ?? ''), url: String(body.url ?? '#/home') }

  try {
    const res = await sendToAll(userId, payload)
    // The morning run also delivers release reminders — each its own notification.
    const reminders = body.trigger === 'morning' ? await sendReleaseReminders(userId).catch(() => 0) : 0
    return json({ ok: true, ...res, reminders })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
