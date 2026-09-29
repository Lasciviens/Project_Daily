// THE goal decision — one confident answer from the same data, rendered by
// every surface that coaches calories or protein: the goal editor's coach
// (DayTargetsEditor → GoalCoachBlock), Food · Today's coach card, Health →
// Goal progress (GoalPathPanel headline + Pace pill). Pure
// (scripts/verify-cut-decision.cjs); the only runtime import is the pace math
// in bodyGoal.ts.
//
// Designed with the sports-scientist + strength-coach agents. Three parts:
//
// A. PROTEIN. With a body-fat % from the scale, from fat-free mass (FFM =
//    BW × (1 − BF)): aim 2.8 g/kg FFM, clamped to 1.6–2.2 g/kg bodyweight; the
//    range is max(1.6 g/kg BW, 2.3 g/kg FFM) – min(2.4 g/kg BW, 3.1 g/kg FFM)
//    (Helms 2014: 2.3–3.1 g/kg FFM for lean lifters in a deficit; Morton 2018:
//    no further gain past ~1.6 g/kg BW, the estimate reaching ~2.2). Without a
//    body-fat %: 2.0 g/kg on a cut, 1.8 on maintain/gain, range 1.6–2.2.
//    Rounded to 5 g. More costs calories without a clear extra benefit.
// B. CALORIE FLOOR (a heuristic, labelled so): the highest of 1,500 kcal,
//    Cunningham resting burn 500 + 22 × FFM (24 × BW without a body-fat %) and
//    75 % of the scale burn (paired logged intake + the scale's own deficit).
//    It only limits CUTTING: nothing here ever tells you to eat less below it,
//    and it is never the reason for a diet break. A diet break is mentioned
//    only after 12+ weeks in the cut or when Muscle watch says likely_loss.
// C. PRECEDENCE — the first gate that applies wins; one headline and at most
//    two supporting lines:
//      1 not enough data (< 4 of the last 7 days logged, or < 10 weigh-ins
//        over 14+ days) → say exactly what is missing;
//      2 losing > 1 %BW/week, or Muscle watch likely_loss → eat more;
//      3 cut slower than 0.5 %/wk AND (the cut needed would go below the
//        floor OR the diary likely misses food) → don't cut: check logging,
//        add steps;
//      4 cut slower than 0.5 %/wk with room above the floor → the smallest
//        daily cut that reaches 0.5 %/wk (≥ 50 kcal, never below the floor,
//        14-day cooldown between changes);
//      5 0.5–1 %/wk → on track.
//    Maintain (±0.25 %/wk) and gain (0.25–0.5 %/wk) keep bodyGoal's
//    paceAdvice for the kcal change, behind the same gates 1 and 2.
//
// "The diary likely misses food": logged intake < 85 % of what Apple's burn
// and the scale together imply you ate (Apple burn − the scale's deficit) —
// logged + scale deficit is the scale's own burn, so comparing the diary to
// that alone would never flag anything.

import { CUT_LIMIT, ENERGY_DENSITY, kcalForPace, paceAdvice, PHASE_TARGET, STILL_BAND, type Phase, type Tone } from './bodyGoal'
import type { MuscleWatchLevel } from './muscleWatch'

// ── constants ──────────────────────────────────────────────────────────────
export const PROTEIN_FFM = { target: 2.8, low: 2.3, high: 3.1 }
export const PROTEIN_BW = { min: 1.6, max: 2.2, cap: 2.4, cutNoBf: 2.0, otherNoBf: 1.8 }
export const PROTEIN_PER_MEAL_PER_KG = 0.4
export const FAT_FLOOR_PER_KG = 0.6
export const FLOOR_ABS = 1500
export const FLOOR_BMR_BASE = 500
export const FLOOR_BMR_PER_FFM = 22
export const FLOOR_PER_KG_NO_BF = 24
export const FLOOR_SCALE_SHARE = 0.75
export const MIN_LOGGED_DAYS = 4
export const MIN_WEIGH_INS = 10
export const MIN_SPAN_DAYS = 14
export const COOLDOWN_DAYS = 14
export const UNDERLOG_SHARE = 0.85
export const DIET_BREAK_WEEKS = 12
export const STEP_GOAL = 10000
export const DEFAULT_STEP_ADD = 2500
/** kcal per step per kg of bodyweight (~0.05 kcal/step at 83 kg — a heuristic). */
export const KCAL_PER_STEP_PER_KG = 0.0006
/** On a cut, slower than 0.5 but at least this is "slow but fine". */
export const SLOW_BUT_FINE = 0.35

