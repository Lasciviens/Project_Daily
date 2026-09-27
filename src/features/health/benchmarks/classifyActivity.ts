// Movement and sleep metrics: steps, weekly activity, strength days/minutes,
// walking speed, sleep duration and regularity. Pure, import-free apart from
// sibling data.
import { SRC } from './sources'
import { WALK_BOHANNON_MEN, rowForAge } from './referenceTables'
import { adultAge, ageBandName, build, fmt, nextStep } from './classifyKit'
import type { BenchmarkContext, Classification } from './types'

// ─── Steps ──────────────────────────────────────────────────────────────────

const STEPS_EVIDENCE =
  'Compared with about 3,500 steps a day, about 5,800 was linked to 40% lower mortality, 7,800 to 45% lower and 10,900 to 53% lower (Paluch 2022). Each extra 1,000 steps a day was linked to about 15% lower all-cause mortality (Banach 2023).'

export function classifySteps(v: number, ctx: BenchmarkContext): Classification {
  const age = adultAge(ctx.age)
  const older = age != null && age >= 60
  const plateauStart = older ? 6000 : 8000
  const plateauEnd = older ? 8000 : 10000
  const reference = age == null
    ? 'Benefit levels off at about 8,000–10,000 steps a day under 60 and 6,000–8,000 from 60 (Paluch 2022). Add your birth year for your band.'
    : older
      ? 'From 60: the benefit keeps rising up to about 6,000–8,000 steps a day, then levels off (Paluch 2022).'
      : 'Under 60: the benefit keeps rising up to about 8,000–10,000 steps a day, then levels off (Paluch 2022).'
  const sources = [SRC.paluch2022, SRC.banach2023, SRC.ding2025]
  const plateau = `${fmt(plateauStart)}–${fmt(plateauEnd)}`

  if (v < 4000) {
    return build('step_count', { band: 'very_low', label: 'Very low', tone: 'danger' }, {
      referenceText: reference, sources,
      nextStep: nextStep('step_count', '4,000 steps a day', 4000, v),
      meaning: `Under 4,000 steps a day was the highest-risk group in the cohort studies; this is where extra walking pays most. ${STEPS_EVIDENCE}`,
    })
  }
  if (v < 6000) {
    return build('step_count', { band: 'low', label: 'Low', tone: 'warn' }, {
      referenceText: reference, sources,
      nextStep: nextStep('step_count', older ? `${fmt(plateauStart)} — start of the plateau for your age` : '6,000 steps a day', 6000, v),
      meaning: STEPS_EVIDENCE,
    })
  }
  if (v < plateauStart) {
    return build('step_count', { band: 'moderate', label: 'Moderate', tone: 'neutral' }, {
      referenceText: reference, sources,
      nextStep: nextStep('step_count', `${fmt(plateauStart)} — start of the plateau for your age`, plateauStart, v),
      meaning: STEPS_EVIDENCE,
    })
  }
  if (v < plateauEnd) {
    return build('step_count', { band: 'plateau', label: `In the plateau zone (${plateau})`, tone: 'success' }, {
      referenceText: reference, sources,
      meaning: `You're where most of the observed benefit has already arrived. ${STEPS_EVIDENCE}`,
    })
  }
  return build('step_count', { band: 'above_plateau', label: 'Above the plateau', tone: 'success' }, {
    referenceText: reference, sources,
    meaning: `Fine to keep, but the extra benefit past ${fmt(plateauEnd)} a day was small in the studies. ${STEPS_EVIDENCE}`,
  })
}

// ─── Weekly activity (moderate-equivalent minutes) ──────────────────────────

/** WHO: 1 vigorous minute counts as 2 moderate minutes. */
export function moderateEquivalentMinutes(moderate: number | null | undefined, vigorous: number | null | undefined): number {
  return Math.max(0, moderate ?? 0) + 2 * Math.max(0, vigorous ?? 0)
}

