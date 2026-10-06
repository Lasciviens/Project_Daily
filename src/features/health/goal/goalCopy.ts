import type { Tone } from '../../../shared/ui'
import type { Confidence, PairedBalance, Phase, ProteinBand, Reason, Verdict } from './energyBalance'
import type { CompositionVerdict, GoalKind } from './bodyGoal'
import type { MuscleWatchLevel } from './muscleWatch'

// Plain-language copy for the goal report. Never a diagnosis: each line says
// what the numbers show and the most common explanation.

export const PHASE_QUESTION: Record<Phase, string> = {
  cut: 'Are you losing fat at the right pace — and keeping your muscle?',
  maintain: 'Are you holding your weight — and what is it made of?',
  gain: 'Are you gaining at the right pace — and is it muscle?',
}

/** The energy verdict, phase-aware: 'slower' = the scale sits higher than the
 *  numbers predict, 'faster' = lower. */
export function verdictCopy(v: Verdict, phase: Phase): { title: string; tone: Tone } {
  if (v === 'on_track') return { title: 'Your scale matches your numbers', tone: 'success' }
  if (phase === 'gain') return v === 'slower' ? { title: 'Gaining faster than your numbers say', tone: 'warn' } : { title: 'Gaining slower than your numbers say', tone: 'info' }
  if (phase === 'maintain') return v === 'slower' ? { title: 'Your weight runs above what your numbers predict', tone: 'warn' } : { title: 'Your weight runs below what your numbers predict', tone: 'info' }
  return v === 'slower' ? { title: 'Losing slower than your numbers say', tone: 'warn' } : { title: 'Losing faster than your numbers say', tone: 'info' }
}

export function reasonCopy(r: Reason, phase: Phase): string {
  switch (r) {
    case 'partial_logging': return 'Some days are missing or half-logged in the diary, so the average intake is likely too low.'
    case 'intake_underlogged': return 'Most likely: the diary misses some of what you eat. Food records typically miss 19–41 % of intake — oils, sauces, snacks and portion sizes are the usual culprits.'
    case 'apple_overestimates': return 'Also common: Apple\'s energy reads high. Wrist wearables were off by ~28 % on average in a 2025 review, mostly overestimating active energy.'
    case 'early_water': return phase === 'gain'
      ? 'This window includes the start of your gain. Refilling glycogen and water adds weight that holds little energy — this settles down.'
      : 'This window includes the start of your cut. Early loss is largely glycogen and water, which weighs a lot but holds little energy — this settles down.'
    case 'short_window': return 'A 14-day window is short: a salty meal or a hard training day can move the scale by a kilo.'
    case 'apple_underestimates': return 'Apple may be reading your burn low, or the diary over-counts (rare — logging usually misses food rather than adding it).'
    case 'intake_overlogged': return 'If this lasts over several windows, check that eaten portions aren\'t logged twice.'
  }
}

export const CONFIDENCE_COPY: Record<Confidence, { label: string; tone: Tone }> = {
  high: { label: 'High confidence', tone: 'success' },
  medium: { label: 'Medium confidence', tone: 'neutral' },
  low: { label: 'Low confidence', tone: 'warn' },
}

/** Tone of a fat/muscle verdict, read through the phase. */
export function compositionTone(v: CompositionVerdict, phase: Phase): Tone {
  switch (v) {
    case 'recomp': case 'fat_loss_lean_kept': return phase === 'gain' ? 'info' : 'success'
    case 'lean_gain': case 'lean_gain_some_fat': return phase === 'cut' ? 'info' : 'success'
    case 'fat_loss_some_lean': case 'mostly_fat_gain': return 'warn'
    case 'losing_lean': case 'fat_gain_lean_loss': return 'danger'
    case 'stable': return phase === 'maintain' ? 'success' : 'neutral'
    case 'not_enough_data': return 'neutral'
  }
}

export const COMPOSITION_LABEL: Record<CompositionVerdict, string> = {
  recomp: 'Fat down, muscle up',
  fat_loss_lean_kept: 'Losing fat, keeping muscle',
  fat_loss_some_lean: 'Losing fat and some muscle',
  losing_lean: 'Losing muscle',
  lean_gain: 'Gaining lean mass',
  lean_gain_some_fat: 'Gaining lean mass, some fat',
  mostly_fat_gain: 'Gaining mostly fat',
  fat_gain_lean_loss: 'Fat up, muscle down',
  stable: 'No clear change',
  not_enough_data: 'Not enough scale data',
}

export const PROTEIN_COPY: Record<ProteinBand, { label: string; tone: Tone }> = {
  below_floor: { label: 'Below 1.6 g/kg', tone: 'warn' },
  in_range: { label: '1.6–2.2 g/kg', tone: 'success' },
  high: { label: 'Above 2.2 g/kg', tone: 'success' },
}

export const GOAL_META: Record<GoalKind, { label: string; unit: string; dp: number; source: string }> = {
  weight: { label: 'Weight', unit: 'kg', dp: 1, source: 'trend weight' },
  bodyFat: { label: 'Body fat', unit: '%', dp: 1, source: 'smart scale' },
  muscle: { label: 'Muscle mass', unit: 'kg', dp: 1, source: 'scale report (muscle % × weight)' },
}

export function signed(v: number, dp = 0, unit = ''): string {
  const s = Math.abs(v).toFixed(dp)
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${s}${unit}`
}

export function kcal(v: number | null): string {
  return v == null ? '—' : Math.round(v).toLocaleString('en-GB')
}

/** The report's name for the source string an app wrote. */
export function sourceLabel(s: string | null): string {
  return s == null ? 'the scale' : s === 'report' ? 'the scale reports' : s
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "deficit" for burn above intake, "surplus" below. */
export function balanceWord(deficit: number): 'deficit' | 'surplus' {
  return deficit >= 0 ? 'deficit' : 'surplus'
}

/** Which days the calorie comparison left out, and why — or that none were. */
export function leftOutLine(p: PairedBalance): string {
  const parts: string[] = []
  if (p.excluded.noFood) parts.push(`${plural(p.excluded.noFood, 'day')} with no food logged`)
  if (p.excluded.halfLogged) parts.push(`${plural(p.excluded.halfLogged, 'half-logged day')} (under ${kcal(p.halfLoggedBelow)} kcal logged)`)
  if (p.excluded.appleGap) parts.push(`${plural(p.excluded.appleGap, 'day')} with incomplete Apple energy (watch off or not synced)`)
  return parts.length ? `Left out: ${parts.join(' · ')}.` : 'No day was left out — every day has a full diary and a complete Apple day.'
}

/** Why Activity and Food's "Last 7 days" can show a different number. */
export const OTHER_SCREENS_NOTE =
  'Other screens count different days: Activity shows only Apple\'s burn, for the period picked there (7 days by default), '
  + 'and Food\'s “Last 7 days” averages every logged day up to today — including today\'s unfinished diary. '
  + 'This comparison uses the same finished days on both sides.'

/** Muscle watch's level pill (muscleWatch.ts). */
export const MUSCLE_WATCH_LEVEL: Record<MuscleWatchLevel, { label: string; tone: Tone }> = {
  ok: { label: 'Muscle protected', tone: 'success' },
  watch: { label: 'Watch', tone: 'warn' },
  likely_loss: { label: 'Likely losing muscle', tone: 'danger' },
  not_enough_data: { label: 'Not enough data', tone: 'neutral' },
}
