import { fetchHevyWorkouts, fetchHevyWorkoutDetail, fetchMuscleVolume } from './hevyApi'
import { fetchAthleteProfile, fetchAthleteLimitations } from './athleteProfileApi'
import { fetchHealthMetricSeries } from './healthApi'
import { computeSleepSummary, computeDailySeries } from '../healthAggregate'
import { slugForHevyGroup, MUSCLE_LANDMARKS, labelForSlug, MOVEMENT_PATTERN_LABEL } from '../muscleMap'
import { supabase } from '../../../integrations/supabase/client'
import { invokeAI, type Message } from '../../ai/api/aiApi'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import type { HevyWorkout, HevySet } from '../types.hevy'

// ─────────────────────────────────────────────────────────────────────────────
//  AI PT coach — daily assessment. Token-minimal BY CONSTRUCTION: all data is
//  gathered and pre-aggregated here (client-side algorithms, a handful of
//  indexed DB reads) into ONE compact text snapshot, then a single one-shot
//  Gemini call — no tool loop, no model-driven data exploration. Same pattern
//  as the Home daily briefing. The coaching brain below was distilled by the
//  strength-coach agent and bounded by the sports-scientist agent's evidence
//  guardrails (.claude/agents/) — the snapshot line formats here are a
//  CONTRACT with that prompt; change them together.
// ─────────────────────────────────────────────────────────────────────────────

const PT_SYSTEM_PROMPT = `You are the user's personal strength coach (hypertrophy focus, bro-split: Back/Chest/Leg/Arm/Shoulder days, 3-4x/wk). Reply in Turkish. Be decisive and honest — one clear recommendation, never menus of options. Cite the user's actual numbers in every claim ("Bench 4×8@60kg, geçen hafta 57.5kg"). Never sycophantic; praise only real progress, name real problems plainly.
TONE: an experienced human coach — calm, professional, direct. Honest about problems (skipped sessions, chronic short sleep, low volume): name them plainly, once, matter-of-factly. NO drill-sergeant theatrics, no guilt-tripping, no rhetorical ultimatums, no piling three criticisms into one paragraph. Recommendations follow the data and the science, not the user's feelings — but delivered like a professional, not a scold.
FOLLOW-UP: if a PREVIOUS ASSESSMENT section is present, note briefly whether its main recommendation was applied ("Geçen sefer X önermiştim — uygulanmış/uygulanmamış") and move on. Accountability, not punishment.

DATA SNAPSHOT (read-only, pre-aggregated; you have no tools):
- PROFİL: athlete's goal / experience level / equipment access / training days per week — only the fields the user actually set. Followed by one "Kısıtlama: <hareket> (severity) — <note>" line per active limitation. Severity reading: (avoid) = this movement pattern is off the table entirely, no exceptions; (limit) = usable only at reduced load/volume; (monitor) = no restriction, just keep it in view. Absent entirely = no profile/limitations on file yet.
- Workout lines: "Exercise: sets×reps@kg (prev: …)". "prev" = same exercise, last session it appeared. Warm-ups already excluded.
- Weekly volume: hard sets per muscle vs landmarks (e.g. "Chest: 14 set/hf [MEV 8 · MAV 20 · MRV 22]"). MEV=minimum effective, MAV=growth sweet spot, MRV=recoverable ceiling.
- Sleep "6.2h (7g ort 6.8h)", steps, active kcal, body weight trend, subjective feeling + free text.

DECISION RULES (apply in this order):
1. Safety: pain mentioned → stop-and-assess advice for that movement, suggest substitute, never "push through". No medical diagnosis; persistent pain → professional. PROFİL limitation grounding: a limitation listed in PROFİL is durable fact, not something the user has to re-mention every session — (avoid) → never recommend that movement pattern as next-session progression or as a substitute exercise; (limit) → only suggest it at reduced load/volume and say so explicitly; (monitor) → no automatic restriction, proceed normally, you may note it's on watch.
2. Recovery gate: sleep <6h OR ("çok yorgun" + sleep below 7d avg) → today is technique/maintenance: keep exercises, -20-30% load or -1 set per exercise, no PR attempts. Sleep <5h two nights running → recommend rest or light cardio day.
3. Overreach: any muscle ≥MRV, or performance regressed on 2+ lifts vs prev while feeling "çok yorgun" → deload cue: halve sets for that muscle this week, keep loads.
4. Progressive overload (default engine): if all target sets hit at same load as prev → next session +2.5kg (upper) / +5kg (lower compounds), or +1-2 reps on dumbbell/isolation work where 2.5kg is too big a jump. Reps dropped vs prev → hold load, chase reps. Same load AND reps 3 sessions running = plateau → say so, change rep range or exercise variant.
5. Volume steering: muscle below MEV → name it and prescribe the fix concretely ("hamstring 4 set/hf, MEV 6 — Leg Day'e 3 set leg curl ekle"). Between MEV-MAV = good, say which. Watch push:pull balance across the week.
6. Rest day: assess recovery, flag tomorrow's likely session, note steps/energy if notably low (<5k steps → suggest a walk).

EVIDENCE GUARDRAILS:
- Sleep: acute short sleep (<6h) reliably degrades multi-set/near-failure performance and effort accuracy; single-rep strength is more robust. Injury-risk link is chronic (repeated <6-7h), not per-night. One bad night → keep loads, trim back-off sets, skip failure (RIR 2-3); several bad nights → cut volume ~30-50% first, then intensity. Volume, not load, is the first lever.
- Volume landmarks are population midpoints, not measurements — starting brackets, adjust to the individual's recovery/progress. Diminishing returns past ~10 sets; benefit rarely proven >20.
- Progression: double progression (reps in range, then +~2.5% load). Plateau with good sleep = stimulus problem (add a set / get closer to failure); plateau with rising fatigue = recover, don't add.
- Rest: ≥2-3min compounds, ~60-90s isolation. Short rest is not superior.
- RIR 0-3 captures nearly all hypertrophy; true failure adds fatigue without clear extra growth.
- Steps/energy/weight here reflect general activity and energy balance ONLY — they cannot gauge neuromuscular readiness; short-term weight moves are mostly water. No HRV data exists.
- Prefix genuinely uncertain claims ("kanıt karışık"). Population findings ≠ individual prescription.

OUTPUT (Turkish, 200-300 words, exactly this structure, markdown bold headers):
1) **Değerlendirme** — session/day verdict with 1-2 specific numbers.
2) **Toparlanma** — sleep × energy × feeling read; one sentence of what it means for training.
3) **Bir sonraki antrenman için TEK öncelik** — one exercise-level instruction: exercise, sets, load/reps.
4) **Kapanış** — one motivating line anchored to a real trend from the data, never generic.

Missing data: state it in one line ("Uyku verisi yok") and proceed with what exists. Never invent numbers.`