export function classifyWeeklyExercise(v: number): Classification {
  const reference =
    'WHO 2020: 150–300 min of moderate or 75–150 min of vigorous activity a week (1 vigorous minute counts as 2), plus muscle strengthening on 2 or more days.'
  const evidence =
    'Compared with no activity, doing some but less than the guideline was linked to 20% lower mortality, meeting it (1–2×) to 31% lower and 3–5× the minimum to 39% lower, where the benefit levels off; 10× showed no harm (Arem 2015).'
  const sources = [SRC.who2020, SRC.arem2015]
  if (v <= 0) {
    return build('weekly_exercise_minutes', { band: 'inactive', label: 'Inactive', tone: 'warn' }, {
      referenceText: reference, sources,
      nextStep: nextStep('weekly_exercise_minutes', '150 min a week (WHO minimum)', 150, v),
      meaning: `Some activity is better than none — the first minutes bring the biggest change. ${evidence}`,
    })
  }
  if (v < 150) {
    return build('weekly_exercise_minutes', { band: 'below_guideline', label: 'Below the guideline', tone: 'warn' }, {
      referenceText: reference, sources,
      nextStep: nextStep('weekly_exercise_minutes', '150 min a week (WHO minimum)', 150, v),
      meaning: evidence,
    })
  }
  if (v < 300) {
    return build('weekly_exercise_minutes', { band: 'meets_guideline', label: 'Meets the guideline', tone: 'success' }, {
      referenceText: reference, sources,
      nextStep: nextStep('weekly_exercise_minutes', '300 min a week (top of the WHO range)', 300, v),
      meaning: evidence,
    })
  }
  if (v < 750) {
    return build('weekly_exercise_minutes', { band: 'above_guideline', label: 'Above the guideline', tone: 'success' }, {
      referenceText: reference, sources, meaning: evidence,
    })
  }
  return build('weekly_exercise_minutes', { band: 'well_above', label: 'Well above — benefit has levelled off', tone: 'info' }, {
    referenceText: reference, sources,
    meaning: `More is fine for fitness goals; the health benefit had already levelled off. ${evidence}`,
  })
}

// ─── Strength days / minutes ────────────────────────────────────────────────

export function classifyStrengthDays(v: number): Classification {
  const reference = 'WHO 2020: muscle-strengthening activity for all major muscle groups on 2 or more days a week.'
  const evidence =
    'Muscle-strengthening activity was linked to 10–17% lower risk of death, cardiovascular disease, cancer and diabetes (Momma 2022).'
  const sources = [SRC.who2020, SRC.momma2022]
  if (v < 1) {
    return build('strength_days', { band: 'none', label: 'None', tone: 'warn' }, {
      referenceText: reference, sources,
      nextStep: nextStep('strength_days', '2 days a week', 2, v),
      meaning: `Going from none to some is the biggest single step. ${evidence}`,
    })
  }
  if (v < 2) {
    return build('strength_days', { band: 'once', label: 'Once a week', tone: 'neutral' }, {
      referenceText: reference, sources,
      nextStep: nextStep('strength_days', '2 days a week', 2, v),
      meaning: evidence,
    })
  }
  return build('strength_days', { band: 'meets_guideline', label: 'Meets the guideline', tone: 'success' }, {
    referenceText: reference, sources, meaning: evidence,
  })
}

export function classifyStrengthMinutes(v: number): Classification {
  const reference = 'Strongest observed association: about 30–60 min of muscle-strengthening a week (Momma 2022).'
  const evidence =
    'The curve peaked at about 30–60 minutes a week — about 10–20% lower risk of death, cardiovascular disease and cancer — and the benefit of more is unclear, not harmful (Momma 2022). Lifting plus aerobic exercise was linked to about 40% lower mortality, lifting alone about 21% (Saeidifard 2019).'
  const sources = [SRC.momma2022, SRC.saeidifard2019]
  if (v <= 0) {
    return build('strength_minutes', { band: 'none', label: 'None', tone: 'warn' }, {
      referenceText: reference, sources,
      nextStep: nextStep('strength_minutes', '30 min a week', 30, v), meaning: evidence,
    })
  }
  if (v < 30) {
    return build('strength_minutes', { band: 'some', label: 'Some', tone: 'neutral' }, {
      referenceText: reference, sources,
      nextStep: nextStep('strength_minutes', '30 min a week', 30, v), meaning: evidence,
    })
  }
  if (v <= 60) {
    return build('strength_minutes', { band: 'sweet_spot', label: 'In the range with the strongest benefit', tone: 'success' }, {
      referenceText: reference, sources, meaning: evidence,
    })
  }
  return build('strength_minutes', { band: 'beyond', label: 'Beyond 60 min — health benefit covered', tone: 'info' }, {
    referenceText: reference, sources,
    meaning: `Past an hour a week the extra time serves strength and physique goals; it is not a health risk. ${evidence}`,
  })
}

