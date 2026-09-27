// Push:pull and quad:hamstring balance — the ONE ratio and verdict every
// screen uses: the Program tab (sets PLANNED in the current program), the
// Muscles body map on Progress (sets DONE in its window), the Muscles verdict
// banner and the AI coach context. Before this, the two cards had their own
// slug counting, thresholds (0.67–1.5 vs 0.8–1.25) and orientation
// (hamstring ÷ quad vs quad ÷ hamstring), so one read "1.77 : 1, push-heavy"
// while the other read "balanced". Pure (runtime imports only from muscleMap,
// itself pure), sucrase-tested by scripts/verify-training-plan.cjs.
//
// Science: both ratios are rules of thumb with no trial behind the exact
// cut-off (Kolber 2009 observed shoulder imbalances in recreational lifters
// who favoured pressing; the hamstring part with evidence is doing knee
// flexion at all — van Dyk 2019). So: one simple, symmetric limit — a side
// is "heavy" when it gets more than 1.5× the other's weekly sets.

import type { Slug } from 'react-muscle-highlighter'
import { creditedMuscles } from '../muscleMap'
import type { Tone } from '../../../shared/ui/Tone'

export const PUSH_SLUGS = ['chest', 'deltoids', 'triceps'] as const
export const PULL_SLUGS = ['upper-back', 'trapezius', 'biceps'] as const
export const QUAD_SLUG = 'quadriceps'
export const HAM_SLUG = 'hamstring'

/** A side is heavy when it gets more than this many times the other's sets. */
export const BALANCE_LIMIT = 1.5
/** Planned and done "disagree" when their verdicts differ or their ratios
 *  are at least this many times apart. */
export const BALANCE_GAP_LIMIT = 1.2

export type BalancePair = 'pushPull' | 'quadHam'
/** Weekly sets per side (one decimal). */
export interface BalanceTotals { push: number; pull: number; quad: number; ham: number }
/** Which side is heavy: `a` = push / quad, `b` = pull / hamstring. */
export type BalanceLean = 'balanced' | 'a' | 'b' | 'none'

export interface RatioRead {
  pair: BalancePair
  /** Push or quad sets per week. */
  a: number
  /** Pull or hamstring sets per week. */
  b: number
  /** a ÷ b at two decimals; null when a side has no sets. */
  ratio: number | null
  lean: BalanceLean
}

export interface MuscleBalance { pushPull: RatioRead; quadHam: RatioRead }

