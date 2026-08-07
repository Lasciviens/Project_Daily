import { fetchHevyWorkouts, fetchHevyWorkoutDetail, fetchHevyRoutines } from '../../training/api/hevyApi'
import { fetchHealthMetricSeries } from '../../training/api/healthApi'
import { computeSleepSummary, computeDailySeries } from '../../training/healthAggregate'
import { fetchFoodLogRange } from '../../recipes/api/foodLogApi'
import { fetchAssessments } from '../../training/api/ptCoachApi'
import { fetchAthleteProfile, fetchAthleteLimitations } from '../../training/api/athleteProfileApi'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import type { HevySet } from '../../training/types.hevy'

// ─────────────────────────────────────────────────────────────────────────────
//  Coach-mode chat context: the user's last 30 days as ONE compact JSON blob,
//  prepared client-side so the model doesn't burn turns exploring the DB.
//  JSON (minified, short keys) chosen deliberately: models parse it reliably
//  and it compresses repetitive numeric series far better than prose.
//  Attached ONLY in coach mode — normal chat keeps its lean generic context.
// ─────────────────────────────────────────────────────────────────────────────

function setStr(sets: HevySet[]): string {
  const working = sets.filter(s => s.type !== 'warmup' && (s.reps != null || s.weight_kg != null))
  const groups = new Map<string, number>()
  for (const s of working) {
    const key = `${s.reps ?? '?'}@${s.weight_kg ?? 0}`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return [...groups.entries()].map(([k, n]) => `${n}x${k}`).join(',')
}

const r1 = (n: number) => Math.round(n * 10) / 10

export async function buildCoachContext(): Promise<string> {
  const today = todayStr()
  const from = shiftDateStr(today, -30)
  // deno-lint-ignore-file — plain JSON assembly
  const ctx: Record<string, unknown> = { period: `${from}..${today}` }

  // ── Who the coach is coaching: profile + active limitations (before what they did) ──
  try {
    const profile = await fetchAthleteProfile()
    if (profile) ctx.profile = { goal: profile.goal, level: profile.experience_level, days: profile.training_days_per_week, equip: profile.equipment_access, notes: profile.notes }
  } catch { /* optional (pre-migration) */ }
  try {
    const limitations = await fetchAthleteLimitations(true)
    if (limitations.length) ctx.limitations = limitations.map(l => ({ pattern: l.movement_pattern, severity: l.severity, note: l.note }))
  } catch { /* optional (pre-migration) */ }

  // ── Workouts: every session in the window, per-exercise compact sets ──
  try {
    const recent = (await fetchHevyWorkouts({ limit: 30 })).filter(
      w => (w.start_time ?? '').slice(0, 10) >= from,
    )
    ctx.workouts = await Promise.all(recent.map(async w => {
      const det = await fetchHevyWorkoutDetail(w.id)
      return {
        d: (w.start_time ?? '').slice(0, 10),
        t: w.title,
        ex: (det?.exercises ?? []).map(e => ({ n: e.title, s: setStr(e.sets ?? []) })),
      }
    }))
  } catch { ctx.workouts = 'unavailable' }

  // ── Current routines (the program itself — editable via update_hevy_routine) ──
  try {
    const routines = await fetchHevyRoutines()
    ctx.routines = routines.map(r => ({
      id: r.id,
      t:  r.title,
      ex: (r.exercises ?? []).map(e => ({
        n: e.title,
        tid: e.exercise_template_id,
        rest: e.rest_seconds ?? null,
        s: (e.sets ?? []).map(s => s.rep_range_start != null
          ? `${s.rep_range_start}-${s.rep_range_end}@${s.weight_kg ?? 0}`
          : `${s.reps ?? '?'}@${s.weight_kg ?? 0}`).join(','),
      })),
    }))
  } catch { ctx.routines = 'unavailable' }

  // ── Recovery & body: daily series, values only ──
  try {
    const sleepPts = await fetchHealthMetricSeries('sleep_analysis', from, today)
    ctx.sleep_h = computeSleepSummary(sleepPts).map(s => ({ d: s.date, h: r1(s.total), deep: r1(s.deep), rem: r1(s.rem) }))
  } catch { /* optional */ }
  try {
    const [steps, energy, weight, fat] = await Promise.all([
      fetchHealthMetricSeries('step_count', from, today),
      fetchHealthMetricSeries('active_energy', from, today),
      fetchHealthMetricSeries('weight_body_mass', from, today),
      fetchHealthMetricSeries('body_fat_percentage', from, today),
    ])
    ctx.steps       = computeDailySeries('step_count', steps).map(d => ({ d: d.date, v: Math.round(d.value) }))
    ctx.active_kcal = computeDailySeries('active_energy', energy).map(d => ({ d: d.date, v: Math.round(d.value) }))
    ctx.weight_kg   = computeDailySeries('weight_body_mass', weight).map(d => ({ d: d.date, v: r1(d.value) }))
    const fatSeries = computeDailySeries('body_fat_percentage', fat)
    if (fatSeries.length) ctx.bodyfat_pct = fatSeries.map(d => ({ d: d.date, v: r1(d.value) }))
  } catch { /* optional */ }

  // ── Nutrition: what was ACTUALLY eaten (the diary), not the plan — the coach
  //    must ground advice on real intake (food_log_entries), which is what the
  //    Today/Log-food flow fills. Macros are the at-log-time snapshot. ──
  try {
    const diary = await fetchFoodLogRange(from, today)
    ctx.nutrition = diary.map(m => ({
      d: m.date, slot: m.meal_slot, t: m.title,
      kcal: m.calories ?? null, p: m.protein_g ?? null,
    }))
  } catch { /* optional */ }

  // ── The coach's own recent assessments (continuity across surfaces) ──
  try {
    const assessments = await fetchAssessments(3)
    ctx.past_assessments = assessments.map(a => ({ d: a.date, feeling: a.feeling, text: a.assessment.slice(0, 400) }))
  } catch { /* optional (pre-migration) */ }

  return JSON.stringify(ctx)
}
