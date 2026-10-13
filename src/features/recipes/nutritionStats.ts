// The words for Food · Today's "Last N days" card: each finding says what the
// number is, whether it is good for the goal, and what to do about it — in
// plain words, from the same window as the bars (weeklyNutrition.ts), so the
// 7 / 14 / 28 switch changes every line. Coaching the targets themselves
// (eat more or less, a new protein target) stays with the coach
// (health/goal/cutDecision.ts); these lines only say how the days went
// against the targets you have. Verified by scripts/verify-nutrition-stats.cjs.
import { formatWeekdayDate } from '../../shared/utils/dateFormat'
import type { PeriodDay, PeriodSummary } from './weeklyNutrition'

export type StatTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral'
export type FindingKey = 'calories' | 'protein' | 'logging' | 'weekend' | 'fiber' | 'fat' | 'best' | 'hardest'
export type Goal = 'cut' | 'maintain' | 'gain'

export interface Finding {
  key: FindingKey
  label: string
  /** Short figure shown at the right ("2,688 / 2,300 kcal"). */
  value: string
  tone: StatTone
  sentence: string
  /** The day a best/hardest finding is about (the card highlights its bar). */
  date?: string
}

export interface FindingsInput {
  summary: PeriodSummary
  targets: { calories: number; protein: number }
  goal: Goal
  /** Current bodyweight — only for the fat floor; null skips it. */
  weightKg: number | null
}

/** Within this share of the calorie target, the average is "on target". */
export const AVG_ON_TARGET = 0.05
/** Fibre most guidelines advise (25–30 g a day). */
export const FIBER_LOW = 25
/** The coach's fat floor on a cut (cutDecision FAT_FLOOR_PER_KG). */
export const FAT_FLOOR_G_PER_KG = 0.6
/** A weekend–weekday gap past this is worth a warning. */
export const WEEKEND_GAP_KCAL = 500
/** Under this the weekends "look like weekdays". */
export const WEEKEND_SAME_KCAL = 200
/** A period's averages need ≥ 5 of 7 days counted (10 of 14, 20 of 28). */
export const RELIABLE_SHARE = 5 / 7
/** One protein shake, for the "how much is that" hint. */
export const SHAKE_PROTEIN_G = 25