export type DecisionGate = 'no_data' | 'eat_more' | 'near_floor' | 'cut_more' | 'hold' | 'adjust' | 'on_track'
export type EvidenceTier = 'measured' | 'evidence' | 'heuristic'

export interface DecisionInputs {
  phase: Phase
  today: string
  /** Current (trend) bodyweight. */
  weightKg: number | null
  bodyFatPct: number | null
  /** Signed %BW/week (+ = gaining) from the 28-day fitted trend. */
  pctPerWeek: number | null
  /** Signed kg/week from the same trend. */
  kgPerWeek: number | null
  weighIns: number
  weighInSpanDays: number
  /** Full diary days among the last 7 complete days. */
  loggedDays7: number
  targetKcal: number
  targetProteinG: number
  /** Paired days (a full diary AND a complete Apple day): mean logged intake. */
  loggedIntakeKcal: number | null
  /** …and mean Apple burn. */
  appleBurnKcal: number | null
  /** Logged intake + the scale's own deficit (energyBalance observedTdee). */
  scaleBurnKcal: number | null
  muscleWatch: MuscleWatchLevel | null
  phaseStartDate: string | null
  lastCalorieAdjust: string | null
  /** Mean daily steps over the last 7 complete days. */
  steps7: number | null
}

export interface ProteinAdvice {
  targetG: number
  lowG: number
  highG: number
  basis: 'ffm' | 'bodyweight'
  ffmKg: number | null
  gPerKg: number
  /** The draft/saved target sits inside the range. */
  inRange: boolean
  text: string
  perMealG: number
  tier: EvidenceTier
}

export interface CalorieFloor {
  kcal: number
  /** Which rule set it. */
  basis: 'absolute' | 'resting' | 'scale'
  restingKcal: number
  text: string
}

export interface PaceLabel { label: string; tone: Tone }

export interface GoalDecision {
  gate: DecisionGate
  tone: Tone
  headline: string
  /** At most two. */
  lines: string[]
  /** Muted notes from lower gates / context (fat floor, the floor itself). */
  notes: string[]
  /** kcal/day to change the target by (+ = eat more); null = no change. */
  calorieDelta: number | null
  /** target + calorieDelta, respecting the floor. */
  suggestedCalories: number | null
  dietBreak: boolean
  pace: (PaceLabel & { pct: number; kgPerWeek: number | null }) | null
  protein: ProteinAdvice | null
  floor: CalorieFloor
  fatFloorG: number | null
  cooldownDaysLeft: number
  /** headline + lines as one paragraph. */
  text: string
}

// ── helpers ────────────────────────────────────────────────────────────────
const round5 = (v: number) => Math.round(v / 5) * 5
const round10 = (v: number) => Math.round(v / 10) * 10
const n0 = (v: number) => Math.round(v).toLocaleString('en-GB')
const pct2 = (v: number) => Math.abs(v).toFixed(2)
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${pct2(v)}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function dayNum(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, dd) / 86_400_000)
}
function daysSince(from: string | null, today: string): number {
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return Infinity
  return dayNum(today) - dayNum(from)
}
/** yyyy-MM-dd → DD.MM.YYYY (the app's only date format). */
export function ddmmyyyy(d: string): string {
  const [y, m, dd] = d.split('-')
  return `${dd}.${m}.${y}`
}
const ffmOf = (kg: number, bf: number | null) => (bf != null && bf > 2 && bf < 75 ? kg * (1 - bf / 100) : null)