// ─── Walking speed (input km/h, as Apple Health shows it) ───────────────────

const KMH_PER_MS = 3.6

export function classifyWalkingSpeed(kmh: number, ctx: BenchmarkContext): Classification {
  const ms = kmh / KMH_PER_MS
  const age = adultAge(ctx.age)
  const sources = [SRC.studenski2011, SRC.bohannon2011]
  const survival = 'In adults over 65, each 0.1 m/s faster usual pace went with 12% lower mortality (Studenski 2011, HR 0.88).'

  if (age != null && age >= 65) {
    const reference =
      '65+: under 0.6 m/s (2.2 km/h) is linked to poorer health, about 0.8 m/s (2.9 km/h) to median life expectancy, and 1.0 m/s (3.6 km/h) or faster to longer-than-expected survival (Studenski 2011).'
    const step = (targetMs: number, label: string) => nextStep('walking_speed', label, targetMs * KMH_PER_MS, kmh)
    if (ms < 0.6) {
      return build('walking_speed', { band: 'slow', label: 'Slow', tone: 'warn' }, {
        referenceText: reference, sources, nextStep: step(0.6, '0.6 m/s (2.2 km/h)'), meaning: survival,
      })
    }
    if (ms < 0.8) {
      return build('walking_speed', { band: 'below_median', label: 'Below the median for your age', tone: 'warn' }, {
        referenceText: reference, sources, nextStep: step(0.8, '0.8 m/s (2.9 km/h)'), meaning: survival,
      })
    }
    if (ms < 1.0) {
      return build('walking_speed', { band: 'median', label: 'Around the median for your age', tone: 'neutral' }, {
        referenceText: reference, sources, nextStep: step(1.0, '1.0 m/s (3.6 km/h)'), meaning: survival,
      })
    }
    if (ms <= 1.2) {
      return build('walking_speed', { band: 'better_than_expected', label: 'Better than expected for your age', tone: 'success' }, {
        referenceText: reference, sources, meaning: survival,
      })
    }
    return build('walking_speed', { band: 'exceptional', label: 'Exceptional for your age', tone: 'success' }, {
      referenceText: reference, sources,
      meaning: `Above 1.2 m/s was proposed by the authors as a sign of exceptional life expectancy (more research needed). ${survival}`,
    })
  }

  // Under 65 there are no survival thresholds — only what healthy people walk at.
  const menRow = ctx.sex === 'male' && age != null ? rowForAge(WALK_BOHANNON_MEN, age) : null
  const typicalMs = menRow?.row.data ?? null
  const reference = menRow && typicalMs != null
    ? `Men ${ageBandName(menRow.row.min, menRow.row.max, menRow.clamped)}: typical usual pace ${fmt(typicalMs, 2)} m/s (${fmt(typicalMs * KMH_PER_MS, 1)} km/h) (Bohannon 2011).`
    : 'Healthy men under 80 average 1.26–1.43 m/s (4.5–5.1 km/h) at their usual pace (Bohannon 2011).'
  const meaning = `Under 65 a single value matters less than a decline over months. ${survival}`
  if (typicalMs != null && ms >= typicalMs) {
    return build('walking_speed', { band: 'typical_or_faster', label: 'At or above typical for your age', tone: 'success' },
      { referenceText: reference, sources, meaning })
  }
  if (ms >= 1.0) {
    return build('walking_speed', { band: 'normal', label: 'Normal range', tone: 'neutral' }, {
      referenceText: reference, sources, meaning,
      nextStep: typicalMs != null ? nextStep('walking_speed', 'Typical pace for your age', typicalMs * KMH_PER_MS, kmh) : null,
    })
  }
  return build('walking_speed', { band: 'slower', label: 'Slower than typical', tone: 'neutral' }, {
    referenceText: reference, sources, meaning,
    nextStep: nextStep('walking_speed', '1.0 m/s (3.6 km/h)', 1.0 * KMH_PER_MS, kmh),
  })
}

