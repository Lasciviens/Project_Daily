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
// A 'status' column missing = pre-061 schema; callers fall back to the old
// (no-status) query shape so nothing breaks on an un-migrated DB.
const statusMissing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204') && /status/i.test(e.message ?? '')

async function insertFoodLog(userId: string, row: AnyRecord) {
  let { error } = await supabase.from('food_log_entries').insert({ ...row, user_id: userId, status: 'eaten' })
  if (statusMissing(error)) {
    ;({ error } = await supabase.from('food_log_entries').insert({ ...row, user_id: userId }))
  }
  return error
}

// Latency design (iOS Shortcuts "Get Contents of URL" times out at ~25s):
// - FAST_MODEL: start AI calls on a fast lite model, skipping the frequently
//   503-overloaded 3.5-flash primary (a 503 there used to burn ~7-13s of retry
//   budget before falling through). ai-proxy still falls through the rest of
//   the chain on a 503.
// - brief: context is pre-built HERE (server-side) and sent with surface
//   'phone' → ai-proxy runs it with NO tools = a single-shot answer, not a
//   2-4 turn tool loop (the big win).
// - a 22s AbortController on the ai-proxy call returns a clean error BEFORE the
//   ~25s client cutoff instead of a silent hang.
const FAST_MODEL = 'gemini-3.1-flash-lite'
const PHONE_PERSONA =
  "Sen Lasci'nin kişisel asistanısın. Türkçe, kısa ve net cevap ver; düz metin " +
  '(kısa maddeler olabilir, markdown yok). Sana verilen DATA dışında bilgi uydurma.'

// yyyy-MM-dd, `days` from today (UTC).
function dateFromTodayUTC(days: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10)
}

// Build a COMPACT brief context server-side (today's tasks + schedule + upcoming
// training) so the AI answers in ONE shot with no tool loop — mirrors the web
// daily-briefing's pre-built-context approach. Service role bypasses RLS, so
// every query is user-scoped EXPLICITLY. Best-effort: a failing section is
// omitted, never breaks the brief. Column names mirror briefingApi.ts.
async function buildBriefContext(userId: string): Promise<string> {
  const today = todayUTC()
  const lines: string[] = [`DATE: ${today}`]
  try {
    const { data: tasks } = await supabase.from('tasks')
      .select('title, status, priority, domain, due_time')
      .eq('user_id', userId).or(`section.eq.today,due_date.eq.${today}`)
      .neq('status', 'cancelled').neq('status', 'done')
      .order('due_time', { ascending: true }).limit(20)
    if (tasks?.length) {
      lines.push(`\nBUGÜNKÜ İŞLER (${tasks.length} açık):`)
      for (const t of tasks as AnyRecord[]) {
        lines.push(`  - ${t.title} [${t.priority}${t.domain ? `, ${t.domain}` : ''}]${t.due_time ? ` @${String(t.due_time).slice(0, 5)}` : ''}`)
      }
    } else { lines.push('\nBUGÜNKÜ İŞLER: yok') }
  } catch { /* omit section */ }
  try {
    const { data: blocks } = await supabase.from('time_blocks')
      .select('title, start_time, duration_minutes')
      .eq('user_id', userId).eq('date', today)
      .order('start_time', { ascending: true }).limit(20)
    const withTime = (blocks as AnyRecord[] ?? []).filter(b => b.start_time)
    if (withTime.length) {
      lines.push('\nBUGÜNKÜ PROGRAM:')
      for (const b of withTime) lines.push(`  - ${String(b.start_time).slice(0, 5)} ${b.title}${b.duration_minutes ? ` (${b.duration_minutes}dk)` : ''}`)
    }
  } catch { /* omit section */ }
  try {
    const { data: tr } = await supabase.from('time_blocks')
      .select('title, date, start_time')
      .eq('user_id', userId).eq('category', 'training')
      .gte('date', today).lte('date', dateFromTodayUTC(14))
      .order('date', { ascending: true }).limit(5)
    if (tr?.length) {
      lines.push('\nYAKLAŞAN ANTRENMANLAR:')
      for (const s of tr as AnyRecord[]) lines.push(`  - ${s.date}${s.start_time ? ` ${String(s.start_time).slice(0, 5)}` : ''} ${s.title}`)
    }
  } catch { /* omit section */ }
  return lines.join('\n')
}

