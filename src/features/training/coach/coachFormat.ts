import { actionLabel, formatSetTargets, formatSessionSets, progressVerdictHeadline, workloadLabel, type ExerciseProgressResult } from '../progress-engine'
import { MOVEMENT_PATTERN_LABEL, labelForSlug, movementPatternLabel, resolveMovementPattern } from '../muscleMap'
import { volumeBandOf } from '../plan/volumeBands'
import type { ProgressData } from '../progressModel'
import type { AthleteLimitation, AthleteProfile } from '../types.athlete'
import type { HevyRoutine } from '../types.hevy'
import type { WeekMissed } from '../plan/weekInputs'
import { formatDate } from '../../../shared/utils/dateFormat'
import { PAIR_META, leanLabel, ratioText, sidesText, type BalancePair, type RatioRead } from '../plan/muscleBalance'
import type { CoachBalance } from './coachModel'

// ─────────────────────────────────────────────────────────────────────────────
//  The ONE AI-coach context, rendered two ways from the same CoachData:
//    formatPtSnapshot → the PT Coach tab's one-shot text snapshot (Turkish labels)
//    buildCoachJson   → Ask-AI Coach mode's compact JSON
//  Both carry the current program, the progress engine's per-exercise
//  decisions (the very results the Results tab shows) and the athlete's
//  limitations, so neither coach can contradict Progress any more (the PT
//  prompt used to assume a hard-coded bro-split). Pure: no React, no I/O
//  (scripts/verify-coach-context.cjs).
//
//  CONTRACT: the snapshot line formats below and the `coach_assessment` job's
//  instructions (supabase/claude-src/job-coach.ts, the <snapshot> section)
//  describe each other — change them together. The decisions made from the
//  same numbers (rest day, deload cue, the one lift) are coachFacts.ts.
// ─────────────────────────────────────────────────────────────────────────────

