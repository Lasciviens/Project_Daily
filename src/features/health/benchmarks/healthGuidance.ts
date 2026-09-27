// Plain-language health insights from the numbers the app already has —
// including "what your training does for your health that you may not know".
// PURE and import-free (sibling pure modules only). Deterministic: the same
// input always gives the same list, in the same order. Every sentence is
// population evidence phrased as an association, never a diagnosis.
import { SRC } from './sources'
import { fmt } from './classifyKit'
import {
  classify, computeBmi, computeWaistToHeight, heartRateZones, moderateEquivalentMinutes, vo2Explain,
} from './healthBenchmarks'
import type { BenchmarkTone, Classification, Sex, Source } from './types'

export const HEALTH_DISCLAIMER =
  'General information from large population studies — associations, not predictions, and not medical advice or a diagnosis. Watch readings carry measurement error. If a number worries you or you have symptoms, talk to a doctor.'

export interface HealthInsightInput {
  age: number | null
  sex: Sex | null
  heightCm: number | null
  /** Latest VO2 max, ml/kg/min. */
  vo2max?: number | null
  /** 7-day median resting heart rate, bpm. */
  restingHr?: number | null
  /** Personal 60-day median resting heart rate, bpm. */
  restingHrBaseline?: number | null
  /** 7-day mean HRV (SDNN), ms. */
  hrvSdnn?: number | null
  /** Personal 60-day HRV mean and SD, ms. */
  hrvBaseline?: { mean: number; sd: number } | null
  avgSteps7?: number | null
  /** 7-day mean hours asleep per night. */
  avgSleepH7?: number | null
  /** Spread (SD) of wake time over the last 7–14 nights, minutes. */
  sleepRegularity?: number | null
  bodyFatPct?: number | null
  weightKg?: number | null
  waistCm?: number | null
  weeklyModerateMin?: number | null
  weeklyVigorousMin?: number | null
  strengthDaysPerWeek?: number | null
  /** Weekly minutes of strength training (e.g. from Hevy workout durations). */
  strengthMinPerWeek?: number | null
  cardioSessionsPerWeek?: number | null
}

export interface Insight {
  id: string
  tone: BenchmarkTone
  title: string
  /** What the numbers say, one or two sentences. */
  text: string
  /** Why it matters — the evidence behind it. */
  why: string
  /** One concrete next step, or null when there's nothing to change. */
  action: string | null
  sources: Source[]
}

/** Display order: needs attention → your own readings → general tips → reassurance. Stable within a tone. */
export const INSIGHT_TONE_ORDER: Record<BenchmarkTone, number> = { danger: 0, warn: 1, neutral: 2, info: 3, success: 4 }

const has = (v: number | null | undefined): v is number => v != null && Number.isFinite(v)
const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

function fromClassification(id: string, title: string, c: Classification, text: string, action: string | null): Insight {
  return { id, tone: c.tone, title, text, why: c.meaning, action, sources: c.sources }
}

