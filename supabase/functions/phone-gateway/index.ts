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

// Deterministic sleep nights (port of ai-proxy's computeSleepNights): merge
// overlapping [start,end] sessions keeping the LONGEST per cluster (duplicate/
// subset re-reports of one night), attribute to the Oslo wake day, last 7 days.
async function computeSleepNightsGw(userId: string): Promise<AnyRecord[]> {
  const since = dateFromTodayUTC(-7)
  const { data } = await supabase.from('health_metrics')
    .select('value').eq('user_id', userId).eq('metric_name', 'sleep_analysis').gte('date', since)
  const parse = (s: unknown): number | null => {
    if (typeof s !== 'string') return null
    const iso = s.trim().replace(' ', 'T').replace(/\s*([+-]\d{2}):?(\d{2})$/, '$1:$2')
    let t = Date.parse(iso); if (!Number.isFinite(t)) t = Date.parse(s)
    return Number.isFinite(t) ? t : null
  }
  const sess = ((data ?? []) as AnyRecord[]).map(r => {
    const v = r.value ?? {}
    return { v, start: parse(v.sleepStart), end: parse(v.sleepEnd), total: num(v.totalSleep) }
  }).filter(s => s.start != null && s.end != null && (s.end as number) > (s.start as number))
  sess.sort((a, b) => (a.start as number) - (b.start as number))
  const kept: typeof sess = []; let cl: typeof sess = []; let cEnd = -Infinity
  const flush = () => { if (cl.length) { kept.push(cl.reduce((b, s) => (s.total > b.total ? s : b))); cl = [] } }
  for (const s of sess) { if ((s.start as number) >= cEnd) flush(); cl.push(s); cEnd = Math.max(cEnd, s.end as number) }
  flush()
  const hm  = (m: number | null) => m == null ? null : new Date(m).toLocaleTimeString('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' })
  const day = (m: number) => new Date(m).toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo' })
  return kept.map(s => {
    const v = s.v, inS = parse(v.inBedStart), inE = parse(v.inBedEnd)
    return {
      date:  day(s.end as number),
      hours: Math.round(s.total * 100) / 100,
      in_bed_h: (inS != null && inE != null && inE > inS) ? Math.round((inE - inS) / 36000) / 100 : null,
      deep_h: Math.round(num(v.deep) * 100) / 100, core_h: Math.round(num(v.core) * 100) / 100,
      rem_h:  Math.round(num(v.rem) * 100) / 100, awake_h: Math.round(num(v.awake) * 100) / 100,
      start: hm(s.start), end: hm(s.end),
    }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

// ── Body composition report import (smart-scale OCR → Shortcut → gateway) ──
// The Shortcut OCRs a fixed-layout "Body composition analysis report" image
// on-device (Apple's own OCR, no LLM involved anywhere in this path) and
// POSTs the 14 extracted numbers + a local measured_at + timezone here.
// Validation is pure numeric sanity (finite, in-range, internally
// consistent) — it never reproduces the device's own High/Normal/Low
// classification bands, which are judgments, not measurements.
// Contract: docs/iphone-examples.md's "import_body_composition" section —
// keep that doc and this handler in sync.
const BODY_COMP_SOURCE = 'movinglife_report'
const DEFAULT_MEASUREMENT_TZ = 'Europe/Oslo'

// Report values print to 1 decimal place, so a cross-field check (weight ×
// bf% vs body_fat_mass_kg, weight − fat mass vs lean_body_mass_kg) can be off
// by a few hundredths of a kg from rounding alone — three independent
// 1-decimal roundings compound to ~0.15 kg worst case. Tolerance is the
// LARGER of that flat floor or 0.5% of the person's own weight, so it scales
// sensibly for a much heavier or lighter person than the flat floor assumes.
const CONSISTENCY_TOL_ABS_KG = 0.15
const CONSISTENCY_TOL_REL = 0.005
function withinTolerance(expected: number, actual: number, weightKg: number): boolean {
  const tol = Math.max(CONSISTENCY_TOL_ABS_KG, CONSISTENCY_TOL_REL * weightKg)
  return Math.abs(expected - actual) <= tol
}

// Re-send comparison (already_exists vs conflict): a genuine re-delivery of
// the SAME report should match near-exactly. Deliberately tighter than the
// cross-field tolerance above, which exists for rounding drift BETWEEN
// different fields, not for comparing one field to its own earlier value.
const RESEND_TOL = 0.05
function sameValue(a: number, b: number): boolean { return Math.abs(a - b) <= RESEND_TOL }

interface BodyCompField { key: string; min: number; max: number; integer?: boolean }
// Sanity bounds only — generous enough to admit any real human report, tight
// enough to catch a genuinely broken OCR read (a negative weight, a 300%
// body-fat reading). Never the device's own classification thresholds.
const BODY_COMP_FIELDS: BodyCompField[] = [
  { key: 'weight_kg',               min: 1,   max: 500 },
  { key: 'body_fat_percent',        min: 0,   max: 100 },
  { key: 'body_fat_mass_kg',        min: 0,   max: 500 },
  { key: 'lean_body_mass_kg',       min: 0,   max: 500 },
  { key: 'body_water_percent',      min: 0,   max: 100 },
  { key: 'protein_percent',         min: 0,   max: 100 },
  { key: 'muscle_percent',          min: 0,   max: 100 },
  { key: 'skeletal_muscle_percent', min: 0,   max: 100 },
  { key: 'skeletal_muscle_index',   min: 0,   max: 50  },
  { key: 'bmi',                     min: 5,   max: 100 },
  { key: 'visceral_fat_index',      min: 0,   max: 100, integer: true },
  { key: 'subcutaneous_fat_kg',     min: 0,   max: 200 },
  { key: 'bmr_kcal',                min: 200, max: 6000, integer: true },
  { key: 'body_score',              min: 0,   max: 100, integer: true },
]

// Resolves a NAIVE local wall-clock time ("2026-09-06T08:23:00", no offset —
// the report never carries one) in `timeZone` to a real UTC instant. Never a
// hardcoded +02:00/+01:00 — DST-safe via the standard two-pass IANA-offset
// technique: guess the instant assuming UTC, read what wall-clock time THAT
// instant maps to in the target zone via Intl (Deno ships full tzdata), then
// correct by the difference and repeat once more (the offset at the
// corrected instant can differ from the offset at the guess on either side
// of a DST transition). Two passes converge for every ordinary spring-
// forward/fall-back case; the true edge case — a wall-clock time that falls
// in the one-hour gap skipped forward, or repeated twice on fall-back — has
// no single correct answer by construction, and is out of scope here.
function zonedWallTimeToUtcMs(y: number, mo: number, d: number, h: number, mi: number, se: number, timeZone: string): number {
  const offsetMsAt = (utcMs: number): number => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const parts: AnyRecord = {}
    for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== 'literal') parts[p.type] = p.value
    let hour = Number(parts.hour); if (hour === 24) hour = 0
    const asIfUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second))
    return asIfUTC - utcMs
  }
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, se)
  const utc1 = guessUtc - offsetMsAt(guessUtc)
  return guessUtc - offsetMsAt(utc1)
}