// "4×8@60kg" when uniform, else per-set compact list. Working sets only.
function summarizeSets(sets: HevySet[]): string {
  const working = sets.filter(s => s.type !== 'warmup' && (s.reps != null || s.weight_kg != null))
  if (working.length === 0) return '—'
  const groups = new Map<string, number>()
  for (const s of working) {
    const key = `${s.reps ?? '?'}@${s.weight_kg ?? 0}kg`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return [...groups.entries()].map(([key, n]) => `${n}×${key}`).join(', ')
}

function workoutLines(w: HevyWorkout, prevByExercise: Map<string, string>): string[] {
  return (w.exercises ?? []).map(ex => {
    const cur = summarizeSets(ex.sets ?? [])
    const prev = prevByExercise.get(ex.title)
    return `  ${ex.title}: ${cur}${prev ? ` (önceki: ${prev})` : ''}`
  })
}

export async function buildTrainingSnapshot(): Promise<string> {
  const today = todayStr()
  const lines: string[] = []

  // ── Athlete profile + active limitations — who the coach is coaching,
  // read before any numbers. Durable facts set once (Settings), so the user
  // never has to re-type an old injury every session; grounds rule 1 of the
  // prompt's DECISION RULES.
  try {
    const [profile, limitations] = await Promise.all([
      fetchAthleteProfile(),
      fetchAthleteLimitations(true),
    ])
    const parts: string[] = []
    if (profile?.goal) parts.push(`Hedef ${profile.goal}`)
    if (profile?.experience_level) parts.push(`Seviye ${profile.experience_level}`)
    if (profile?.equipment_access) parts.push(`Ekipman ${profile.equipment_access}`)
    if (profile?.training_days_per_week) parts.push(`Haftada ${profile.training_days_per_week} gün`)
    if (parts.length > 0) lines.push(`PROFİL: ${parts.join(' · ')}`)
    for (const lim of limitations) {
      lines.push(`  Kısıtlama: ${MOVEMENT_PATTERN_LABEL[lim.movement_pattern]} (${lim.severity})${lim.note ? ` — ${lim.note}` : ''}`)
    }
  } catch { /* profile/limitations optional — table may not exist pre-migration */ }

  // ── Workouts: latest session in full + prev-session comparison per exercise ──
  const recent = await fetchHevyWorkouts({ limit: 12 })
  if (recent.length === 0) {
    lines.push('ANTRENMAN: Hiç kayıtlı antrenman yok.')
  } else {
    const latest = await fetchHevyWorkoutDetail(recent[0].id)
    // Look back through older sessions for each exercise's previous numbers.
    const prevByExercise = new Map<string, string>()
    // Look back far enough to reach the previous same-type day (a bro-split
    // repeats a given day roughly every 5-6 sessions).
    for (const older of recent.slice(1, 11)) {
      const needed = (latest?.exercises ?? []).some(ex => !prevByExercise.has(ex.title))
      if (!needed) break
      const det = await fetchHevyWorkoutDetail(older.id)
      for (const ex of det?.exercises ?? []) {
        if (!prevByExercise.has(ex.title)) prevByExercise.set(ex.title, summarizeSets(ex.sets ?? []))
      }
    }
    if (latest) {
      const d = latest.start_time ? latest.start_time.slice(0, 10) : '?'
      const isToday = d === today
      lines.push(`SON ANTRENMAN (${isToday ? 'BUGÜN' : d}): ${latest.title ?? 'Workout'}`)
      lines.push(...workoutLines(latest, prevByExercise))
    }
    const weekAgo = shiftDateStr(today, -7)
    const thisWeek = recent.filter(w => (w.start_time ?? '').slice(0, 10) >= weekAgo)
    lines.push(`Son 7 günde ${thisWeek.length} antrenman. Son antrenman günleri: ${recent.slice(0, 4).map(w => (w.start_time ?? '').slice(0, 10)).join(', ')}`)
  }

  // ── Weekly hard-set volume per muscle vs landmarks (primary muscle only) ──
  try {
    const nowIso = new Date().toISOString()
    const weekAgoIso = new Date(Date.now() - 7 * 86400_000).toISOString()
    const vol = await fetchMuscleVolume(weekAgoIso, nowIso)
    if (vol.length > 0) {
      const templateIds = [...new Set(vol.map(v => v.templateId))]
      const { data: templates } = await supabase
        .from('hevy_exercise_templates')
        .select('id, primary_muscle_group')
        .in('id', templateIds)
      const slugByTemplate = new Map((templates ?? []).map(t => [t.id, slugForHevyGroup(t.primary_muscle_group)]))
      const perSlug = new Map<string, number>()
      for (const v of vol) {
        const slug = slugByTemplate.get(v.templateId)
        if (!slug) continue
        perSlug.set(slug, (perSlug.get(slug) ?? 0) + v.workingSets)
      }
      lines.push('HAFTALIK HACİM (sert set/hafta, birincil kas):')
      for (const [slug, sets] of [...perSlug.entries()].sort((a, b) => b[1] - a[1])) {
        const lm = MUSCLE_LANDMARKS[slug]
        lines.push(`  ${labelForSlug(slug)}: ${sets} set/hf${lm ? ` [MEV ${lm.mev} · MAV ${lm.mav} · MRV ${lm.mrv}]` : ''}`)
      }
    }
  } catch { lines.push('Haftalık hacim verisi alınamadı.') }

  // ── Sleep, steps, energy, weight — the recovery picture ──
  try {
    const sleepPts = await fetchHealthMetricSeries('sleep_analysis', shiftDateStr(today, -8), today)
    const summary = computeSleepSummary(sleepPts)
    const last = summary[summary.length - 1]
    if (last) {
      const avg = summary.reduce((s, x) => s + x.total, 0) / summary.length
      lines.push(`UYKU: son gece ${last.total.toFixed(1)}h (7g ort ${avg.toFixed(1)}h)${last.date !== today ? ` — son veri ${last.date}` : ''}`)
    } else lines.push('UYKU: veri yok.')
  } catch { lines.push('UYKU: veri alınamadı.') }

  try {
    const [stepPts, energyPts] = await Promise.all([
      fetchHealthMetricSeries('step_count', shiftDateStr(today, -1), today),
      fetchHealthMetricSeries('active_energy', shiftDateStr(today, -1), today),
    ])
    const steps = computeDailySeries('step_count', stepPts)
    const energy = computeDailySeries('active_energy', energyPts)
    const fmt = (arr: { date: string; value: number }[], unit: string) =>
      arr.map(d => `${d.date === today ? 'bugün' : 'dün'} ${Math.round(d.value)}${unit}`).join(', ') || 'veri yok'
    lines.push(`ADIM: ${fmt(steps, '')} · AKTİF ENERJİ: ${fmt(energy, ' kcal')}`)
  } catch { /* activity data optional */ }

  try {
    const weightPts = await fetchHealthMetricSeries('weight_body_mass', shiftDateStr(today, -30), today)
    const daily = computeDailySeries('weight_body_mass', weightPts)
    if (daily.length >= 2) {
      const first = daily[0], lastW = daily[daily.length - 1]
      lines.push(`KİLO: ${lastW.value.toFixed(1)}kg (${first.date}'den beri ${(lastW.value - first.value) >= 0 ? '+' : ''}${(lastW.value - first.value).toFixed(1)}kg)`)
    } else if (daily.length === 1) {
      lines.push(`KİLO: ${daily[0].value.toFixed(1)}kg`)
    }
  } catch { /* weight optional */ }

  return lines.join('\n')
}

export interface PTAssessmentInput {
  feeling:  string        // "az çalıştım" | "normal" | "yorgunum" | "çok yorgunum"
  note?:    string        // free text
}

export interface PTAssessmentRow {
  id:         string
  date:       string
  feeling:    string
  note:       string | null
  assessment: string
  model:      string | null
  created_at: string
}

// Assessment history — the coach's own log. Newest first.
export async function fetchAssessments(limit = 14): Promise<PTAssessmentRow[]> {
  const { data, error } = await supabase
    .from('pt_assessments')
    .select('id, date, feeling, note, assessment, model, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export interface PTAssessmentResult { text: string; model: string | null }

export async function generatePTAssessment(input: PTAssessmentInput): Promise<PTAssessmentResult> {
  const snapshot = await buildTrainingSnapshot()

  // The coach's continuity: hand it its own last assessment so it can follow
  // up on whether the advice was applied (prompt's FOLLOW-UP rule).
  let prevSection = ''
  try {
    const [prev] = await fetchAssessments(1)
    if (prev) prevSection = `\n\nPREVIOUS ASSESSMENT (${prev.date}, his: ${prev.feeling}):\n${prev.assessment}`
  } catch { /* history is optional (table may not exist pre-migration) */ }

  const messages: Message[] = [{
    role: 'user',
    content: `Bugünkü değerlendirmeni yap. Nasıl hissediyorum: ${input.feeling}${input.note ? ` — "${input.note}"` : ''}`,
  }]
  const res = await invokeAI(messages, `${PT_SYSTEM_PROMPT}\n\n---\nVERİ ÖZETİ (${todayStr()}):\n${snapshot}${prevSection}`)

  // Persist the log — best-effort (an insert failure must not eat the reply).
  try {
    const user = (await supabase.auth.getUser()).data.user
    if (user) {
      await supabase.from('pt_assessments').insert({
        user_id:    user.id,
        date:       todayStr(),
        feeling:    input.feeling,
        note:       input.note ?? null,
        snapshot,
        assessment: res.text,
        model:      res.model ?? null,
      })
    }
  } catch { /* logged assessment is a bonus, not a gate */ }

  return { text: res.text, model: res.model ?? null }
}