export function buildHealthInsights(input: HealthInsightInput): Insight[] {
  const ctx = { age: input.age, sex: input.sex, heightCm: input.heightCm }
  const out: Insight[] = []
  const zones = heartRateZones(input.age)
  const intervalBpm = zones ? ` (${zones.intervals[0]}–${zones.intervals[1]} bpm for you)` : ''

  // ── Cardio fitness ──────────────────────────────────────────────────────
  const vo2 = has(input.vo2max) ? vo2Explain(input.vo2max, { ...ctx, weightKg: input.weightKg }) : null
  const vo2BelowAverage = vo2 != null && (vo2.gapToAverage != null || (vo2.average == null && vo2.classification.band !== 'high'))
  if (vo2) {
    const where = vo2.percentile != null && vo2.ageGroup
      ? `around the ${vo2.percentile}th percentile for ${vo2.ageGroup.toLowerCase()} (average ${fmt(vo2.average ?? 0, 1)})`
      : `${fmt(vo2.mets, 1)} METs — ${vo2.category.toLowerCase()}`
    out.push({
      id: 'vo2-standing',
      tone: vo2.classification.tone,
      title: `Cardio fitness: ${vo2.category.toLowerCase()}`,
      text: `Your latest VO2 max of ${fmt(vo2.value, 1)} ml/kg/min is ${where}. Apple's estimate has a typical error of about ±7, so the trend matters more than one reading.`,
      why: vo2.classification.meaning,
      action: vo2BelowAverage
        ? `Build to 3 cardio sessions a week with 1–2 of them intervals, e.g. 4 × 4 min at 90–95% of max heart rate${intervalBpm}. Expect about +3 to +6 ml/kg/min in 8–12 weeks.`
        : 'Keep 2–3 cardio sessions a week to hold it.',
      sources: [...vo2.classification.sources, SRC.milanovic2015, SRC.helgerud2007, SRC.lambe2026],
    })
  }
  if (!vo2 || vo2BelowAverage || vo2.classification.band === 'above_average') {
    out.push({
      id: 'vo2-modifiable',
      tone: 'info',
      title: 'Fitness is the risk marker you can move fastest',
      text:
        'In 122,007 treadmill tests, being in the bottom quarter for fitness (5× the mortality of the fittest group) carried more risk than smoking (1.41×), diabetes (1.40×) or coronary disease (1.29×) — and VO2 max responds to training within weeks.',
      why:
        'Each 1 MET (3.5 ml/kg/min) more fitness is linked to about 13% lower all-cause mortality (Kodama 2009), and across 20.9 million observations high fitness went with about half the mortality of low fitness (Lang 2024, HR 0.47).',
      action: vo2 ? null : 'Do an outdoor walk, run or hike with your watch now and then — Apple only estimates VO2 max from those.',
      sources: [SRC.mandsager2018, SRC.kodama2009, SRC.lang2024, SRC.appleCardio],
    })
  }

  // ── Strength training ───────────────────────────────────────────────────
  const days = input.strengthDaysPerWeek
  const aerobicKnown = has(input.weeklyModerateMin) || has(input.weeklyVigorousMin)
  const aerobic = moderateEquivalentMinutes(input.weeklyModerateMin, input.weeklyVigorousMin)
  if (has(days)) {
    if (days >= 1) {
      const mins = has(input.strengthMinPerWeek) ? ` You log about ${fmt(input.strengthMinPerWeek)} min a week.` : ''
      out.push({
        id: 'strength-health',
        tone: 'success',
        title: 'Your lifting already protects your health',
        text:
          `In 16 cohorts, muscle-strengthening activity was linked to 10–17% lower risk of death, cardiovascular disease, cancer and diabetes; the strongest association sat at about 30–60 minutes a week.${mins}`,
        why:
          'Past about an hour a week the extra health benefit is unclear — not harmful — so more lifting is for strength and physique goals (Momma 2022). WHO recommends muscle strengthening on 2 or more days a week.',
        action: days < 2 ? 'A second strength day a week meets the WHO guideline.' : null,
        sources: [SRC.momma2022, SRC.who2020],
      })
    } else {
      out.push({
        id: 'strength-health',
        tone: 'warn',
        title: 'No strength training this week',
        text: 'Muscle-strengthening activity was linked to 10–17% lower risk of death, cardiovascular disease, cancer and diabetes (Momma 2022).',
        why: 'Going from none to some is the biggest single step; WHO recommends 2 or more days a week covering all major muscle groups.',
        action: 'Plan two short full-body sessions this week.',
        sources: [SRC.momma2022, SRC.who2020],
      })
    }
  }

  if (has(days) && days >= 1 && aerobicKnown) {
    const met = aerobic >= 150
    out.push({
      id: 'lifting-plus-cardio',
      tone: met ? 'success' : 'info',
      title: met ? 'You combine lifting and cardio — the strongest pattern' : 'Lifting plus cardio is linked to about twice the benefit',
      text:
        `In 11 studies (370,256 people), resistance training alone was linked to 21% lower mortality and resistance plus aerobic exercise to 40% lower (Saeidifard 2019). You log about ${fmt(aerobic)} moderate-equivalent aerobic minutes a week; WHO recommends 150–300.`,
      why: 'WHO 2020 recommends both. In these studies, people who did both had clearly lower mortality than people who only lifted.',
      action: met ? null : `Add about ${fmt(150 - aerobic)} min a week of brisk walking, cycling or intervals.`,
      sources: [SRC.saeidifard2019, SRC.who2020],
    })
  } else if (aerobicKnown) {
    const c = classify('weekly_exercise_minutes', aerobic, ctx)!
    out.push(fromClassification('weekly-activity', `Weekly activity: ${fmt(aerobic)} min`, c,
      `${c.label}. ${c.referenceText}`,
      c.nextStep ? `Add about ${fmt(c.nextStep.gap)} min a week to reach ${lcFirst(c.nextStep.label)}.` : null))
  }

  if (has(days) && days >= 2 && !(has(input.cardioSessionsPerWeek) && input.cardioSessionsPerWeek >= 3)) {
    out.push({
      id: 'cardio-no-interference',
      tone: 'info',
      title: 'Cardio won’t cost you muscle',
      text:
        'Across 43 studies, adding cardio to lifting did not reduce muscle growth or maximal strength; only explosive power was slightly blunted, mostly when both were done in the same session (Schumann 2022).',
      why: 'Long running interfered more than cycling in an earlier meta-analysis (Wilson 2012), so cycling is the easiest fit next to heavy leg work.',
      action: 'Keep hard cardio and heavy leg sessions about 3 hours apart, or on different days.',
      sources: [SRC.schumann2022, SRC.wilson2012],
    })
  }

  if (vo2BelowAverage) {
    out.push({
      id: 'cardio-intensity',
      tone: 'info',
      title: 'Some harder cardio moves VO2 max faster',
      text:
        'Interval training added about 5.5 ml/kg/min against 4.9 for steady endurance work (Milanović 2015). A 2025 review found no support for "Zone 2" as the optimal intensity — higher intensities matter most when weekly time is limited (Storoschuk 2025).',
      why: 'Easy cardio is still useful and low-fatigue for a lifter; it just isn’t the fastest route to a higher VO2 max.',
      action: `Make one weekly cardio session intervals${intervalBpm}.`,
      sources: [SRC.milanovic2015, SRC.storoschuk2025, SRC.helgerud2007],
    })
  }

  if (zones) {
    out.push({
      id: 'heart-rate-zones',
      tone: 'info',
      title: 'Your heart-rate zones',
      text:
        `Estimated max heart rate about ${zones.hrMax} bpm (208 − 0.7 × age). Moderate (64–76%): ${zones.moderate[0]}–${zones.moderate[1]} bpm. Vigorous (77–95%): ${zones.vigorous[0]}–${zones.vigorous[1]} bpm. Intervals (90–95%): ${zones.intervals[0]}–${zones.intervals[1]} bpm.`,
      why: 'These zones are what the WHO moderate and vigorous targets mean in heart-rate terms. If you have seen a higher heart rate in a hard effort, use that as your max instead.',
      action: null,
      sources: [SRC.tanaka2001, SRC.garber2011, SRC.helgerud2007],
    })
  }

  // ── Everyday movement and sleep ─────────────────────────────────────────
  if (has(input.avgSteps7)) {
    const c = classify('step_count', input.avgSteps7, ctx)!
    out.push(fromClassification('steps', `Steps: ${fmt(input.avgSteps7)} a day`, c,
      `${c.label} (7-day average). ${c.referenceText}`,
      c.nextStep
        ? `About ${fmt(c.nextStep.gap)} more steps a day — roughly ${fmt(Math.ceil(c.nextStep.gap / 100))} minutes of walking — reaches ${c.nextStep.label}.`
        : null))
  }

  if (has(input.avgSleepH7)) {
    const c = classify('sleep_duration', input.avgSleepH7, ctx)!
    const short = input.avgSleepH7 < 7
    const lossEvidence =
      'after nights of 6 h or less, performance — strength included — dropped about 7.6% on average (Craven 2022), and one sleepless night cut muscle protein synthesis by 18% (Lamon 2021).'
    out.push({
      id: 'sleep-duration',
      tone: c.tone,
      title: `Sleep: ${fmt(input.avgSleepH7, 1)} h a night`,
      text: input.avgSleepH7 < 6
        ? `Short sleep undercuts training: ${lossEvidence}`
        : short
          ? `Just under the 7 h guideline (7-day average). Sleep protects training: ${lossEvidence}`
          : `${c.label} (7-day average) — the recovery the evidence supports.`,
      why: short
        ? `In a small diet study, 5.5 h instead of 8.5 h in bed meant 60% more of the weight lost came from lean mass (Nedeltcheva 2010). ${c.meaning}`
        : c.meaning,
      action: short
        ? 'Fix your wake time and move bedtime earlier until the average reaches 7 h. On short nights, train earlier in the day and skip max-effort attempts — afternoon performance suffered most.'
        : null,
      sources: short ? [...c.sources, SRC.craven2022, SRC.lamon2021, SRC.nedeltcheva2010] : c.sources,
    })
  }

  if (has(input.sleepRegularity)) {
    const c = classify('sleep_regularity', input.sleepRegularity, ctx)!
    out.push(fromClassification('sleep-regularity', `Sleep timing: ${c.label.toLowerCase()}`, c,
      `Your wake time varies by about ±${fmt(input.sleepRegularity)} min. ${c.referenceText}`,
      c.band === 'regular' ? null : 'Wake at the same time every day, weekends included, and let bedtime follow.'))
  }

  // ── Heart ───────────────────────────────────────────────────────────────
  if (has(input.restingHr)) {
    const rise = has(input.restingHrBaseline) ? input.restingHr - input.restingHrBaseline : null
    if (rise != null && rise >= 5) {
      out.push({
        id: 'resting-hr-rise',
        tone: 'warn',
        title: `Resting heart rate is up ${fmt(rise)} bpm on your baseline`,
        text: `${fmt(input.restingHr)} bpm this week against your usual ${fmt(input.restingHrBaseline!)}.`,
        why: 'Illness, alcohol, heat, dehydration, short sleep and hard training all raise it for a few days. A rise of 5 bpm or more over your own median is a common fatigue signal in training monitoring — a convention, not a diagnosis.',
        action: 'Take an easier day and check again in a couple of days; if it stays up and you feel unwell, talk to a doctor.',
        sources: [SRC.reimers2018, SRC.appleWatchHrv2024],
      })
    } else {
      const c = classify('resting_heart_rate', input.restingHr, ctx)!
      out.push(fromClassification('resting-hr', `Resting heart rate: ${fmt(input.restingHr)} bpm`, c,
        `${c.label}. ${c.referenceText}`,
        c.band === 'low' ? null : 'Regular endurance training is the lever — about 6 bpm lower in men in the trials (Reimers 2018).'))
    }
  }

  if (has(input.hrvSdnn)) {
    const c = classify('heart_rate_variability', input.hrvSdnn, { ...ctx, baseline: input.hrvBaseline ?? null })
    if (c) {
      out.push(fromClassification('hrv', `HRV: ${fmt(input.hrvSdnn)} ms`, c, `${c.label}. ${c.referenceText}`,
        c.band === 'below_baseline' ? 'If it stays low for several days, ease off training and prioritise sleep.' : null))
    }
  }

  // ── Body ────────────────────────────────────────────────────────────────
  const whtr = computeWaistToHeight(input.waistCm, input.heightCm)
  const whtrC = whtr != null ? classify('waist_to_height', whtr, ctx) : null
  if (whtrC && whtr != null) {
    out.push(fromClassification('waist-to-height', `Waist-to-height: ${fmt(whtr, 2)}`, whtrC, `${whtrC.label}. ${whtrC.referenceText}`,
      whtrC.nextStep ? `Aim for ${lcFirst(whtrC.nextStep.label)}.` : null))
  }

  if (has(input.bodyFatPct)) {
    const c = classify('body_fat_percentage', input.bodyFatPct, ctx)
    if (c) {
      out.push(fromClassification('body-fat', `Body fat: ${fmt(input.bodyFatPct, 1)}%`, c, `${c.label}. ${c.referenceText}`,
        c.nextStep ? `Aim for ${lcFirst(c.nextStep.label)} — about ${fmt(c.nextStep.gap, 1)} percentage points. Compare readings from the same scale in the same conditions.` : null))
    }
  }

  const bmi = computeBmi(input.weightKg, input.heightCm)
  if (bmi != null) {
    const c = classify('bmi', bmi, ctx)!
    const leanByWaist = whtrC?.band === 'healthy' && bmi >= 25
    out.push(leanByWaist
      ? {
          id: 'bmi',
          tone: 'neutral',
          title: `BMI ${fmt(bmi, 1)} — but your waist says healthy`,
          text: 'BMI counts muscle as weight. Your waist-to-height ratio is in the healthy range, which NICE treats as the better check for muscular people.',
          why: c.meaning,
          action: null,
          sources: [...c.sources, SRC.ashwell2012],
        }
      : fromClassification('bmi', `BMI: ${fmt(bmi, 1)}`, c, `${c.label}. ${c.referenceText}`,
          c.nextStep && whtr == null ? 'If you lift, measure your waist too — waist-to-height is the better check for muscular people.' : null))
  }

  return out
    .map((insight, i) => ({ insight, i }))
    .sort((a, b) => INSIGHT_TONE_ORDER[a.insight.tone] - INSIGHT_TONE_ORDER[b.insight.tone] || a.i - b.i)
    .map(({ insight }) => insight)
}