// ── A. protein ─────────────────────────────────────────────────────────────
export function proteinAdvice(phase: Phase, weightKg: number, bodyFatPct: number | null, currentG: number | null = null): ProteinAdvice {
  const ffm = ffmOf(weightKg, bodyFatPct)
  let target: number, low: number, high: number
  if (ffm != null && phase === 'cut') {
    target = Math.min(PROTEIN_BW.max * weightKg, Math.max(PROTEIN_BW.min * weightKg, PROTEIN_FFM.target * ffm))
    low = Math.max(PROTEIN_BW.min * weightKg, PROTEIN_FFM.low * ffm)
    high = Math.min(PROTEIN_BW.cap * weightKg, PROTEIN_FFM.high * ffm)
  } else {
    target = (phase === 'cut' ? PROTEIN_BW.cutNoBf : PROTEIN_BW.otherNoBf) * weightKg
    low = PROTEIN_BW.min * weightKg
    high = PROTEIN_BW.max * weightKg
  }
  const targetG = round5(target), lowG = round5(low), highG = Math.max(round5(high), targetG)
  const basis = ffm != null && phase === 'cut' ? 'ffm' : 'bodyweight'
  const inRange = currentG != null && currentG >= lowG && currentG <= highG
  return {
    targetG, lowG, highG, basis, ffmKg: ffm != null ? Math.round(ffm * 10) / 10 : null,
    gPerKg: Math.round((targetG / weightKg) * 10) / 10, inRange,
    text: `Aim ~${targetG} g (${lowG}–${highG}) — more costs calories without clear extra benefit.`,
    perMealG: round5(weightKg * PROTEIN_PER_MEAL_PER_KG),
    tier: 'evidence',
  }
}

// ── B. floor ───────────────────────────────────────────────────────────────
export function calorieFloor(weightKg: number | null, bodyFatPct: number | null, scaleBurnKcal: number | null): CalorieFloor {
  const ffm = weightKg != null ? ffmOf(weightKg, bodyFatPct) : null
  const resting = weightKg == null ? 0 : ffm != null ? FLOOR_BMR_BASE + FLOOR_BMR_PER_FFM * ffm : FLOOR_PER_KG_NO_BF * weightKg
  const scale = scaleBurnKcal != null && scaleBurnKcal > 0 ? FLOOR_SCALE_SHARE * scaleBurnKcal : 0
  const raw = Math.max(FLOOR_ABS, resting, scale)
  const basis: CalorieFloor['basis'] = raw === FLOOR_ABS ? 'absolute' : raw === resting ? 'resting' : 'scale'
  const kcal = round10(raw)
  const why = basis === 'resting' ? (ffm != null ? 'your estimated resting burn (500 + 22 × lean mass)' : 'about 24 kcal per kg')
    : basis === 'scale' ? '75 % of what the scale says you burn' : 'the 1,500 kcal minimum'
  return { kcal, basis, restingKcal: round10(resting), text: `Calorie floor ~${n0(kcal)} kcal — ${why}; a heuristic that only limits cutting.` }
}

// ── pace label (the Pace pill everywhere) ──────────────────────────────────
export function paceLabel(phase: Phase, pct: number): PaceLabel {
  const p = Math.round(pct * 100) / 100
  if (phase === 'cut') {
    if (p > STILL_BAND) return { label: 'Wrong direction', tone: 'warn' }
    if (p > -SLOW_BUT_FINE) return { label: 'Slow', tone: 'warn' }
    if (p > PHASE_TARGET.cut.hi) return { label: 'Slow but fine', tone: 'neutral' }
    if (p >= PHASE_TARGET.cut.lo) return { label: 'On track', tone: 'success' }
    return p >= CUT_LIMIT ? { label: 'Fast', tone: 'warn' } : { label: 'Much too fast', tone: 'danger' }
  }
  if (phase === 'maintain') {
    const t = PHASE_TARGET.maintain
    return p < t.lo ? { label: 'Drifting down', tone: 'info' } : p > t.hi ? { label: 'Drifting up', tone: 'info' } : { label: 'Steady', tone: 'success' }
  }
  const t = PHASE_TARGET.gain
  if (p < -STILL_BAND) return { label: 'Wrong direction', tone: 'warn' }
  if (p < t.lo) return { label: 'Slow', tone: 'info' }
  if (p <= t.hi) return { label: 'On track', tone: 'success' }
  return p <= 0.75 ? { label: 'Fast', tone: 'warn' } : { label: 'Much too fast', tone: 'warn' }
}

