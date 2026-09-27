import type { Period } from './PeriodToggle'

export interface MiniMetricConfig {
  metric: string
  title: string
  unit: string
  decimals: number
  /** Shown in an info bubble next to the title, not as a permanent paragraph. */
  description: string
  // Shows how many times it happened on the viewed day alongside the main
  // value — for metrics where "how many times" matters as much as the total
  // (e.g. toothbrushing).
  showTodayCount?: boolean
  // Lists the time-of-day of each occurrence on the viewed day (e.g.
  // "08:44, 23:03") — for metrics where WHEN it happened is useful.
  showTodayTimes?: boolean
  /** Show the reading against the median of your previous 60 nights instead
   *  of the absolute value (how Apple shows wrist temperature). */
  deviation?: boolean
}

export interface MiniMetricWindow {
  from: string
  to: string
  period: Period
}

// The compact cards, grouped by the metric ranking's sections
// (docs/training-health/research/research-rank.json). Tier-3 metrics only —
// the tier-1/2 ones have full charts — and each grid hides itself when none of
// its metrics has data in the window. Tier 4 (push count, UV, ambient noise,
// headphone audio, mindful minutes, handwashing, HealthKit nutrition) is
// deliberately not shown; the rows still land in health_metrics and keep their
// aggregation rules. Running dynamics and cycling distance belong to a single
// workout, so they live in the workout detail, not as permanent cards.

export const ACTIVITY_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'flights_climbed', title: 'Flights climbed', unit: 'floors', decimals: 0,
    description: 'Equivalent flights of stairs climbed. About 5 a day (roughly 50 steps) is a common everyday target.' },
  { metric: 'apple_stand_hour', title: 'Stand hours', unit: 'h', decimals: 0,
    description: 'Hours with at least a minute of standing and moving — a count of sitting breaks, not exercise. Apple’s target is 12.' },
  { metric: 'apple_stand_time', title: 'Stand time', unit: 'min', decimals: 0,
    description: 'Total minutes spent standing or moving.' },
]

export const MOBILITY_METRICS: MiniMetricConfig[] = [
  { metric: 'walking_speed', title: 'Walking speed', unit: 'km/h', decimals: 2,
    description: 'Your usual pace while walking. At or above 1.0 m/s (3.6 km/h) is the usual healthy-gait line (Studenski 2011); only a sustained decline matters.' },
  { metric: 'walking_step_length', title: 'Step length', unit: 'cm', decimals: 1,
    description: 'Distance per step — tends to shorten with fatigue, age or injury.' },
  { metric: 'walking_asymmetry_percentage', title: 'Walking asymmetry', unit: '%', decimals: 1,
    description: 'How unevenly your left and right steps land; 0% is perfectly even. A sustained rise from your own baseline is the signal.' },
  { metric: 'walking_double_support_percentage', title: 'Double support', unit: '%', decimals: 1,
    description: 'Share of each walking cycle with both feet on the ground — lower generally means steadier walking.' },
  { metric: 'stair_speed_up', title: 'Stair speed up', unit: 'm/s', decimals: 2,
    description: 'How fast you climb stairs.' },
  { metric: 'stair_speed_down', title: 'Stair speed down', unit: 'm/s', decimals: 2,
    description: 'How fast you descend stairs — a balance and mobility indicator.' },
  { metric: 'six_minute_walking_test_distance', title: '6-minute walk', unit: 'm', decimals: 0,
    description: 'Apple’s estimate of how far you could walk in six minutes — a standard clinical mobility measure, updated occasionally.' },
]

export const CARDIO_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'cardio_recovery', title: 'Cardio recovery', unit: 'bpm', decimals: 0,
    description: 'How far your heart rate drops in the minute after a workout — higher is fitter. Compare like with like (the same kind of workout); a drop of 12 bpm or less was linked to higher mortality (Cole 1999).' },
  { metric: 'physical_effort', title: 'Physical effort', unit: 'MET', decimals: 2,
    description: 'Apple’s estimate of the metabolic intensity of your movement (1 MET = resting).' },
]

// Blood oxygen, respiratory rate and wrist temperature moved to Heart &
// overnight vitals as full trends against your own range.
export const SLEEP_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'breathing_disturbances', title: 'Breathing disturbances', unit: 'count', decimals: 1,
    description: 'Apple’s nightly count of interruptions in your breathing — a screening signal, never a diagnosis. Apple flags a pattern as elevated only over 30 nights.' },
]

export const HABIT_METRICS: MiniMetricConfig[] = [
  { metric: 'time_in_daylight', title: 'Time in daylight', unit: 'min', decimals: 0,
    description: 'Minutes in outdoor daylight — linked to sleep timing and mood. In Norway it swings hugely with the season.' },
  { metric: 'toothbrushing', title: 'Toothbrushing', unit: 's', decimals: 0, showTodayCount: true, showTodayTimes: true,
    description: 'Time spent brushing. The usual advice is twice a day, two minutes each.' },
]