export const PAIR_META: Record<BalancePair, {
  label: string; a: string; b: string; aMuscles: string; bMuscles: string
  heavy: { a: string; b: string }; only: { a: string; b: string }; work: { a: string; b: string }
}> = {
  pushPull: {
    label: 'Push : pull', a: 'push', b: 'pull',
    aMuscles: 'chest, shoulders, triceps', bMuscles: 'back, traps, biceps',
    heavy: { a: 'push-heavy', b: 'pull-heavy' }, only: { a: 'push only', b: 'pull only' },
    work: { a: 'pushing', b: 'pulling' },
  },
  quadHam: {
    label: 'Quad : hamstring', a: 'quad', b: 'hamstring',
    aMuscles: 'front of the thigh', bMuscles: 'back of the thigh',
    heavy: { a: 'quad-heavy', b: 'hamstring-heavy' }, only: { a: 'quads only', b: 'hamstrings only' },
    work: { a: 'quad work', b: 'hamstring work' },
  },
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

/** Weekly sets per side from any per-slug weekly source. */
export function balanceTotals(setsFor: (slug: string) => number): BalanceTotals {
  const sum = (slugs: readonly string[]) => slugs.reduce((s, k) => s + (setsFor(k) || 0), 0)
  return { push: round1(sum(PUSH_SLUGS)), pull: round1(sum(PULL_SLUGS)), quad: round1(setsFor(QUAD_SLUG) || 0), ham: round1(setsFor(HAM_SLUG) || 0) }
}

/** One ratio + verdict. The verdict is read off the rounded ratio, so the
 *  number on screen and the word next to it can never disagree. */
export function readRatio(pair: BalancePair, a: number, b: number): RatioRead {
  const A = round1(Math.max(0, a)), B = round1(Math.max(0, b))
  if (A <= 0 && B <= 0) return { pair, a: A, b: B, ratio: null, lean: 'none' }
  if (B <= 0) return { pair, a: A, b: B, ratio: null, lean: 'a' }
  if (A <= 0) return { pair, a: A, b: B, ratio: null, lean: 'b' }
  const ratio = round2(A / B)
  const lean: BalanceLean = ratio > BALANCE_LIMIT ? 'a' : ratio < round2(1 / BALANCE_LIMIT) ? 'b' : 'balanced'
  return { pair, a: A, b: B, ratio, lean }
}

export function readMuscleBalance(t: BalanceTotals): MuscleBalance {
  return { pushPull: readRatio('pushPull', t.push, t.pull), quadHam: readRatio('quadHam', t.quad, t.ham) }
}

/** "1.77 : 1", "push only", or "—". */
export function ratioText(r: RatioRead): string {
  if (r.ratio != null) return `${r.ratio.toFixed(2)} : 1`
  if (r.lean === 'a') return PAIR_META[r.pair].only.a
  if (r.lean === 'b') return PAIR_META[r.pair].only.b
  return '—'
}

export function leanLabel(r: RatioRead): string {
  if (r.lean === 'a') return PAIR_META[r.pair].heavy.a
  if (r.lean === 'b') return PAIR_META[r.pair].heavy.b
  return r.lean === 'balanced' ? 'balanced' : 'no sets'
}

/** Push- or quad-heavy is the one worth a warning; the other way round is
 *  rarely a problem, so it is information, not a flag. */
export function leanTone(r: RatioRead): Tone {
  return r.lean === 'a' ? 'warn' : r.lean === 'b' ? 'info' : r.lean === 'balanced' ? 'success' : 'neutral'
}

export const isFlagged = (r: RatioRead) => r.lean === 'a'

/** "34.5 push vs 18 pull sets/week". */
export function sidesText(r: RatioRead): string {
  const m = PAIR_META[r.pair]
  return `${r.a} ${m.a} vs ${r.b} ${m.b} sets/week`
}

/** The InfoBubble text for one ratio — identical on both cards. */
export function balanceInfo(pair: BalancePair): string {
  const m = PAIR_META[pair]
  const base = `${m.a[0].toUpperCase()}${m.a.slice(1)} (${m.aMuscles}) sets ÷ ${m.b} (${m.bMuscles}) sets per week, counted like every volume screen: 1 for the main muscle, 0.5 for each helper. Flagged when one side gets more than ${BALANCE_LIMIT}× the other — a rule of thumb, not a trial-backed cut-off.`
  return pair === 'pushPull'
    ? `${base} Pushing much more than pulling is the common pattern in recreational lifters; the other way round is rarely a problem. Shoulders count as push, although rear-delt work is pulling.`
    : `${base} Doing a knee-flexion exercise (a leg curl or the Nordic curl) is the part with evidence behind it.`
}

const shareA = (r: RatioRead) => (r.a + r.b > 0 ? r.a / (r.a + r.b) : 0.5)

export function balanceDisagrees(planned: RatioRead, done: RatioRead): boolean {
  if (planned.lean === 'none' || done.lean === 'none') return false
  if (planned.lean !== done.lean) return true
  if (planned.ratio != null && done.ratio != null) {
    return Math.abs(Math.log(done.ratio / planned.ratio)) >= Math.log(BALANCE_GAP_LIMIT) - 1e-9
  }
  return false
}

// ── Why planned and done differ ─────────────────────────────────────────────

/** One exercise's planned sets per pass. */
export interface PlannedExerciseBalance { templateId: string; title: string; sets: number; perPass: BalanceTotals }
/** What one routine of the current program plans per pass. */
export interface PlannedRoutineBalance { id: string; title: string; perPass: BalanceTotals; exercises: PlannedExerciseBalance[] }

/** One done-volume row (the Muscles tab's volume rows fit as-is). */
export interface BalanceVolumeRow { workoutId: string; routineId?: string | null; templateId: string; workingSets: number }
export interface BalanceTemplate { primary: Slug | null; secondaries: readonly Slug[]; title?: string }

/** One exercise's done volume inside a source, over the whole window. */
export interface DoneExerciseBalance { templateId: string; title: string; sets: number; totals: BalanceTotals }

export interface BalanceSource {
  /** Program routine id; null = every session outside the current program. */
  routineId: string | null
  title: string
  /** Planned sets per pass (program routines only). */
  perPass: BalanceTotals | null
  plannedExercises: PlannedExerciseBalance[]
  doneSessions: number
  /** Credited sets over the whole window (not per week). */
  doneTotals: BalanceTotals
  doneExercises: DoneExerciseBalance[]
}

const ZERO: BalanceTotals = { push: 0, pull: 0, quad: 0, ham: 0 }

/** Done volume split by where it came from: each current-program routine
 *  (sessions started from it) and everything else (freeform sessions, other
 *  routines), per exercise too. Same counting as every volume screen
 *  (creditedMuscles). */
export function doneBalanceSources(
  rows: readonly BalanceVolumeRow[],
  templates: ReadonlyMap<string, BalanceTemplate>,
  program: readonly PlannedRoutineBalance[],
): BalanceSource[] {
  type Acc = { sessions: Set<string>; perSlug: Map<string, number>; byEx: Map<string, { title: string; sets: number; perSlug: Map<string, number> }> }
  const inProgram = new Map(program.map(r => [r.id, r]))
  const fresh = (): Acc => ({ sessions: new Set(), perSlug: new Map(), byEx: new Map() })
  const acc = new Map<string | null, Acc>()
  for (const r of program) acc.set(r.id, fresh())
  acc.set(null, fresh())
  const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)
  for (const row of rows) {
    const t = templates.get(row.templateId)
    if (!t) continue
    const key = row.routineId && inProgram.has(row.routineId) ? row.routineId : null
    const a = acc.get(key)!
    a.sessions.add(row.workoutId)
    const ex = a.byEx.get(row.templateId) ?? { title: t.title ?? 'Exercise', sets: 0, perSlug: new Map<string, number>() }
    ex.sets += row.workingSets
    for (const c of creditedMuscles(row.templateId, t.primary, t.secondaries)) {
      bump(a.perSlug, c.slug, row.workingSets * c.weight)
      bump(ex.perSlug, c.slug, row.workingSets * c.weight)
    }
    a.byEx.set(row.templateId, ex)
  }
  const out: BalanceSource[] = []
  for (const [key, a] of acc) {
    const routine = key ? inProgram.get(key) ?? null : null
    out.push({
      routineId: key,
      title: routine?.title ?? 'Sessions outside your program',
      perPass: routine?.perPass ?? null,
      plannedExercises: routine?.exercises ?? [],
      doneSessions: a.sessions.size,
      doneTotals: balanceTotals(s => a.perSlug.get(s) ?? 0),
      doneExercises: [...a.byEx.entries()].map(([templateId, e]) => ({ templateId, title: e.title, sets: e.sets, totals: balanceTotals(s => e.perSlug.get(s) ?? 0) })),
    })
  }
  return out
}

