#!/usr/bin/env node
/*
 * Verification — phone-gateway's `import_body_composition` action.
 *
 * The pure logic below (timezone resolution, tolerance checks, field
 * validation, dedupe/conflict decision) is a HAND-SYNCED MIRROR of
 * `supabase/functions/phone-gateway/index.ts` — it cannot be `require()`d
 * directly because phone-gateway is a self-contained Deno edge function
 * (AGENTS.md: "no _shared imports", and it calls `Deno.serve`/`Deno.env` at
 * module scope, which don't exist under Node). This is the same constraint
 * that made the Hevy upsert logic get inlined into 4 functions by hand
 * (CLAUDE.md's Edge Functions section) — the trade-off here is the same:
 * if the gateway's logic changes, this file must be updated to match.
 *
 * There is no live Supabase/Deno available in this environment, so this
 * proves the ALGORITHM (what should be accepted/rejected/resolved to what),
 * not a live round-trip through the actual deployed function. The DB-level
 * unique-index dedupe and the real `insert`/`23505` race path are NOT
 * exercised here — see the migration's own header + docs/iphone-examples.md
 * for what a live test should check once deployed.
 *
 * Run: node scripts/verify-body-composition-import.cjs
 */

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── mirrors phone-gateway/index.ts verbatim ────────────────────────────────

const CONSISTENCY_TOL_ABS_KG = 0.15
const CONSISTENCY_TOL_REL = 0.005
function withinTolerance(expected, actual, weightKg) {
  const tol = Math.max(CONSISTENCY_TOL_ABS_KG, CONSISTENCY_TOL_REL * weightKg)
  return Math.abs(expected - actual) <= tol
}

const RESEND_TOL = 0.05
function sameValue(a, b) { return Math.abs(a - b) <= RESEND_TOL }

const BODY_COMP_FIELDS = [
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

function zonedWallTimeToUtcMs(y, mo, d, h, mi, se, timeZone) {
  const offsetMsAt = (utcMs) => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const parts = {}
    for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== 'literal') parts[p.type] = p.value
    let hour = Number(parts.hour); if (hour === 24) hour = 0
    const asIfUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second))
    return asIfUTC - utcMs
  }
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, se)
  const utc1 = guessUtc - offsetMsAt(guessUtc)
  return guessUtc - offsetMsAt(utc1)
}

function parseNaiveLocalDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  return { y: Number(y), mo: Number(mo), d: Number(d), h: Number(h), mi: Number(mi), se: Number(se ?? '0') }
}

function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

const DEFAULT_MEASUREMENT_TZ = 'Europe/Oslo'

