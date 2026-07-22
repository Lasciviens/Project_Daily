// phone-gateway — the single durable entry point for the iPhone (Shortcuts /
// Scriptable widgets). Authenticates by a static, revocable device secret
// (x-phone-secret === PHONE_GATEWAY_SECRET), acts as the single user
// (HEVY_USER_ID) SERVER-SIDE via the service-role key, and takes a flat
// { action, ... } body so the shortcuts stay simple (no nested JSON, no
// expiring JWT). Deterministic actions run directly here; AI actions forward to
// ai-proxy (passing the same secret — ai-proxy accepts it).
//
// Deploy with "Enforce JWT Verification" OFF (config.toml) — the secret is not a
// Supabase JWT, same pattern as hevy-sync/health-export-webhook. The
// service-role key NEVER leaves the server. Self-contained (no _shared imports).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-phone-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>
const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : d }
const todayUTC = () => new Date().toISOString().slice(0, 10)

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Insert a diary row as the single user. Handles the pre-061 schema (no status
// column) the same way the client does, so it never hard-fails on old schema.
async function insertFoodLog(userId: string, row: AnyRecord) {
  let { error } = await supabase.from('food_log_entries').insert({ ...row, user_id: userId, status: 'eaten' })
  if (error && (error.code === '42703' || error.code === 'PGRST204') && /status/i.test(error.message ?? '')) {
    ;({ error } = await supabase.from('food_log_entries').insert({ ...row, user_id: userId }))
  }
  return error
}

// Forward an AI request to ai-proxy using the SAME phone secret (ai-proxy has an
// x-phone-secret auth branch → acts as the same single user). Returns { text }.
async function askAi(q: string, secret: string): Promise<AnyRecord> {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-phone-secret': secret },
    body: JSON.stringify({ messages: [{ role: 'user', content: q }], surface: 'general' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: data?.error ?? `ai-proxy ${res.status}` }
  return { ok: true, text: data?.text ?? '', model: data?.model }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)

  // ── Auth: device secret ──
  const secret = Deno.env.get('PHONE_GATEWAY_SECRET')
  const given = req.headers.get('x-phone-secret')
  if (!secret || given !== secret) return json({ error: 'Unauthorized' }, 401)
  const userId = Deno.env.get('HEVY_USER_ID')
  if (!userId) return json({ error: 'Server not configured (HEVY_USER_ID)' }, 503)

  const body = await req.json().catch(() => ({})) as AnyRecord
  const action = String(body.action ?? '')

  try {
    switch (action) {
      // ── Deterministic: log a supplement (default creatine) ──
      case 'log_supplement': {
        const title = (typeof body.title === 'string' && body.title.trim()) || 'Kreatin 5 g'
        const err = await insertFoodLog(userId, {
          date: body.date ?? todayUTC(), meal_slot: 'supplement',
          custom_title: title, calories: num(body.calories, 0),
        })
        return err ? json({ ok: false, error: err.message }, 400) : json({ ok: true, logged: title })
      }

      // ── Deterministic: log any food line ──
      case 'log_food': {
        const title = typeof body.title === 'string' ? body.title.trim() : ''
        if (!title) return json({ ok: false, error: 'title required' }, 400)
        const err = await insertFoodLog(userId, {
          date: body.date ?? todayUTC(), meal_slot: body.meal_slot ?? 'snack', custom_title: title,
          calories: num(body.calories, 0), protein_g: num(body.protein_g, 0),
          carbs_g: num(body.carbs_g, 0), fat_g: num(body.fat_g, 0),
        })
        return err ? json({ ok: false, error: err.message }, 400) : json({ ok: true, logged: title })
      }

      // ── Deterministic: today's eaten totals (for the widget) ──
      case 'nutrition_today': {
        const date = body.date ?? todayUTC()
        let { data, error } = await supabase.from('food_log_entries')
          .select('calories, protein_g').eq('user_id', userId).eq('date', date).eq('status', 'eaten')
        if (error && (error.code === '42703' || error.code === 'PGRST204') && /status/i.test(error.message ?? '')) {
          ;({ data, error } = await supabase.from('food_log_entries')
            .select('calories, protein_g').eq('user_id', userId).eq('date', date))
        }
        if (error) return json({ ok: false, error: error.message }, 400)
        const rows = data ?? []
        return json({
          ok: true, date,
          kcal: Math.round(rows.reduce((a: number, r: AnyRecord) => a + num(r.calories), 0)),
          protein_g: Math.round(rows.reduce((a: number, r: AnyRecord) => a + num(r.protein_g), 0)),
          entries: rows.length,
        })
      }

      // ── AI: free-form question / brief / sleep — forwarded to ai-proxy ──
      case 'ask':
      case 'brief':
      case 'sleep': {
        const q = action === 'brief'
          ? "Bana bugünün kısa sabah brief'ini ver: bugünkü görevler, program ve planlı antrenman. Kısa, madde madde."
          : action === 'sleep'
          ? 'Dün gece nasıl uyudum? Süreyi, kaliteyi ve son 7 günün ortalamasına göre kısa bir yorum ver.'
          : String(body.q ?? '').trim()
        if (!q) return json({ ok: false, error: 'q required for action "ask"' }, 400)
        return json(await askAi(q, secret))
      }

      default:
        return json({ ok: false, error: `Unknown action "${action}" (use log_supplement | log_food | nutrition_today | ask | brief | sleep)` }, 400)
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