export interface CoachSetLine { title: string; sets: string }
export interface CoachSession { workoutId: string; date: string; title: string | null; routineId: string | null; exercises: CoachSetLine[] }
export interface CoachMuscleDose { slug: string; sets: number; restriction: 'avoid' | 'limit' | null }
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
  /** This week's sessions whose day passed undone, or skipped (plan/weekInputs.weekMissed — the This week strip's own reading). */
  missedSessions?: WeekMissed[]
  /** Push:pull and quad:hamstring, planned vs done (plan/muscleBalance.ts — the numbers the app shows). */
  balance?: CoachBalance | null
  /** The nutrition goal's phase (day_targets.goal) — cutting / maintaining / gaining. */
  phase?: 'cut' | 'maintain' | 'gain' | null
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
  if (profile?.goal) parts.push(`Focus ${profile.goal}`)
  if (d.phase) parts.push(`Phase ${d.phase}`)
  if (profile?.experience_level) parts.push(`Level ${profile.experience_level}`)
  if (profile?.equipment_access) parts.push(`Equipment ${profile.equipment_access}`)
  if (profile?.training_days_per_week) parts.push(`${profile.training_days_per_week} days a week`)
  if (parts.length > 0) lines.push(`PROFILE: ${parts.join(' · ')}`)
  for (const lim of d.limitations) {
    lines.push(`  Limitation: ${limitationName(lim.movement_pattern)} (${lim.severity})${lim.note ? ` — ${lim.note}` : ''}`)
  }

  // ── The program and the app's own progress decisions ──
  const target = profile?.training_days_per_week ? ` (target ${profile.training_days_per_week})` : ''
  if (progress.needsCurrentProgram) {
    lines.push(`PROGRAM: ${progress.staleProgram ? 'the saved routines are no longer in Hevy' : 'none selected'} — no progress decisions. This week ${d.sessionsThisWeek} workouts${target}.`)
  } else {
    lines.push(`PROGRAM: ${programTitles(d).join(', ')} · this week ${d.sessionsThisWeek} workouts${target}`)
    for (const m of d.missedSessions ?? []) lines.push(`  ${missedLine(m)}`)
    if (progress.program) {
      lines.push(`PROGRESS: ${progressVerdictHeadline(progress.program.progressVerdict)} — ${progress.program.improvingCount}/${progress.program.analyzableCount} lifts improving · workload: ${workloadLabel(progress.program.workload)}${progress.program.corroboratingSignal ? ` (${progress.program.corroboratingSignal})` : ''}`)
    }
    for (const r of progress.decisions) {
      const title = progress.titleById.get(r.exerciseTemplateId) ?? r.exerciseTemplateId
      const latest = r.currentState.latest ? formatSessionSets(r.currentState.latest.sets, r.metricKind, { rpe: true }) : '—'
      const next = nextTargetText(r)
      const nextText = next ? ` · next: ${next}` : ''
      lines.push(`  Decision: ${title}: ${r.currentAction} "${actionLabel(r.currentAction, r.metricKind)}" · latest: ${latest}${nextText} · evidence ${r.evidence.progress}`)
    }
  }

  // ── Latest session in full + the previous numbers per exercise ──
  const latest = d.sessions[0]
  if (!latest) {
    lines.push('WORKOUTS: none logged.')
  } else {
    const prevByTitle = new Map<string, string>()
    for (const s of d.sessions.slice(1)) for (const ex of s.exercises) if (!prevByTitle.has(ex.title)) prevByTitle.set(ex.title, ex.sets)
    lines.push(`LATEST WORKOUT (${latest.date === d.today ? 'TODAY' : latest.date}): ${latest.title ?? 'Workout'}`)
    for (const ex of latest.exercises) {
      const prev = prevByTitle.get(ex.title)
      lines.push(`  ${ex.title}: ${ex.sets}${prev ? ` (previous: ${prev})` : ''}`)
    }
    lines.push(`Recent workout days: ${d.sessions.slice(0, 4).map(s => s.date).join(', ')}`)
  }

  // ── Weekly hard-set volume per muscle, in S18's words (plan/volumeBands.ts — Results' card reads the same) ──
  if (d.weeklyMuscleSets.length > 0) {
    lines.push('WEEKLY VOLUME (last 7 days, hard sets; primary 1 + secondary 0.5):')
    for (const m of d.weeklyMuscleSets) {
      lines.push(`  ${labelForSlug(m.slug)}: ${r1(m.sets)} sets/wk [${volumeBandOf(m.sets).label}]${m.restriction ? ` (restricted: ${m.restriction})` : ''}`)
    }
  }

  // ── Push:pull / quad:hamstring — the app's own numbers ──
  if (d.balance) lines.push(...balanceLines(d.balance))

  // ── Recovery: sleep, steps, energy, weight ──
  const nights = d.sleep.filter(n => n.date >= shiftIso(d.today, -8))
  const last = nights[nights.length - 1]
  if (last) {
    const avg = nights.reduce((s, x) => s + x.total, 0) / nights.length
    lines.push(`SLEEP: last night ${last.total.toFixed(1)}h (7-day avg ${avg.toFixed(1)}h)${last.date !== d.today ? ` — last data ${last.date}` : ''}`)
  } else lines.push('SLEEP: no data.')

  const yesterday = shiftIso(d.today, -1)
  const fmt = (arr: CoachDay[], unit: string) =>
    arr.filter(x => x.date >= yesterday).map(x => `${x.date === d.today ? 'today' : 'yesterday'} ${Math.round(x.value)}${unit}`).join(', ') || 'no data'
  lines.push(`STEPS: ${fmt(d.steps, '')} · ACTIVE ENERGY: ${fmt(d.activeKcal, ' kcal')}`)

  const weights = d.bodyweight.filter(w => w.date >= shiftIso(d.today, -30))
  if (weights.length >= 2) {
    const first = weights[0], lastW = weights[weights.length - 1]
    lines.push(`WEIGHT: ${lastW.kg.toFixed(1)}kg (${signed(lastW.kg - first.kg)}kg since ${first.date})`)
  } else if (weights.length === 1) {
    lines.push(`WEIGHT: ${weights[0].kg.toFixed(1)}kg`)
  }

  return lines.join('\n')
}

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Missed: Lower A — planned 24.11.2026, still open until 30.11.2026" / "… · skipped: Sick" — this week's sessions as
 *  the This week strip reads them (213). */
export function missedLine(m: WeekMissed): string {
  const state = m.state === 'skipped'
    ? ` · skipped${m.reason ? `: ${m.reason.trim()}` : ''}`
    : `, still open${m.countsUntil ? ` until ${formatDate(m.countsUntil)}` : ''}${m.skippedOver ? ' · skipped over' : ''}`
  return `Missed: ${m.title} — planned ${formatDate(m.date)}${state}`
}

function missedJson(m: WeekMissed): Record<string, unknown> {
  return {
    t: m.title, planned: m.date, status: m.state,
    ...(m.countsUntil ? { open_until: m.countsUntil } : {}),
    ...(m.reason ? { reason: m.reason } : {}),
    ...(m.skippedOver ? { skipped_over: true } : {}),
  }
}

const PAIRS: BalancePair[] = ['pushPull', 'quadHam']
const ratioWithLean = (r: RatioRead) => `${ratioText(r)} (${leanLabel(r)})`

/** "BALANCE (…):" + one line per ratio + a "Why:" line where planned and
 *  done differ. */