// Forward an AI request to ai-proxy using the SAME phone secret (ai-proxy has an
// x-phone-secret auth branch → acts as the same single user). Bounded by a 22s
// AbortController so a slow/hung upstream returns a clean error before the
// client's ~25s timeout. Returns { ok, text, model }.
async function askAi(opts: {
  q: string; secret: string; surface?: string; model?: string; systemPrompt?: string
}): Promise<AnyRecord> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 22_000)
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-proxy`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-phone-secret': opts.secret },
      body: JSON.stringify({
        messages:  [{ role: 'user', content: opts.q }],
        surface:   opts.surface ?? 'general',
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
      }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.error ?? `ai-proxy ${res.status}` }
    return { ok: true, text: data?.text ?? '', model: data?.model }
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError'
      ? 'AI timed out (~22s). Try again in a moment.'
      : (e as Error).message
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
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
        // Water total (its own table; missing pre-067 → 0, never errors the widget).
        let waterMl = 0
        const w = await supabase.from('water_log_entries')
          .select('amount_ml').eq('user_id', userId).eq('date', date)
        if (!w.error && w.data) waterMl = (w.data as AnyRecord[]).reduce((a, r) => a + num(r.amount_ml), 0)
        return json({
          ok: true, date,
          kcal: Math.round(rows.reduce((a: number, r: AnyRecord) => a + num(r.calories), 0)),
          protein_g: Math.round(rows.reduce((a: number, r: AnyRecord) => a + num(r.protein_g), 0)),
          water_ml: Math.round(waterMl),
          entries: rows.length,
        })
      }

      // ── Deterministic: log water (default 250 ml — e.g. an NFC bottle tap) ──
      case 'log_water': {
        const amount = num(body.amount_ml, 250)
        if (amount <= 0) return json({ ok: false, error: 'amount_ml must be > 0' }, 400)
        const { error } = await supabase.from('water_log_entries')
          .insert({ user_id: userId, date: body.date ?? todayUTC(), amount_ml: Math.round(amount) })
        return error ? json({ ok: false, error: error.message }, 400) : json({ ok: true, logged_ml: Math.round(amount) })
      }

      // ── Deterministic: recently-eaten foods (dedup, snapshot macros) — for
      //    the phone logger's "re-log" chips. Mirrors the client's fetchRecentFoods. ──
      case 'recent_foods': {
        const fromDate = body.from ?? dateFromTodayUTC(-30)
        const cols = 'meal_slot, custom_title, calories, protein_g, carbs_g, fat_g, ingredient:recipe_ingredient_library(name), recipe:recipes(title)'
        const base = () => {
          let q = supabase.from('food_log_entries').select(cols)
            .eq('user_id', userId).gte('date', fromDate)
            .order('created_at', { ascending: false }).limit(80)
          if (typeof body.slot === 'string' && body.slot) q = q.eq('meal_slot', body.slot)
          return q
        }
        let { data, error } = await base().eq('status', 'eaten')
        if (statusMissing(error)) ({ data, error } = await base())
        if (error) return json({ ok: false, error: error.message }, 400)
        const seen = new Set<string>()
        const foods: AnyRecord[] = []
        for (const r of (data ?? []) as AnyRecord[]) {
          const title = r.ingredient?.name ?? r.recipe?.title ?? r.custom_title
          if (!title) continue
          const key = title.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          foods.push({
            title, meal_slot: r.meal_slot,
            calories: num(r.calories), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g),
          })
          if (foods.length >= 15) break
        }
        return json({ ok: true, foods })
      }

      // ── Deterministic: search the user's own ingredient library (per-100g). ──
      case 'search_library': {
        const q = String(body.q ?? '').replace(/[%,()]/g, ' ').trim()
        if (!q) return json({ ok: false, error: 'q required' }, 400)
        const { data, error } = await supabase.from('recipe_ingredient_library')
          .select('name, calories, protein_g, carbs_g, fat_g, serving_label, serving_grams')
          .eq('user_id', userId).ilike('name', `%${q}%`).order('name', { ascending: true }).limit(25)
        if (error) return json({ ok: false, error: error.message }, 400)
        const items = ((data ?? []) as AnyRecord[]).map(r => ({
          name: r.name,
          // Library macros are ALWAYS per 100 g.
          per100: { kcal: num(r.calories), p: num(r.protein_g), c: num(r.carbs_g), f: num(r.fat_g) },
          serving_label: r.serving_label ?? null, serving_grams: r.serving_grams ?? null,
        }))
        return json({ ok: true, items })
      }

      // ── AI: free-form question — forwarded to ai-proxy (fast model, full
      //    tools since the question is open-ended) ──
      case 'ask': {
        const q = String(body.q ?? '').trim()
        if (!q) return json({ ok: false, error: 'q required for action "ask"' }, 400)
        return json(await askAi({ q, secret, surface: 'general', model: FAST_MODEL, systemPrompt: PHONE_PERSONA }))
      }

      // ── AI: morning brief — context pre-built here → single-shot, no tools ──
      case 'brief': {
        const ctx = await buildBriefContext(userId)
        const q = `Bana bugünün kısa sabah brief'ini ver: işler, program, yaklaşan antrenman. Kısa, madde madde. SADECE aşağıdaki DATA'yı kullan:\n\n${ctx}`
        return json(await askAi({ q, secret, surface: 'phone', systemPrompt: PHONE_PERSONA }))
      }

      // ── AI: sleep — one get_health_stats tool call (source-aware) then a
      //    short comment; fast model, full tools ──
      case 'sleep': {
        const q = 'Dün gece nasıl uyudum? Uyku verisi için get_health_stats aracını çağır, sonra süre + kaliteyi son 7 günün ortalamasıyla kıyaslayarak kısa yorumla.'
        return json(await askAi({ q, secret, surface: 'general', model: FAST_MODEL, systemPrompt: PHONE_PERSONA }))
      }

      default:
        return json({ ok: false, error: `Unknown action "${action}" (use log_supplement | log_food | log_water | nutrition_today | recent_foods | search_library | ask | brief | sleep)` }, 400)
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