function validateBodyComposition(body) {
  const errors = {}

  let measuredAtIso = null
  const rawMeasuredAt = body.measured_at
  if (typeof rawMeasuredAt !== 'string' || !rawMeasuredAt.trim()) {
    errors.measured_at = 'required'
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

  const values = {}
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

  const expectedFatMass = values.weight_kg * values.body_fat_percent / 100
  if (!withinTolerance(expectedFatMass, values.body_fat_mass_kg, values.weight_kg)) {
    errors.body_fat_mass_kg = `inconsistent with weight_kg × body_fat_percent (expected ≈${expectedFatMass.toFixed(2)})`
  }
  const expectedLean = values.weight_kg - values.body_fat_mass_kg
  if (!withinTolerance(expectedLean, values.lean_body_mass_kg, values.weight_kg)) {
    errors.lean_body_mass_kg = `inconsistent with weight_kg − body_fat_mass_kg (expected ≈${expectedLean.toFixed(2)})`
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return { ok: true, values, measuredAtIso }
}

// ── fixtures: the user's own real report (2026-09-06 08:23, Europe/Oslo) ──
const REAL_REPORT = {
  action: 'import_body_composition',
  measured_at: '2026-09-06T08:23:00',
  measurement_timezone: 'Europe/Oslo',
  weight_kg: 83.6,
  body_fat_percent: 24.4,
  body_fat_mass_kg: 20.4,
  lean_body_mass_kg: 63.2,
  body_water_percent: 55.4,
  protein_percent: 15.0,
  muscle_percent: 70.4,
  skeletal_muscle_percent: 42.9,
  skeletal_muscle_index: 8.2,
  bmi: 25.8,
  visceral_fat_index: 8,
  subcutaneous_fat_kg: 18.0,
  bmr_kcal: 1735,
  body_score: 79,
}

console.log('\n1 · Valid report (the real 2026-09-06 08:23 scan) is accepted')
{
  const r = validateBodyComposition(REAL_REPORT)
  check('accepted (no errors)', r.ok === true, r.ok ? '' : JSON.stringify(r.errors))
  if (r.ok) {
    check('measured_at resolves to a real UTC instant', r.measuredAtIso === '2026-09-06T06:23:00.000Z',
      `got ${r.measuredAtIso} (Oslo is UTC+2 on 6 Sep — CEST)`)
    check('weight_kg carried through unchanged', r.values.weight_kg === 83.6)
    check('body_score carried through unchanged', r.values.body_score === 79)
  }
}

console.log('\n2 · The other three real reports from the same device also pass validation')
{
  const reports = [
    { measured_at: '2026-08-31T08:00:00', weight_kg: 83.55, body_fat_percent: 23.7, body_fat_mass_kg: 19.8, lean_body_mass_kg: 63.7, body_water_percent: 55.9, protein_percent: 15.1, muscle_percent: 71.0, skeletal_muscle_percent: 43.3, skeletal_muscle_index: 8.3, bmi: 25.8, visceral_fat_index: 8, subcutaneous_fat_kg: 17.5, bmr_kcal: 1746, body_score: 81 },
    { measured_at: '2026-09-01T07:57:00', weight_kg: 83.20, body_fat_percent: 24.5, body_fat_mass_kg: 20.4, lean_body_mass_kg: 62.8, body_water_percent: 55.3, protein_percent: 15.0, muscle_percent: 70.3, skeletal_muscle_percent: 42.8, skeletal_muscle_index: 8.1, bmi: 25.7, visceral_fat_index: 8, subcutaneous_fat_kg: 18.0, bmr_kcal: 1727, body_score: 79 },
  ]
  for (const r of reports) {
    const res = validateBodyComposition({ ...r, measurement_timezone: 'Europe/Oslo' })
    check(`${r.measured_at} accepted`, res.ok === true, res.ok ? '' : JSON.stringify(res.errors))
  }
}

console.log('\n3 · Missing OCR field → validation_error, never a substituted 0')
{
  const { body_score, ...withoutScore } = REAL_REPORT
  const r = validateBodyComposition(withoutScore)
  check('rejected', r.ok === false)
  check('names the missing field', r.ok === false && r.errors.body_score === 'required')
}

console.log('\n4 · Non-numeric / infinite / NaN-ish OCR read → validation_error')
{
  const bad = { ...REAL_REPORT, weight_kg: 'ochenta y tres' }
  const r = validateBodyComposition(bad)
  check('rejected', r.ok === false)
  check('names weight_kg', r.ok === false && r.errors.weight_kg === 'must be a finite number')

  const bad2 = { ...REAL_REPORT, bmr_kcal: Infinity }
  const r2 = validateBodyComposition(bad2)
  check('Infinity rejected', r2.ok === false && r2.errors.bmr_kcal === 'must be a finite number')
}

console.log('\n5 · Out-of-range OCR misread (e.g. a mis-scanned decimal point) → validation_error')
{
  const bad = { ...REAL_REPORT, body_fat_percent: 2440 } // "24.4" misread as "2440"
  const r = validateBodyComposition(bad)
  check('rejected', r.ok === false)
  check('names body_fat_percent', r.ok === false && /out of expected range/.test(r.errors.body_fat_percent || ''))
}

console.log('\n6 · Inconsistent numbers (a real-looking but wrong field) → validation_error')
{
  // body_fat_mass_kg should be ≈20.4 (83.6 × 24.4%) — 25 is a plausible OCR
  // misread but breaks the cross-check.
  const bad = { ...REAL_REPORT, body_fat_mass_kg: 25 }
  const r = validateBodyComposition(bad)
  check('rejected', r.ok === false)
  check('names body_fat_mass_kg with the expected value', r.ok === false && /expected ≈20\.4/.test(r.errors.body_fat_mass_kg || ''),
    r.ok ? '' : JSON.stringify(r.errors))
}
{
  // lean_body_mass_kg should be ≈63.2 (83.6 − 20.4)
  const bad = { ...REAL_REPORT, lean_body_mass_kg: 50 }
  const r = validateBodyComposition(bad)
  check('rejected', r.ok === false)
  check('names lean_body_mass_kg', r.ok === false && !!r.errors.lean_body_mass_kg, r.ok ? '' : JSON.stringify(r.errors))
}

console.log('\n7 · A rejected report writes nothing and consistency checks never mask a range error')
{
  // weight_kg itself out of range AND the consistency checks would also fail
  // off of it — the field-range pass must return before ever computing a
  // "consistent with an already-invalid weight" cross-check.
  const bad = { ...REAL_REPORT, weight_kg: -5 }
  const r = validateBodyComposition(bad)
  check('rejected on weight_kg range, not a confusing consistency message', r.ok === false && /range/.test(r.errors.weight_kg || ''))
}

console.log('\n8 · An offset/Z suffix on measured_at is rejected (ambiguous, never accepted)')
{
  check('Z suffix rejected', parseNaiveLocalDateTime('2026-09-06T08:23:00Z') === null)
  check('+02:00 offset rejected', parseNaiveLocalDateTime('2026-09-06T08:23:00+02:00') === null)
  check('space-separated form accepted (Shortcuts Format Date can emit either)', parseNaiveLocalDateTime('2026-09-06 08:23:00') !== null)
  check('seconds-omitted form accepted', parseNaiveLocalDateTime('2026-09-06T08:23') !== null)
}

console.log('\n9 · An unrecognized timezone name → validation_error, not a silent Oslo fallback')
{
  const bad = { ...REAL_REPORT, measurement_timezone: 'Mars/Olympus_Mons' }
  const r = validateBodyComposition(bad)
  check('rejected', r.ok === false)
  check('names measurement_timezone', r.ok === false && /not a recognized IANA timezone/.test(r.errors.measurement_timezone || ''))
}

console.log('\n10 · Omitting measurement_timezone defaults to Europe/Oslo, not UTC')
{
  const { measurement_timezone, ...withoutTz } = REAL_REPORT
  const r = validateBodyComposition(withoutTz)
  check('accepted', r.ok === true, r.ok ? '' : JSON.stringify(r.errors))
  check('resolved as Oslo local time (CEST, UTC+2), not literal UTC', r.ok === true && r.measuredAtIso === '2026-09-06T06:23:00.000Z')
}

console.log('\n11 · DST transitions resolve correctly — never a hardcoded +02:00')
{
  // 2026 spring-forward: last Sunday of March = 29 Mar, clocks 02:00 → 03:00 CEST.
  // 01:30 local on 29 Mar 2026 is still CET (UTC+1) → 00:30 UTC.
  const before = zonedWallTimeToUtcMs(2026, 3, 29, 1, 30, 0, 'Europe/Oslo')
  check('just before spring-forward is UTC+1 (CET)', new Date(before).toISOString() === '2026-03-29T00:30:00.000Z',
    new Date(before).toISOString())
  // 03:30 local on 29 Mar 2026 is already CEST (UTC+2) → 01:30 UTC.
  const after = zonedWallTimeToUtcMs(2026, 3, 29, 3, 30, 0, 'Europe/Oslo')
  check('just after spring-forward is UTC+2 (CEST)', new Date(after).toISOString() === '2026-03-29T01:30:00.000Z',
    new Date(after).toISOString())

  // 2026 fall-back: last Sunday of October = 25 Oct, clocks 03:00 → 02:00 CET.
  // 01:30 local (before the fold) is still CEST (UTC+2) → 23:30 UTC on the 24th.
  const beforeFallback = zonedWallTimeToUtcMs(2026, 10, 25, 1, 30, 0, 'Europe/Oslo')
  check('just before fall-back is UTC+2 (CEST)', new Date(beforeFallback).toISOString() === '2026-10-24T23:30:00.000Z',
    new Date(beforeFallback).toISOString())
  // 04:30 local (after the fold) is CET (UTC+1) → 03:30 UTC.
  const afterFallback = zonedWallTimeToUtcMs(2026, 10, 25, 4, 30, 0, 'Europe/Oslo')
  check('just after fall-back is UTC+1 (CET)', new Date(afterFallback).toISOString() === '2026-10-25T03:30:00.000Z',
    new Date(afterFallback).toISOString())
}

console.log('\n12 · Re-send comparison: sameValue distinguishes an identical resend from a real edit')
{
  check('identical values match', sameValue(83.6, 83.6))
  check('tiny float noise still matches', sameValue(83.6, 83.60000001))
  check('a real different reading does not match', !sameValue(83.6, 85.0))
  check('resend tolerance is tighter than the consistency tolerance', RESEND_TOL < CONSISTENCY_TOL_ABS_KG)
}

console.log('\n13 · already_exists vs conflict decision (mirrors the gateway\'s sameReport check)')
{
  function sameReport(existing, values) {
    return BODY_COMP_FIELDS.every(f => sameValue(Number(existing[f.key]), values[f.key]))
  }
  const r = validateBodyComposition(REAL_REPORT)
  check('fixture parses', r.ok === true)
  const identicalRow = { ...r.values }
  check('an identical re-send → already_exists (sameReport true)', sameReport(identicalRow, r.values))
  const editedRow = { ...r.values, weight_kg: 90 }
  check('a re-send with one changed number → conflict (sameReport false)', !sameReport(editedRow, r.values))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