// ─── Sleep ──────────────────────────────────────────────────────────────────

export function classifySleepDuration(hours: number, ctx: BenchmarkContext): Classification {
  const age = adultAge(ctx.age)
  const older = age != null && age >= 65
  const upper = older ? 8 : 9
  const reference =
    `${older ? 'Adults 65+: 7–8 h' : 'Adults 18–64: 7–9 h'} a night (AASM/SRS, National Sleep Foundation). ` +
    'Watch-measured sleep runs below self-reported sleep: healthy adults measured in a sleep lab average 6.2–6.8 h asleep.'
  const evidence =
    'Habitual short sleep was linked to 12% higher mortality and long sleep to 30% higher (Cappuccio 2010, self-reported; long sleep is partly a sign of illness). Regular timing matters too: the most regular sleepers had 20–30% lower mortality after full adjustment (Windred 2024).'
  const sources = [SRC.watson2015, SRC.hirshkowitz2015, SRC.cappuccio2010, SRC.windred2024, SRC.boulos2019]
  if (hours < 6) {
    return build('sleep_duration', { band: 'short', label: 'Short (under 6 h)', tone: 'warn' }, {
      referenceText: reference, sources: [...sources, SRC.craven2022],
      nextStep: nextStep('sleep_duration', '7 h a night', 7, hours),
      meaning: `After nights of 6 h or less, exercise performance — strength included — drops about 7.6% on average (Craven 2022). ${evidence}`,
    })
  }
  if (hours < 7) {
    return build('sleep_duration', { band: 'just_under', label: 'Just under 7 h', tone: 'neutral' }, {
      referenceText: reference, sources,
      nextStep: nextStep('sleep_duration', '7 h a night', 7, hours),
      meaning: `Close to what healthy people actually sleep when measured, but under the 7 h guideline, which is based mostly on self-reported sleep. ${evidence}`,
    })
  }
  if (hours <= upper) {
    return build('sleep_duration', { band: 'recommended', label: 'In the recommended range', tone: 'success' }, {
      referenceText: reference, sources, meaning: evidence,
    })
  }
  return build('sleep_duration', { band: 'long', label: `Long (over ${upper} h)`, tone: 'info' }, {
    referenceText: reference, sources,
    meaning: `Longer sleep can be right when recovering from sleep debt, hard training or illness; otherwise it's unclear whether it carries risk. ${evidence}`,
  })
}

/** Input: the spread (standard deviation) of wake time over the last 7–14 nights, in minutes. */
export function classifySleepRegularity(sdMinutes: number): Classification {
  const reference =
    'The most regular fifth of people in Windred 2024 fell asleep and woke within about 1-hour windows; the least regular within about 3-hour windows. The ±30 / ±60 min lines here are a heuristic reading of that.'
  const evidence =
    'In 60,977 tracker wearers, the more regular sleepers had 20–30% lower mortality after full adjustment, and regularity predicted mortality more strongly than duration (Windred 2024).'
  const sources = [SRC.windred2024]
  if (sdMinutes <= 30) {
    return build('sleep_regularity', { band: 'regular', label: 'Regular', tone: 'success' }, { referenceText: reference, sources, meaning: evidence })
  }
  if (sdMinutes <= 60) {
    return build('sleep_regularity', { band: 'variable', label: 'Somewhat variable', tone: 'neutral' }, {
      referenceText: reference, sources,
      nextStep: nextStep('sleep_regularity', 'Within about ±30 min', 30, sdMinutes), meaning: evidence,
    })
  }
  return build('sleep_regularity', { band: 'irregular', label: 'Irregular', tone: 'warn' }, {
    referenceText: reference, sources,
    nextStep: nextStep('sleep_regularity', 'Within about ±60 min', 60, sdMinutes),
    meaning: `${evidence} Fixing the wake time, weekends included, is the simplest lever.`,
  })
}