const sideOf = (pair: BalancePair, t: BalanceTotals) => (pair === 'pushPull' ? { a: t.push, b: t.pull } : { a: t.quad, b: t.ham })
const times = (n: number) => `${n}×`
const perSession = (n: number) => `about ${round1(n)} set${round1(n) === 1 ? '' : 's'} a session`

/** The exercise that moved one side of a routine's sessions most, in the
 *  direction the side moved: an exercise added that the routine doesn't
 *  have, or a routine exercise done with more/fewer sets than prescribed. */
function exerciseBehind(s: BalanceSource, pair: BalancePair, side: 'a' | 'b', sign: 1 | -1, word: string): string | null {
  const planned = new Map(s.plannedExercises.map(e => [e.templateId, e]))
  const done = new Map(s.doneExercises.map(e => [e.templateId, e]))
  let best: { delta: number; text: string } | null = null
  for (const id of new Set([...planned.keys(), ...done.keys()])) {
    const p = planned.get(id), d = done.get(id)
    const doneSide = d ? sideOf(pair, d.totals)[side] / s.doneSessions : 0
    const planSide = p ? sideOf(pair, p.perPass)[side] : 0
    const delta = (doneSide - planSide) * sign
    if (delta <= 0 || (best && delta <= best.delta)) continue
    const doneSets = d ? d.sets / s.doneSessions : 0
    const title = d?.title ?? p?.title ?? 'an exercise'
    const text = !p
      ? `In ${s.title} you also do ${title} (${perSession(doneSets)}), which isn't in that routine — extra ${word} the plan doesn't count.`
      : !d
        ? `In ${s.title} you've skipped ${title} (the routine has ${p.sets} set${p.sets === 1 ? '' : 's'}), so less ${word} got done.`
        : `In ${s.title} you do ${sign > 0 ? 'more' : 'fewer'} ${title} sets than it prescribes (${perSession(doneSets)} vs ${p.sets}), so ${sign > 0 ? 'more' : 'less'} ${word} got done.`
    best = { delta, text }
  }
  return best?.text ?? null
}

/** One plain line saying why planned and done disagree, or null when they
 *  don't. The gap is split exactly into (1) program routines done more or
 *  less often than planned, (2) more or fewer sets logged than a routine
 *  prescribes, (3) sessions outside the program — and the part that moved
 *  the ratio most in the direction it moved is named (down to the exercise
 *  where one explains it). */