export function balanceLines(b: CoachBalance): string[] {
  const lines = [`BALANCE (weekly sets; planned = current program, done = last ${b.windowDays} days):`]
  for (const pair of PAIRS) {
    const done = b.done[pair]
    const planned = b.planned?.[pair]
    if (done.lean === 'none' && (!planned || planned.lean === 'none')) continue
    lines.push(`  ${PAIR_META[pair].label}: ${planned ? `planned ${ratioWithLean(planned)} · ` : ''}done ${ratioWithLean(done)}${done.lean !== 'none' ? ` — ${sidesText(done)}` : ''}`)
    const why = b.comparison?.[pair].why
    if (why) lines.push(`    Why: ${why}`)
  }
  return lines
}

function balanceJson(b: CoachBalance): Record<string, unknown> {
  const one = (r: RatioRead) => ({ ratio: ratioText(r), lean: leanLabel(r), a: r.a, b: r.b })
  const why = PAIRS.map(p => b.comparison?.[p].why).filter((w): w is string => !!w)
  return {
    rule: 'weekly sets (primary 1, each distinct secondary 0.5); push = chest+shoulders+triceps, pull = back+traps+biceps; ratios push÷pull and quad÷ham; a side is heavy above 1.5×; push/quad-heavy is worth fixing, the other way rarely matters. Same numbers as the app (Plan tab = planned, Results → Body map = done) — quote these, never recompute.',
    ...(b.planned ? { planned: { push_pull: one(b.planned.pushPull), quad_ham: one(b.planned.quadHam) } } : {}),
    [`done_${b.windowDays}d`]: { push_pull: one(b.done.pushPull), quad_ham: one(b.done.quadHam) },
    ...(why.length ? { why } : {}),
  }
}

// ── Coach mode: compact JSON ────────────────────────────────────────────────

export function buildCoachJson(d: CoachData, windowDays: number): Record<string, unknown> {
  const from = shiftIso(d.today, -windowDays)
  const { profile, progress } = d
  const ctx: Record<string, unknown> = {
    period: `${from}..${d.today}`,
    about: 'program + progress are the app\'s own Progress-tab results (same engine): keep advice consistent with them; if you disagree, say why with numbers. "@ RPE 8/9/10" after sets = effort logged per working set in Hevy (reps in reserve ≈ 10 − RPE, self-reported; absent = not logged) — context only, never overrides progress.',
  }
  if (profile) ctx.profile = { focus: profile.goal, level: profile.experience_level, days: profile.training_days_per_week, equip: profile.equipment_access, notes: profile.notes }
  if (d.phase) ctx.phase = d.phase
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
        ...(d.missedSessions?.length ? { missed: d.missedSessions.map(missedJson) } : {}),
        workload: progress.program?.workload ?? null,
      }
  if (!progress.needsCurrentProgram) {
    ctx.progress = progress.decisions.map(r => ({
      n: progress.titleById.get(r.exerciseTemplateId) ?? r.exerciseTemplateId,
      tid: r.exerciseTemplateId,
      action: r.currentAction,
      last: r.currentState.latest ? formatSessionSets(r.currentState.latest.sets, r.metricKind, { rpe: true }) : null,
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
  if (d.balance) ctx.balance = balanceJson(d.balance)
  if (d.weeklyMuscleSets.length) {
    ctx.weekly_sets = d.weeklyMuscleSets.map(m => ({ m: m.slug, s: r1(m.sets), band: volumeBandOf(m.sets).id, ...(m.restriction ? { restricted: m.restriction } : {}) }))
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


/** `text`, or its first lines that fit in `max` characters (the least important come last in the snapshot). */
export function fitLines(text: string, max: number): string {
  if (text.length <= max) return text
  const kept: string[] = []
  let size = 0
  for (const line of text.split('\n')) {
    if (size + line.length + 1 > max) break
    kept.push(line)
    size += line.length + 1
  }
  return kept.join('\n')
}

const utf8Bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length

/**
 * The assessment's input as the function will receive it, cut so that its JSON is at most `maxBytes` bytes
 * (the function refuses a request over 16 KB, and an accent takes two bytes): the snapshot loses its last lines first
 * and stops at 500 characters, then the previous assessment is dropped, then the snapshot goes on shrinking. The
 * verdicts (the decisions) and the owner's note are never cut here.
 */
export function fitRequestBytes<T extends { snapshot: string; previous?: string }>(input: T, maxBytes: number): T {
  const wrapped = (i: T) => ({ action: 'run', job: 'coach_assessment', input: i })
  let out = input
  for (let guard = 0; guard < 60 && utf8Bytes(wrapped(out)) > maxBytes; guard++) {
    const excess = utf8Bytes(wrapped(out)) - maxBytes
    if (out.snapshot.length > 500) {
      out = { ...out, snapshot: fitLines(out.snapshot, Math.max(500, out.snapshot.length - Math.max(200, excess))) }
    } else if (out.previous !== undefined) {
      const rest: Partial<T> = { ...out }
      delete rest.previous
      out = rest as T
    } else {
      out = { ...out, snapshot: fitLines(out.snapshot, Math.max(0, out.snapshot.length - Math.max(100, excess))) }
    }
  }
  return out
}