const n0 = (v: number) => Math.round(v).toLocaleString('en-GB')
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${n0(Math.abs(v))}`
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

/** "Sat 11.10.2026" or "Sat 11.10.2026 and Sun 12.10.2026", or "4 days, the latest Sun 12.10.2026". */
function dateList(dates: string[]): string {
  if (dates.length === 0) return ''
  if (dates.length === 1) return formatWeekdayDate(dates[0])
  if (dates.length === 2) return `${formatWeekdayDate(dates[0])} and ${formatWeekdayDate(dates[1])}`
  return `${days(dates.length)}, the latest ${formatWeekdayDate(dates[dates.length - 1])}`
}

function dayFacts(d: PeriodDay, t: { calories: number; protein: number }): string {
  const kcal = t.calories > 0 ? `${n0(d.kcal)} kcal (${signed(d.kcal - t.calories)})` : `${n0(d.kcal)} kcal`
  const protein = t.protein > 0 && d.protein < t.protein ? `${n0(d.protein)} g protein (${signed(d.protein - t.protein)})` : `${n0(d.protein)} g protein`
  return `${kcal} · ${protein}`
}

export function buildFindings({ summary: s, targets: t, goal, weightKg }: FindingsInput): Finding[] {
  const out: Finding[] = []
  const n = s.counted.length
  if (!s.avg || n === 0) return out
  const avg = s.avg

  // Calories: the average against the target, judged by the goal.
  if (t.calories > 0) {
    const diff = avg.kcal - t.calories
    const share = diff / t.calories
    const value = `${n0(avg.kcal)} / ${n0(t.calories)} kcal`
    if (Math.abs(share) <= AVG_ON_TARGET) {
      out.push({ key: 'calories', label: 'Calories', value, tone: 'success',
        sentence: `On target on average; ${s.kcalOnTargetDays} of ${days(n)} within 10%. Keep it up.` })
    } else if (diff > 0) {
      const sentence = `${n0(diff)} kcal a day over target; ${s.kcalOverDays} of ${days(n)} were 10%+ over. `
        + (goal === 'gain' ? 'A little over is fine while gaining.'
          : goal === 'cut' ? 'That slows the cut — the red bars are the days to plan better.'
            : 'Kept up, that adds weight — the red bars show which days.')
      out.push({ key: 'calories', label: 'Calories', value, tone: goal === 'gain' ? 'neutral' : 'warn', sentence })
    } else {
      const sentence = `${n0(-diff)} kcal a day under target; ${s.kcalUnderDays} of ${days(n)} were 10%+ under. `
        + (goal === 'gain' ? 'That slows the gain — add a snack on the low days.'
          : goal === 'cut' ? 'More deficit than planned — fine while energy and training hold up.'
            : 'Kept up, you will slowly lose weight.')
      out.push({ key: 'calories', label: 'Calories', value, tone: goal === 'cut' ? 'neutral' : 'warn', sentence })
    }
  }

  // Protein: how many days reached the target, and how far the others fell short.
  if (t.protein > 0) {
    const value = `${n0(avg.protein)} / ${n0(t.protein)} g`
    const hit = s.proteinHitDays
    if (hit === n) {
      out.push({ key: 'protein', label: 'Protein', value, tone: 'success', sentence: `Target reached on all ${days(n)} — this protects your muscle.` })
    } else {
      const short = s.proteinShortG ?? 0
      const shakes = Math.round(short / SHAKE_PROTEIN_G)
      const fix = shakes < 1 ? 'almost there' : `about ${shakes === 1 ? 'one protein shake' : `${shakes} protein shakes`}`
      out.push({
        key: 'protein', label: 'Protein', value, tone: hit / n >= 0.7 ? 'neutral' : 'warn',
        sentence: `Target reached on ${hit} of ${days(n)}; the other days were ${n0(short)} g short on average — ${fix}.`,
      })
    }
  }

  // Logging: gaps and half-logged days, and whether the averages can be trusted.
  {
    const need = Math.ceil(s.period * RELIABLE_SHARE)
    const parts: string[] = []
    if (s.gaps.length) parts.push(`Not logged: ${dateList(s.gaps)}.`)
    if (s.halfDays.length) parts.push(`Under ${n0(s.halfCutoff)} kcal, so probably not fully logged and left out of the averages: ${dateList(s.halfDays)}.`)
    if (!parts.length) parts.push('Every day logged — these averages are solid.')
    else if (n < need) parts.push(`With ${n} full ${n === 1 ? 'day' : 'days'} the averages are a rough guide; ${need} make them reliable.`)
    out.push({
      key: 'logging', label: 'Days logged', value: `${s.loggedDays} of ${s.period}`,
      tone: !s.gaps.length && !s.halfDays.length ? 'success' : n < need ? 'warn' : 'neutral',
      sentence: parts.join(' '),
    })
  }

  // Weekdays vs weekends.
  if (s.weekend) {
    const { weekendKcal, weekdayKcal, gap } = s.weekend
    const big = Math.abs(gap) > WEEKEND_GAP_KCAL
    const same = Math.abs(gap) <= WEEKEND_SAME_KCAL
    out.push({
      key: 'weekend', label: 'Weekends', value: `${signed(gap)} kcal`,
      tone: same ? 'success' : big && gap > 0 && goal !== 'gain' ? 'warn' : 'neutral',
      sentence: same
        ? `Weekends (${n0(weekendKcal)} kcal) look like weekdays (${n0(weekdayKcal)}) — no weekend drift.`
        : gap > 0
          ? `Weekend days average ${n0(weekendKcal)} kcal, weekdays ${n0(weekdayKcal)} — about ${n0(gap * 2)} kcal extra a week${big && goal !== 'gain' ? '; planning one weekend meal ahead helps most' : ''}.`
          : `Weekend days average ${n0(weekendKcal)} kcal, ${n0(-gap)} less than weekdays (${n0(weekdayKcal)}).`,
    })
  }

  // Fibre and fat only when they are low — fine values sit in the per-day line.
  if (avg.fiber < FIBER_LOW) {
    out.push({
      key: 'fiber', label: 'Fibre', value: `${n0(avg.fiber)} g a day`, tone: avg.fiber < 20 ? 'warn' : 'neutral',
      sentence: `Below the 25–30 g most guidelines advise. Vegetables, oats, beans or berries add it${goal === 'cut' ? ' — and keep you full on a cut' : ''}.`,
    })
  }
  if (weightKg && weightKg > 0 && avg.fat < FAT_FLOOR_G_PER_KG * weightKg) {
    const floor = FAT_FLOOR_G_PER_KG * weightKg
    out.push({
      key: 'fat', label: 'Fat', value: `${n0(avg.fat)} g a day`, tone: 'warn',
      sentence: `Under ~${n0(floor)} g (0.6 g per kg), the least for hormone health. Eggs, fish, nuts or olive oil close it.`,
    })
  }

  // The best and the hardest day.
  if (s.best && s.hardest) {
    out.push({ key: 'best', label: 'Best day', value: formatWeekdayDate(s.best.date), tone: 'success', date: s.best.date,
      sentence: `${dayFacts(s.best, t)} — closest to both targets.` })
    out.push({ key: 'hardest', label: 'Hardest day', value: formatWeekdayDate(s.hardest.date), tone: 'neutral', date: s.hardest.date,
      sentence: `${dayFacts(s.hardest, t)} — furthest from them.` })
  }
  return out
}