export function explainBalanceGap(args: {
  pair: BalancePair
  planned: RatioRead
  done: RatioRead
  sources: readonly BalanceSource[]
  passesPerWeek: number
  windowDays: number
}): string | null {
  const { pair, planned, done, sources, passesPerWeek, windowDays } = args
  if (!balanceDisagrees(planned, done)) return null
  const weeks = windowDays / 7
  const m = PAIR_META[pair]
  const towardA = shareA(done) > shareA(planned)
  const Pa = Math.max(planned.a, 1), Pb = Math.max(planned.b, 1)
  const effect = (ca: number, cb: number) => (ca / Pa - cb / Pb) * (towardA ? 1 : -1)

  type Cand = { e: number; text: () => string }
  const cands: Cand[] = []
  const days = `${windowDays} days`
  for (const s of sources) {
    const got = sideOf(pair, s.doneTotals)
    if (s.routineId == null) {
      if (s.doneSessions === 0) continue
      const a = got.a / weeks, b = got.b / weeks
      const word = a / Pa >= b / Pb ? m.work.a : m.work.b
      cands.push({
        e: effect(a, b),
        text: () => `${s.doneSessions} session${s.doneSessions === 1 ? '' : 's'} outside your program in the last ${days} added ${word} (about ${round1(a)} ${m.a} and ${round1(b)} ${m.b} sets a week).`,
      })
      continue
    }
    const per = sideOf(pair, s.perPass ?? ZERO)
    const perWeekDone = s.doneSessions / weeks
    const expected = Math.round(passesPerWeek * weeks)
    // (1) frequency
    const df = perWeekDone - passesPerWeek
    const mainWord = per.a / Pa >= per.b / Pb ? m.work.a : m.work.b
    if (per.a + per.b > 0 && Math.abs(df) > 1e-9) {
      const text = s.doneSessions === 0
        ? `You haven't done ${s.title} in the last ${days} (the plan has it about ${times(expected)}), so its ${mainWord} is missing.`
        : df < 0
          ? `You did ${s.title} ${times(s.doneSessions)} in the last ${days} — the plan has it about ${times(expected)} — so less ${mainWord} got done.`
          : `You did ${s.title} ${times(s.doneSessions)} in the last ${days} — the plan has it about ${times(expected)} — adding more ${mainWord}.`
      cands.push({ e: effect(df * per.a, df * per.b), text: () => text })
    }
    // (2) sets logged vs prescribed, named down to the exercise
    if (s.doneSessions > 0) {
      const da = got.a / s.doneSessions - per.a, db = got.b / s.doneSessions - per.b
      const e = effect(da * perWeekDone, db * perWeekDone)
      // The side that moved the ratio the right way most: more A or less B
      // when it leaned toward A, the mirror otherwise.
      const pushA = (towardA ? da : -da) / Pa, pushB = (towardA ? -db : db) / Pb
      const side: 'a' | 'b' = pushA >= pushB ? 'a' : 'b'
      const sign: 1 | -1 = side === 'a' ? (towardA ? 1 : -1) : (towardA ? -1 : 1)
      const word = side === 'a' ? m.work.a : m.work.b
      cands.push({
        e,
        text: () => exerciseBehind(s, pair, side, sign, word)
          ?? `In ${s.title} you log ${sign > 0 ? 'more' : 'fewer'} ${side === 'a' ? m.a : m.b} sets than it prescribes, so ${sign > 0 ? 'more' : 'less'} ${word} got done.`,
      })
    }
  }
  const best = cands.filter(c => c.e > 0).sort((x, y) => y.e - x.e)[0]
  if (best) return best.text()
  return `The last ${days} lean more to ${towardA ? m.work.a : m.work.b} than the program's plan.`
}

export interface BalanceComparison {
  pair: BalancePair
  planned: RatioRead
  done: RatioRead
  disagree: boolean
  why: string | null
}

/** Planned vs done for both pairs, with the "why" line where they differ. */
export function compareBalance(args: {
  planned: MuscleBalance
  done: MuscleBalance
  sources: readonly BalanceSource[]
  passesPerWeek: number
  windowDays: number
}): Record<BalancePair, BalanceComparison> {
  const one = (pair: BalancePair): BalanceComparison => {
    const planned = args.planned[pair], done = args.done[pair]
    const why = explainBalanceGap({ pair, planned, done, sources: args.sources, passesPerWeek: args.passesPerWeek, windowDays: args.windowDays })
    return { pair, planned, done, disagree: balanceDisagrees(planned, done), why }
  }
  return { pushPull: one('pushPull'), quadHam: one('quadHam') }
}

/** Planned (current program) vs done (a window) for both ratios, with the
 *  one-line "why" where they differ. Null without a current program. */
export function comparePlannedDone(
  plan: { current: readonly unknown[]; balance: MuscleBalance; byRoutine: readonly PlannedRoutineBalance[]; passes: number },
  done: { rows: readonly BalanceVolumeRow[]; tplById: ReadonlyMap<string, BalanceTemplate>; balance: MuscleBalance; windowDays: number },
): Record<BalancePair, BalanceComparison> | null {
  if (plan.current.length === 0) return null
  return compareBalance({
    planned: plan.balance,
    done: done.balance,
    sources: doneBalanceSources(done.rows, done.tplById, plan.byRoutine),
    passesPerWeek: plan.passes,
    windowDays: done.windowDays,
  })
}
