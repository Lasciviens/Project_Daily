import { actionLabel, formatSetTargets, formatSessionSets, progressVerdictHeadline, workloadLabel, type ExerciseProgressResult } from '../progress-engine'
import { MOVEMENT_PATTERN_LABEL, labelForSlug, movementPatternLabel, resolveMovementPattern, type Landmarks } from '../muscleMap'
import type { ProgressData } from '../progressModel'
import type { AthleteLimitation, AthleteProfile } from '../types.athlete'
import type { HevyRoutine } from '../types.hevy'

// ─────────────────────────────────────────────────────────────────────────────
//  The ONE AI-coach context, rendered two ways from the same CoachData:
//    formatPtSnapshot → the PT Coach tab's one-shot Turkish text snapshot
//    buildCoachJson   → Ask-AI Coach mode's compact JSON
//  Both carry the current program, the progress engine's per-exercise
//  decisions (the very results the Progress tab shows) and the athlete's
//  limitations, so neither coach can contradict Progress any more (the PT
//  prompt used to assume a hard-coded bro-split). Pure: no React, no I/O
//  (scripts/verify-coach-context.cjs).
//
//  CONTRACT: the snapshot line formats below and PT_SYSTEM_PROMPT's DATA
//  SNAPSHOT section describe each other — change them together.
// ─────────────────────────────────────────────────────────────────────────────

export interface CoachSetLine { title: string; sets: string }
export interface CoachSession { workoutId: string; date: string; title: string | null; routineId: string | null; exercises: CoachSetLine[] }
export interface CoachMuscleDose { slug: string; sets: number; landmarks: Landmarks | null; restriction: 'avoid' | 'limit' | null }
export interface CoachDay { date: string; value: number }
export interface CoachSleepNight { date: string; total: number; deep: number; rem: number }
export interface CoachWeight { date: string; kg: number; fatPct: number | null }

export interface CoachData {
  today: string
  profile: AthleteProfile | null
  /** Active limitations only. */
  limitations: AthleteLimitation[]
  progress: ProgressData
  /** Every routine (Coach mode edits them by id). */
  routines: HevyRoutine[]
  /** Newest first, performed inside the history window. */
  sessions: CoachSession[]
  sessionsThisWeek: number
  /** Hard working sets per muscle over the last 7 days (primary 1, secondary 0.5). */
  weeklyMuscleSets: CoachMuscleDose[]
  sleep: CoachSleepNight[]
  steps: CoachDay[]
  activeKcal: CoachDay[]
  bodyweight: CoachWeight[]
}