/** Steps to add toward 10k (rounded to 500), and the kcal they burn. */
export function stepNudge(steps7: number | null, weightKg: number): { steps: number; kcal: number } | null {
  const add = steps7 == null ? DEFAULT_STEP_ADD : Math.round(Math.max(0, STEP_GOAL - steps7) / 500) * 500
  if (add <= 0) return null
  return { steps: add, kcal: round10(add * KCAL_PER_STEP_PER_KG * weightKg) }
}

/** The diary likely misses food (see the header). */
export function likelyUnderlogging(i: Pick<DecisionInputs, 'loggedIntakeKcal' | 'appleBurnKcal' | 'scaleBurnKcal'>): boolean {
  if (i.loggedIntakeKcal == null || i.appleBurnKcal == null || i.scaleBurnKcal == null) return false
  const scaleDeficit = i.scaleBurnKcal - i.loggedIntakeKcal
  const implied = i.appleBurnKcal - scaleDeficit
  return implied > 0 && i.loggedIntakeKcal < UNDERLOG_SHARE * implied
}

// ── C. the decision ────────────────────────────────────────────────────────
export function buildGoalDecision(i: DecisionInputs): GoalDecision {
  const kg = i.weightKg
  const floor = calorieFloor(kg, i.bodyFatPct, i.scaleBurnKcal)
  const protein = kg ? proteinAdvice(i.phase, kg, i.bodyFatPct, i.targetProteinG) : null
  const fatFloorG = kg && i.phase === 'cut' ? Math.round(kg * FAT_FLOOR_PER_KG) : null
  const pct = i.pctPerWeek != null ? Math.round(i.pctPerWeek * 100) / 100 : null
  const pace = pct != null ? { ...paceLabel(i.phase, pct), pct, kgPerWeek: i.kgPerWeek } : null
  const cooldownDaysLeft = Math.max(0, COOLDOWN_DAYS - daysSince(i.lastCalorieAdjust, i.today))
  const weeksIn = Math.floor(daysSince(i.phaseStartDate, i.today) / 7)
  const likelyLoss = i.muscleWatch === 'likely_loss'
  const longCut = i.phase === 'cut' && Number.isFinite(weeksIn) && weeksIn >= DIET_BREAK_WEEKS
  const maintenance = i.scaleBurnKcal ?? i.appleBurnKcal
  const breakLine = `A 1–2 week diet break at maintenance${maintenance ? ` (~${n0(round10(maintenance))} kcal)` : ''} is a reasonable reset${longCut ? ` after ${weeksIn} weeks of cutting` : ''}.`

  const notes: string[] = []
  if (i.phase === 'cut' || i.targetKcal < floor.kcal) notes.push(floor.text)
  if (fatFloorG != null) notes.push(`Keep fat at ≥ ~${fatFloorG} g a day on a cut (hormonal health).`)

  const base = { notes, dietBreak: false, pace, protein, floor, fatFloorG, cooldownDaysLeft }
  const done = (gate: DecisionGate, tone: Tone, headline: string, lines: string[], calorieDelta: number | null = null, dietBreak = false): GoalDecision => {
    const ls = lines.filter(Boolean).slice(0, 2)
    const suggestedCalories = calorieDelta != null ? i.targetKcal + calorieDelta : null
    return { ...base, gate, tone, headline, lines: ls, calorieDelta, suggestedCalories, dietBreak, text: [headline, ...ls].join(' ') }
  }

  // Gate 1 — enough data?
  const needLog = Math.max(0, MIN_LOGGED_DAYS - i.loggedDays7)
  const needWeighIns = Math.max(0, MIN_WEIGH_INS - i.weighIns)
  const needSpan = Math.max(0, MIN_SPAN_DAYS - i.weighInSpanDays)
  if (!kg || pct == null || needLog > 0 || needWeighIns > 0 || needSpan > 0) {
    const parts: string[] = []
    if (needLog > 0) parts.push(`log ${plural(needLog, 'more day')} (${i.loggedDays7} of the last 7)`)
    if (!kg) parts.push('add a weigh-in')
    else if (needWeighIns > 0) parts.push(`weigh in ${plural(needWeighIns, 'more time')}`)
    else if (needSpan > 0 || pct == null) parts.push(`keep weighing in for ${plural(Math.max(1, needSpan), 'more day')}`)
    return done('no_data', 'neutral', `Not enough data yet — ${parts.join(' and ')}.`,
      ['The coach needs 4 of 7 days logged and 10 weigh-ins over 2 weeks to read your trend.'])
  }

  const lossPct = -pct // + = losing
  const clampUp = (delta: number) => Math.max(floor.kcal, i.targetKcal + delta) - i.targetKcal

  // Gate 2 — losing too fast, or muscle at risk → eat more.
  if (lossPct > -PHASE_TARGET.cut.lo || likelyLoss) {
    const fast = lossPct > -PHASE_TARGET.cut.lo
    const t = PHASE_TARGET[i.phase]
    // Fast: back to the middle of the phase's range. Muscle at risk: on a cut
    // slow to the gentle end (0.5 %/wk); elsewhere only if weight is falling.
    const aim = fast ? t.mid : i.phase === 'cut' ? (lossPct > -t.hi ? t.hi : null) : pct < t.lo ? t.mid : null
    const delta = aim != null ? clampUp(kcalForPace(pct, aim, kg)) : (i.targetKcal < floor.kcal ? floor.kcal - i.targetKcal : null)
    const lines: string[] = []
    const also = likelyLoss ? ' Muscle watch also flags likely muscle loss.' : ''
    if (fast && i.phase === 'cut') lines.push(`Past 1 % a week muscle is increasingly at risk — aim for 0.5–1 % (Helms 2014, Garthe 2011).${also}`)
    else if (fast) lines.push(`Losing over 1 % a week is far from a ${i.phase} pace.${also}`)
    else lines.push(`Hit ~${protein?.targetG ?? '—'} g protein a day and keep lifting heavy.`)
    const dietBreak = i.phase === 'cut' && (likelyLoss || longCut)
    if (dietBreak) lines.push(breakLine)
    const head = fast
      ? `Losing fast (${pct2(lossPct)} %/wk) — eat about ${n0(delta ?? 0)} kcal/day more.`
      : `Muscle watch flags likely muscle loss — ${delta ? `eat about ${n0(delta)} kcal/day more` : "don't eat less"}${delta && aim != null && i.phase === 'cut' ? ` to slow to ${pct2(aim)} %/wk` : ''}.`
    return done('eat_more', fast && lossPct > -CUT_LIMIT ? 'danger' : 'warn', head, lines, delta, dietBreak)
  }

  const cooling = cooldownDaysLeft > 0
  const coolLine = i.lastCalorieAdjust ? `You changed calories on ${ddmmyyyy(i.lastCalorieAdjust)}; the scale needs about 2 weeks to show it.` : ''

  if (i.phase === 'cut') {
    const slow = lossPct < -PHASE_TARGET.cut.hi
    if (slow) {
      const moveWord = lossPct < -STILL_BAND ? `Weight is going up (${signedPct(pct)} %/wk)` : `Loss is slow (${pct2(lossPct)} %/wk)`
      const tone: Tone = lossPct >= SLOW_BUT_FINE ? 'neutral' : 'warn'
      const neededCut = ((-PHASE_TARGET.cut.hi - lossPct) / 100) * kg * ENERGY_DENSITY / 7
      const room = Math.floor((i.targetKcal - floor.kcal) / 50) * 50
      const nearFloor = i.targetKcal - neededCut < floor.kcal || room < 50
      const under = likelyUnderlogging(i)
      // Gate 3 — slow, but no room to cut (or the diary is the likelier gap).
      if (nearFloor || under) {
        const step = stepNudge(i.steps7, kg)
        const stepText = step ? ` and add ~${n0(step.steps)} steps/day (~+${step.kcal} kcal)` : ''
        const action = `Check logging for a week (oils, drinks, weekends)${stepText} before eating less.`
        const head = nearFloor ? `${moveWord} but you're already near your floor.` : `${moveWord} and your diary likely misses some food.`
        const second = nearFloor && under ? 'Your diary also looks short of what Apple and the scale imply you ate.' : longCut ? breakLine : ''
        return done('near_floor', tone, head, [action, second], null, !!second && second === breakLine)
      }
      // Gate 4 — slow with room: the smallest cut to 0.5 %/wk.
      if (cooling) return done('hold', tone, `${moveWord} — hold ${plural(cooldownDaysLeft, 'more day')} before cutting further.`, [coolLine, longCut ? breakLine : ''], null, longCut)
      const cut = Math.min(room, Math.max(50, Math.round(neededCut / 50) * 50))
      return done('cut_more', tone, `${moveWord} — eat about ${n0(cut)} kcal/day less to reach 0.5 %/wk.`,
        [`That's ~${n0(i.targetKcal - cut)} kcal a day, still above your floor (~${n0(floor.kcal)}).`, longCut ? breakLine : ''], -cut, longCut)
    }
    // Gate 5 — on track.
    const kgw = i.kgPerWeek != null ? `${Math.abs(i.kgPerWeek).toFixed(2)} kg/wk, ` : ''
    return done('on_track', 'success', `On track — losing ${kgw}${pct2(lossPct)} %/wk.`,
      ['Right where a cut should be (0.5–1 % of bodyweight a week).', longCut ? breakLine : ''], null, longCut)
  }

  // Maintain / gain — the same pace rule as the report (bodyGoal.paceAdvice).
  const adv = paceAdvice(i.phase, pct, kg)
  const range = i.phase === 'maintain' ? '±0.25 % a week' : '0.25–0.5 % of bodyweight a week'
  if (!adv.adjust) {
    const head = i.phase === 'maintain' ? `Holding steady (${signedPct(pct)} %/wk).` : `On track — gaining ${pct2(pct)} %/wk.`
    return done('on_track', 'success', head, [`Inside the ${range} range.`])
  }
  const lbl = paceLabel(i.phase, pct).label
  if (cooling) return done('hold', 'neutral', `${lbl} (${signedPct(pct)} %/wk) — hold ${plural(cooldownDaysLeft, 'more day')} before the next change.`, [coolLine])
  let delta = adv.adjust.kcal
  if (delta < 0 && i.targetKcal + delta < floor.kcal) {
    const room = Math.floor((i.targetKcal - floor.kcal) / 50) * 50
    if (room < 50) return done('near_floor', 'neutral', `${lbl} (${signedPct(pct)} %/wk) but you're already near your floor.`, [`Check logging for a week (oils, drinks, weekends) before eating less.`])
    delta = -room
  }
  const target = i.phase === 'maintain' ? 'hold steady' : `reach ${pct2(adv.adjust.pct)} %/wk`
  return done('adjust', 'info', `${lbl} (${signedPct(pct)} %/wk) — eat about ${n0(Math.abs(delta))} kcal/day ${delta > 0 ? 'more' : 'less'} to ${target}.`,
    [`Aim for ${range}.`], delta)
}