// Parses "YYYY-MM-DD[T ]HH:mm[:ss]" only — deliberately rejects a trailing Z
// or numeric offset (the report never has one, so one arriving here would be
// ambiguous — whose offset? — rather than helpful). Returns null on mismatch.
function parseNaiveLocalDateTime(s: string): { y: number; mo: number; d: number; h: number; mi: number; se: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  return { y: Number(y), mo: Number(mo), d: Number(d), h: Number(h), mi: Number(mi), se: Number(se ?? '0') }
}

function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

// Validates the full import_body_composition body: required/finite/in-range
// per field, then the two cross-field consistency checks. Returns either the
// clean numeric values + a resolved measured_at (UTC ISO string), or a
// field-keyed error map — never a partial write either way.
function validateBodyComposition(body: AnyRecord): { ok: true; values: AnyRecord; measuredAtIso: string } | { ok: false; errors: AnyRecord } {
  const errors: AnyRecord = {}

  let measuredAtIso: string | null = null
  const rawMeasuredAt = body.measured_at
  if (typeof rawMeasuredAt !== 'string' || !rawMeasuredAt.trim()) {
    errors.measured_at = 'required — local datetime, e.g. "2026-09-06T08:23:00", no UTC offset'
  } else {
    const parsed = parseNaiveLocalDateTime(rawMeasuredAt)
    if (!parsed) {
      errors.measured_at = 'must be "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss", local time, no Z/offset'
    } else {
      const tz = (typeof body.measurement_timezone === 'string' && body.measurement_timezone.trim())
        ? body.measurement_timezone.trim() : DEFAULT_MEASUREMENT_TZ
      if (!isValidTimeZone(tz)) {
        errors.measurement_timezone = `not a recognized IANA timezone: "${tz}"`
      } else {
        const utcMs = zonedWallTimeToUtcMs(parsed.y, parsed.mo, parsed.d, parsed.h, parsed.mi, parsed.se, tz)
        if (!Number.isFinite(utcMs)) errors.measured_at = 'could not be resolved to a real instant'
        else measuredAtIso = new Date(utcMs).toISOString()
      }
    }
  }

  const values: AnyRecord = {}
  for (const f of BODY_COMP_FIELDS) {
    const raw = body[f.key]
    if (raw === undefined || raw === null || raw === '') { errors[f.key] = 'required'; continue }
    const n = Number(raw)
    if (!Number.isFinite(n)) { errors[f.key] = 'must be a finite number'; continue }
    if (f.integer && !Number.isInteger(n)) { errors[f.key] = 'must be a whole number'; continue }
    if (n < f.min || n > f.max) { errors[f.key] = `out of expected range [${f.min}, ${f.max}]`; continue }
    values[f.key] = n
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  // Cross-field consistency — weight_kg/body_fat_percent/body_fat_mass_kg/
  // lean_body_mass_kg are all guaranteed present and range-valid at this point.
  const expectedFatMass = values.weight_kg * values.body_fat_percent / 100
  if (!withinTolerance(expectedFatMass, values.body_fat_mass_kg, values.weight_kg)) {
    errors.body_fat_mass_kg = `inconsistent with weight_kg × body_fat_percent (expected ≈${expectedFatMass.toFixed(2)})`
  }
  const expectedLean = values.weight_kg - values.body_fat_mass_kg
  if (!withinTolerance(expectedLean, values.lean_body_mass_kg, values.weight_kg)) {
    errors.lean_body_mass_kg = `inconsistent with weight_kg − body_fat_mass_kg (expected ≈${expectedLean.toFixed(2)})`
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return { ok: true, values, measuredAtIso: measuredAtIso! }
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

      // ── Deterministic: full sleep stats (last night + 7d) — for the NON-AI
      //    "Uyku İstatistikleri" shortcut. Overlap-merged, source-resolved. ──
      case 'sleep_stats': {
        const nights = await computeSleepNightsGw(userId)
        const last = nights.length ? { ...nights[nights.length - 1] } : null
        if (last) {
          // Sleep-adjacent metrics for that wake day (best-effort; omit if absent).
          const { data: m } = await supabase.from('health_metrics')
            .select('metric_name, value').eq('user_id', userId).eq('date', last.date)
            .in('metric_name', ['sleeping_heart_rate', 'heart_rate_variability', 'oxygen_saturation', 'respiratory_rate'])
          for (const r of (m ?? []) as AnyRecord[]) {
            const v = r.value ?? {}
            const val = Number(v.qty ?? v.Avg ?? v.avg)
            if (!Number.isFinite(val)) continue
            if (r.metric_name === 'sleeping_heart_rate')       last.sleeping_hr = Math.round(val)
            else if (r.metric_name === 'heart_rate_variability') last.hrv_ms = Math.round(val)
            else if (r.metric_name === 'oxygen_saturation')      last.spo2_pct = Math.round(val * 10) / 10
            else if (r.metric_name === 'respiratory_rate')       last.resp_rate = Math.round(val * 10) / 10
          }
        }
        return json({ ok: true, last_night: last, nights })
      }

      // ── Deterministic: today's open tasks + schedule — for "Bugünün Taskları". ──
      case 'tasks_today': {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo' })
        const tasks: AnyRecord[] = [], schedule: AnyRecord[] = []
        try {
          const { data } = await supabase.from('tasks')
            .select('title, priority, due_time')
            .eq('user_id', userId).or(`section.eq.today,due_date.eq.${today}`)
            .neq('status', 'cancelled').neq('status', 'done')
            .order('due_time', { ascending: true }).limit(30)
          for (const t of (data ?? []) as AnyRecord[]) tasks.push({ title: t.title, priority: t.priority, due_time: t.due_time ? String(t.due_time).slice(0, 5) : null })
        } catch { /* omit */ }
        try {
          const { data } = await supabase.from('time_blocks')
            .select('title, start_time').eq('user_id', userId).eq('date', today)
            .order('start_time', { ascending: true }).limit(30)
          for (const b of (data ?? []) as AnyRecord[]) if (b.start_time) schedule.push({ time: String(b.start_time).slice(0, 5), title: b.title })
        } catch { /* omit */ }
        return json({ ok: true, date: today, tasks, schedule })
      }

      // ── Deterministic: import a smart-scale body composition report,
      //    already OCR'd on-device by the Shortcut (no AI in this path). ──
      case 'import_body_composition': {
        const result = validateBodyComposition(body)
        if (!result.ok) return json({ status: 'validation_error', errors: result.errors }, 400)
        const { values, measuredAtIso } = result

        // A report re-sent verbatim is a silent no-op; re-sent with DIFFERENT
        // numbers for the same (user, source, measured_at) is a conflict —
        // never a silent overwrite (the DB unique index is the real
        // enforcement; this SELECT-first is what lets us answer cleanly
        // instead of surfacing a raw constraint-violation error).
        const sameReport = (existing: AnyRecord): boolean =>
          BODY_COMP_FIELDS.every(f => sameValue(Number(existing[f.key]), values[f.key]))
        const resolveAgainstExisting = (existing: AnyRecord) => sameReport(existing)
          ? json({ status: 'already_exists', id: existing.id }, 200)
          : json({ status: 'conflict', id: existing.id, message: 'A report already exists for this measured_at with different values.' }, 409)

        const { data: existing, error: selErr } = await supabase
          .from('body_composition_reports').select('*')
          .eq('user_id', userId).eq('source', BODY_COMP_SOURCE).eq('measured_at', measuredAtIso)
          .maybeSingle()
        if (selErr) return json({ status: 'server_error', error: selErr.message }, 500)
        if (existing) return resolveAgainstExisting(existing)

        const { data: inserted, error: insErr } = await supabase
          .from('body_composition_reports')
          .insert({ ...values, measured_at: measuredAtIso, source: BODY_COMP_SOURCE, user_id: userId })
          .select('id').single()

        if (insErr) {
          // Concurrent duplicate: another request inserted the identical
          // (user, source, measured_at) between our SELECT and this INSERT.
          // Re-resolve exactly like the non-race path above rather than
          // surfacing a raw DB error to the phone.
          if (insErr.code === '23505') {
            const { data: raced, error: raceErr } = await supabase
              .from('body_composition_reports').select('*')
              .eq('user_id', userId).eq('source', BODY_COMP_SOURCE).eq('measured_at', measuredAtIso)
              .maybeSingle()
            if (raceErr || !raced) return json({ status: 'server_error', error: raceErr?.message ?? 'concurrent write could not be resolved' }, 500)
            return resolveAgainstExisting(raced)
          }
          return json({ status: 'server_error', error: insErr.message }, 500)
        }
        return json({ status: 'created', id: inserted!.id }, 201)
      }

      default:
        return json({ ok: false, error: `Unknown action "${action}" (use log_supplement | log_food | log_water | nutrition_today | recent_foods | search_library | sleep_stats | tasks_today | import_body_composition | ask | brief | sleep)` }, 400)
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