const r1 = (n: number) => Math.round(n * 10) / 10
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`

/** "Heavy hip hinge [= Hinge (deadlift pattern)]" — the stored text, plus the
 *  standard pattern the app reads it as when that isn't the same thing. */
export function limitationName(raw: string): string {
  const label = movementPatternLabel(raw)
  if (raw in MOVEMENT_PATTERN_LABEL) return label
  const p = resolveMovementPattern(raw)
  return p ? `${label} [= ${MOVEMENT_PATTERN_LABEL[p]}]` : label
}

/** The engine's next-session target as one line. A load increase with no
 *  known step (loadKg null) keeps the OLD load on its set targets, so the
 *  headline ("use the smallest step your equipment allows…") is the honest
 *  text there; everywhere else the set-by-set plan is. */
export function nextTargetText(r: ExerciseProgressResult): string | null {
  const next = r.nextTargets?.nextSession
  if (!next) return null
  if (!next.setTargets || (r.currentAction === 'READY_TO_INCREASE' && next.loadKg == null)) return next.headline
  return formatSetTargets(next.setTargets, r.metricKind)
}

/** The current-program routines that still exist, by title. */
function programTitles(d: CoachData): string[] {
  return d.progress.activeRoutines.map(r => r.title)
}

// ── PT Coach: Turkish text snapshot ─────────────────────────────────────────

export function formatPtSnapshot(d: CoachData): string {
  const lines: string[] = []
  const { profile, progress } = d

  const parts: string[] = []
  if (profile?.goal) parts.push(`Hedef ${profile.goal}`)
  if (profile?.experience_level) parts.push(`Seviye ${profile.experience_level}`)
  if (profile?.equipment_access) parts.push(`Ekipman ${profile.equipment_access}`)
  if (profile?.training_days_per_week) parts.push(`Haftada ${profile.training_days_per_week} gün`)
  if (parts.length > 0) lines.push(`PROFİL: ${parts.join(' · ')}`)
  for (const lim of d.limitations) {
    lines.push(`  Kısıtlama: ${limitationName(lim.movement_pattern)} (${lim.severity})${lim.note ? ` — ${lim.note}` : ''}`)
  }

  // ── The program and the app's own progress decisions ──
  const target = profile?.training_days_per_week ? ` (hedef ${profile.training_days_per_week})` : ''
  if (progress.needsCurrentProgram) {
    lines.push(`PROGRAM: ${progress.staleProgram ? 'kayıtlı rutinler artık Hevy\'de yok' : 'seçilmemiş'} — ilerleme kararı yok. Bu hafta ${d.sessionsThisWeek} antrenman${target}.`)
  } else {
    lines.push(`PROGRAM: ${programTitles(d).join(', ')} · bu hafta ${d.sessionsThisWeek} antrenman${target}`)
    if (progress.program) {
      lines.push(`İLERLEME: ${progressVerdictHeadline(progress.program.progressVerdict)} — ${progress.program.improvingCount}/${progress.program.analyzableCount} hareket gelişiyor · iş yükü: ${workloadLabel(progress.program.workload)}${progress.program.corroboratingSignal ? ` (${progress.program.corroboratingSignal})` : ''}`)
    }
    for (const r of progress.decisions) {
      const title = progress.titleById.get(r.exerciseTemplateId) ?? r.exerciseTemplateId
      const latest = r.currentState.latest ? formatSessionSets(r.currentState.latest.sets, r.metricKind) : '—'
      const next = nextTargetText(r)
      const nextText = next ? ` · sonraki: ${next}` : ''
      lines.push(`  Karar: ${title}: ${r.currentAction} "${actionLabel(r.currentAction)}" · son: ${latest}${nextText} · kanıt ${r.evidence.progress}`)
    }
  }

  // ── Latest session in full + the previous numbers per exercise ──
  const latest = d.sessions[0]
  if (!latest) {
    lines.push('ANTRENMAN: Hiç kayıtlı antrenman yok.')
  } else {
    const prevByTitle = new Map<string, string>()
    for (const s of d.sessions.slice(1)) for (const ex of s.exercises) if (!prevByTitle.has(ex.title)) prevByTitle.set(ex.title, ex.sets)
    lines.push(`SON ANTRENMAN (${latest.date === d.today ? 'BUGÜN' : latest.date}): ${latest.title ?? 'Workout'}`)
    for (const ex of latest.exercises) {
      const prev = prevByTitle.get(ex.title)
      lines.push(`  ${ex.title}: ${ex.sets}${prev ? ` (önceki: ${prev})` : ''}`)
    }
    lines.push(`Son antrenman günleri: ${d.sessions.slice(0, 4).map(s => s.date).join(', ')}`)
  }

  // ── Weekly hard-set volume per muscle vs landmarks ──
  if (d.weeklyMuscleSets.length > 0) {
    lines.push('HAFTALIK HACİM (son 7 gün, sert set; birincil 1 + ikincil 0.5):')
    for (const m of d.weeklyMuscleSets) {
      const L = m.landmarks
      lines.push(`  ${labelForSlug(m.slug)}: ${r1(m.sets)} set/hf${L ? ` [MEV ${L.mev} · MAV ${L.mav} · MRV ${L.mrv}]` : ''}${m.restriction ? ` (kısıtlı: ${m.restriction})` : ''}`)
    }
  }

  // ── Recovery: sleep, steps, energy, weight ──
  const nights = d.sleep.filter(n => n.date >= shiftIso(d.today, -8))
  const last = nights[nights.length - 1]
  if (last) {
    const avg = nights.reduce((s, x) => s + x.total, 0) / nights.length
    lines.push(`UYKU: son gece ${last.total.toFixed(1)}h (7g ort ${avg.toFixed(1)}h)${last.date !== d.today ? ` — son veri ${last.date}` : ''}`)
  } else lines.push('UYKU: veri yok.')

  const yesterday = shiftIso(d.today, -1)
  const fmt = (arr: CoachDay[], unit: string) =>
    arr.filter(x => x.date >= yesterday).map(x => `${x.date === d.today ? 'bugün' : 'dün'} ${Math.round(x.value)}${unit}`).join(', ') || 'veri yok'
  lines.push(`ADIM: ${fmt(d.steps, '')} · AKTİF ENERJİ: ${fmt(d.activeKcal, ' kcal')}`)

  const weights = d.bodyweight.filter(w => w.date >= shiftIso(d.today, -30))
  if (weights.length >= 2) {
    const first = weights[0], lastW = weights[weights.length - 1]
    lines.push(`KİLO: ${lastW.kg.toFixed(1)}kg (${first.date}'den beri ${signed(lastW.kg - first.kg)}kg)`)
  } else if (weights.length === 1) {
    lines.push(`KİLO: ${weights[0].kg.toFixed(1)}kg`)
  }

  return lines.join('\n')
}

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Coach mode: compact JSON ────────────────────────────────────────────────

export function buildCoachJson(d: CoachData, windowDays: number): Record<string, unknown> {
  const from = shiftIso(d.today, -windowDays)
  const { profile, progress } = d
  const ctx: Record<string, unknown> = {
    period: `${from}..${d.today}`,
    about: 'program + progress are the app\'s own Progress-tab results (same engine): keep advice consistent with them; if you disagree, say why with numbers.',
  }
  if (profile) ctx.profile = { goal: profile.goal, level: profile.experience_level, days: profile.training_days_per_week, equip: profile.equipment_access, notes: profile.notes }
  if (d.limitations.length) {
    ctx.limitations = d.limitations.map(l => ({ pattern: limitationName(l.movement_pattern), severity: l.severity, note: l.note }))
  }

  ctx.program = progress.needsCurrentProgram
    ? { selected: false, stale: progress.staleProgram, sessions_this_week: d.sessionsThisWeek, target_days: profile?.training_days_per_week ?? null }
    : {
        selected: true,
        routines: progress.activeRoutines.map(r => ({ id: r.id, t: r.title })),
        sessions_this_week: d.sessionsThisWeek,
        target_days: profile?.training_days_per_week ?? null,
        verdict: progress.program?.progressVerdict ?? null,
        workload: progress.program?.workload ?? null,
      }
  if (!progress.needsCurrentProgram) {
    ctx.progress = progress.decisions.map(r => ({
      n: progress.titleById.get(r.exerciseTemplateId) ?? r.exerciseTemplateId,
      tid: r.exerciseTemplateId,
      action: r.currentAction,
      last: r.currentState.latest ? formatSessionSets(r.currentState.latest.sets, r.metricKind) : null,
      next: nextTargetText(r),
      target: r.expectation.repMin != null ? `${r.expectation.repMin}-${r.expectation.repMax}` : null,
      evidence: r.evidence.progress,
    }))
  }

  ctx.workouts = d.sessions.filter(s => s.date >= from).map(s => ({ d: s.date, t: s.title, ex: s.exercises.map(e => ({ n: e.title, s: e.sets })) }))
  ctx.routines = d.routines.map(r => ({
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
  if (d.weeklyMuscleSets.length) {
    ctx.weekly_sets = d.weeklyMuscleSets.map(m => ({ m: m.slug, s: r1(m.sets), mev: m.landmarks?.mev ?? null, mav: m.landmarks?.mav ?? null, mrv: m.landmarks?.mrv ?? null, ...(m.restriction ? { restricted: m.restriction } : {}) }))
  }

  const inWindow = <T extends { date: string }>(xs: T[]) => xs.filter(x => x.date >= from)
  ctx.sleep_h = inWindow(d.sleep).map(s => ({ d: s.date, h: r1(s.total), deep: r1(s.deep), rem: r1(s.rem) }))
  ctx.steps = inWindow(d.steps).map(x => ({ d: x.date, v: Math.round(x.value) }))
  ctx.active_kcal = inWindow(d.activeKcal).map(x => ({ d: x.date, v: Math.round(x.value) }))
  const weights = inWindow(d.bodyweight)
  ctx.weight_kg = weights.map(w => ({ d: w.date, v: r1(w.kg) }))
  const fat = weights.filter(w => w.fatPct != null)
  if (fat.length) ctx.bodyfat_pct = fat.map(w => ({ d: w.date, v: r1(w.fatPct as number) }))
  return ctx
}

// ── PT Coach system prompt (the other half of the snapshot contract) ────────
// The coaching brain was distilled by the strength-coach agent and bounded by
// the sports-scientist agent's evidence guardrails (.claude/agents/).

export const PT_SYSTEM_PROMPT = `You are the user's personal strength coach (hypertrophy focus). Reply in Turkish. Be decisive and honest — one clear recommendation, never menus of options. Cite the user's actual numbers in every claim ("Bench 4×8@60kg, geçen hafta 57.5kg"). Never sycophantic; praise only real progress, name real problems plainly.
TONE: an experienced human coach — calm, professional, direct. Honest about problems (skipped sessions, chronic short sleep, low volume): name them plainly, once, matter-of-factly. NO drill-sergeant theatrics, no guilt-tripping, no rhetorical ultimatums, no piling three criticisms into one paragraph. Recommendations follow the data and the science, not the user's feelings — but delivered like a professional, not a scold.
FOLLOW-UP: if a PREVIOUS ASSESSMENT section is present, note briefly whether its main recommendation was applied ("Geçen sefer X önermiştim — uygulanmış/uygulanmamış") and move on. Accountability, not punishment.

DATA SNAPSHOT (read-only, pre-aggregated; you have no tools):
- PROFİL: athlete's goal / experience level / equipment access / training days per week — only the fields the user actually set. Followed by one "Kısıtlama: <hareket> (severity) — <note>" line per active limitation; "[= X]" names the standard movement pattern a free-text limitation is read as. Severity reading: (avoid) = this movement pattern is off the table entirely, no exceptions; (limit) = usable only at reduced load/volume; (monitor) = no restriction, just keep it in view. Absent entirely = no profile/limitations on file yet.
- PROGRAM: the routines the user marked as their CURRENT program (their real split — never assume another one) and sessions logged this calendar week (Monday → today) vs their target. "seçilmemiş" = no program picked yet: then there are no progress decisions; mention once that choosing the current program (Training → Coach → Profile) unlocks per-exercise advice.
- İLERLEME + "Karar:" lines: the app's own progress engine — the SAME per-exercise decisions the Progress tab shows. Format "Karar: Exercise: ACTION "Action title" · son: <latest sets> · sonraki: <next-session target> · kanıt <limited|moderate|strong>". ACTION values: READY_TO_INCREASE (add load as in "sonraki"), BUILD_AT_CURRENT_LOAD / HOLD_STEADY (same load, chase reps toward the target), CONFIRM_BEFORE_INCREASING / CONFIRM_AT_CURRENT_LOAD (repeat once to confirm), WATCH_FOR_PLATEAU / WATCH_FOR_REGRESSION (flag it), REVIEW_LOAD_REDUCTION (load went down — ask whether deliberate), LOG_COMPARABLE_SESSION (last session not comparable), INSUFFICIENT_DATA (too few sessions).
- Workout lines: "Exercise: sets×reps@kg (önceki: …)". "önceki" = same exercise, the last session it appeared. Warm-ups already excluded.
- Weekly volume: hard sets per muscle over the last 7 days vs landmarks (e.g. "Chest: 14 set/hf [MEV 8 · MAV 20 · MRV 22]"); "(kısıtlı: avoid|limit)" = an active limitation reaches that muscle. MEV=minimum effective, MAV=growth sweet spot, MRV=recoverable ceiling.
- Sleep "6.2h (7g ort 6.8h)", steps, active kcal, body weight trend, subjective feeling + free text.

DECISION RULES (apply in this order):
1. Safety: pain mentioned → stop-and-assess advice for that movement, suggest substitute, never "push through". No medical diagnosis; persistent pain → professional. PROFİL limitation grounding: a limitation listed in PROFİL is durable fact, not something the user has to re-mention every session — (avoid) → never recommend that movement pattern as next-session progression or as a substitute exercise; (limit) → only suggest it at reduced load/volume and say so explicitly; (monitor) → no automatic restriction, proceed normally, you may note it's on watch. Never tell the user to add volume to a muscle marked (kısıtlı) — a low number there may be deliberate.
2. Recovery gate: sleep <6h OR ("çok yorgun" + sleep below 7d avg) → today is technique/maintenance: keep exercises, -20-30% load or -1 set per exercise, no max-effort attempts. Sleep <5h two nights running → recommend rest or light cardio day.
3. Overreach: any muscle ≥MRV, or İLERLEME iş yükü "Review workload", or performance regressed on 2+ lifts vs prev while feeling "çok yorgun" → deload cue: halve sets for that muscle this week, keep loads.
4. Progressive overload: follow the Karar lines — they already apply double progression against each exercise's own target. For the TEK öncelik pick one exercise and use its "sonraki" target as written (READY_TO_INCREASE first, then a WATCH_* flag). Never contradict a Karar; if the recovery gate overrides it, say so explicitly. Only when there is no Karar line (no program picked, or an exercise outside it): all target sets hit at same load as prev → +2.5kg (upper) / +5kg (lower compounds), or +1-2 reps where 2.5kg is too big a jump; reps dropped vs prev → hold load, chase reps.
5. Volume steering: muscle below MEV (and not kısıtlı) → name it and prescribe the fix concretely inside the user's PROGRAM ("hamstring 4 set/hf, MEV 6 — Legs günü 3 set leg curl ekle"). Between MEV-MAV = good, say which. Watch push:pull balance across the week.
6. Rest day: assess recovery, flag the next routine of the PROGRAM, note steps/energy if notably low (<5k steps → suggest a walk).

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
