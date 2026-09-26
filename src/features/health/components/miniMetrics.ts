import type { MiniMetricConfig } from './MetricMiniCard'

// Every HealthKit metric Health Auto Export actually sends us that doesn't
// warrant its own full chart, grouped onto the section it's most conceptually
// related to (no dedicated "Activity" page exists, so these ride along under
// Steps/Heart/Sleep/Body as a mini-card matrix below each section's main
// widget).
//
// Audited against the live health_metrics inventory on 2026-09-24 (47 distinct
// metrics in the table vs. what this file renders). Fourteen cards were
// removed for never having received a single row, and six metrics that were
// arriving with no home in the UI were added. A card is only worth existing
// if HealthKit actually feeds it -- see each group's own note.

export const STEPS_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'walking_speed', title: 'Walking Speed', unit: 'km/h', decimals: 2,
    description: 'Average pace while walking — a steady/rising trend usually tracks fitness.' },
  { metric: 'walking_step_length', title: 'Step Length', unit: 'cm', decimals: 1,
    description: 'Distance covered per step — tends to shorten with fatigue, age, or injury.' },
  { metric: 'walking_asymmetry_percentage', title: 'Walk Asymmetry', unit: '%', decimals: 1,
    description: 'How unevenly your left/right steps land — 0% is perfectly symmetric gait.' },
  { metric: 'walking_double_support_percentage', title: 'Double Support', unit: '%', decimals: 1,
    description: 'Share of each walking cycle with both feet on the ground — lower generally means steadier, more confident walking.' },
  { metric: 'stair_speed_up', title: 'Stair Speed Up', unit: 'm/s', decimals: 2,
    description: 'How fast you climb stairs — Apple’s cardio-fitness proxy from the Watch.' },
  { metric: 'stair_speed_down', title: 'Stair Speed Down', unit: 'm/s', decimals: 2,
    description: 'How fast you descend stairs — a balance & mobility indicator.' },
  { metric: 'six_minute_walking_test_distance', title: '6-Min Walk', unit: 'm', decimals: 0,
    description: 'Apple’s estimate of how far you could walk in six minutes — a standard clinical mobility measure, updated occasionally rather than daily.' },
  { metric: 'walking_heart_rate_average', title: 'Walking HR', unit: 'bpm', decimals: 0,
    description: 'Average heart rate during normal walking — trends down as fitness improves.' },
  { metric: 'physical_effort', title: 'Physical Effort', unit: 'MET', decimals: 2,
    description: 'Metabolic intensity of daily movement — higher means more strenuous activity.' },
  { metric: 'apple_stand_time', title: 'Stand Time', unit: 'min', decimals: 0,
    description: 'Total minutes spent standing/moving today — feeds the Stand ring on Overview.' },
  { metric: 'flights_climbed', title: 'Flights Climbed', unit: 'floors', decimals: 0,
    description: 'Equivalent flights of stairs climbed today.' },
  { metric: 'cycling_distance', title: 'Cycling Distance', unit: 'km', decimals: 2,
    description: 'Distance cycled today — only recorded on days the Watch detects a ride.' },
  { metric: 'push_count', title: 'Pushes', unit: 'pushes', decimals: 0,
    description: 'HealthKit "wheelchair push count" — if you don’t use a wheelchair, this is likely misdetected (check Watch Settings → Accessibility → Wheelchair).' },
]

// Nutrition had ten cards here (water, sugar, protein, carbs, fiber, caffeine,
// fat, vitamin D, magnesium, plus Fitbit's Active Zone Minutes). Not one had
// ever received a row: food is logged in this app's own Food tab, which never
// writes to Apple Health, and Active Zone Minutes died with the Fitbit
// integration. The whole group was removed on 2026-09-24 rather than left as
// ten permanent em dashes under Energy.

export const HEART_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'cardio_recovery', title: 'Cardio Recovery', unit: 'bpm', decimals: 0,
    description: 'How much your heart rate drops in the minute after exercise — higher is fitter.' },
  { metric: 'vo2_max', title: 'VO₂ Max', unit: 'ml/kg·min', decimals: 1,
    description: 'Cardio fitness — estimated max oxygen uptake; higher is fitter. Apple estimates it from outdoor walks/runs, so it only updates on those days.' },
  { metric: 'heart_rate_variability', title: 'HRV', unit: 'ms', decimals: 0,
    description: 'Heart rate variability — beat-to-beat variation in SDNN; higher generally reflects better recovery. Mostly captured overnight.' },
]

// Running dynamics — form metrics captured during a run, so they only exist on
// run days (currently two rows each, from 2026-07-05). Kept rather than
// removed: unlike the nutrition group these DO arrive, just rarely.
export const RUNNING_EXTRA_METRICS: MiniMetricConfig[] = [
  { metric: 'running_speed', title: 'Run Speed', unit: 'km/h', decimals: 1,
    description: 'Average running speed on your latest run.' },
  { metric: 'running_power', title: 'Run Power', unit: 'W', decimals: 0,
    description: 'Running power output — effort delivered, like cycling watts.' },
  { metric: 'running_stride_length', title: 'Stride Length', unit: 'm', decimals: 2,
    description: 'Distance covered per running stride.' },
  { metric: 'running_vertical_oscillation', title: 'Vertical Oscillation', unit: 'cm', decimals: 1,
    description: 'How much you bounce vertically per stride — lower is usually more efficient.' },
  { metric: 'running_ground_contact_time', title: 'Ground Contact', unit: 'ms', decimals: 0,
    description: 'Time each foot spends on the ground per stride — lower tends to mean a snappier turnover.' },
]

export const SLEEP_EXTRA_METRICS: MiniMetricConfig[] = [
  // blood_oxygen_saturation, NOT oxygen_saturation. The latter was the
  // Fitbit-era name; it stopped receiving rows on 2026-08-30 when that
  // integration was removed, so this card had been reading a dead metric ever
  // since while the Watch's own readings piled up under the name below.
  { metric: 'blood_oxygen_saturation', title: 'Blood Oxygen', unit: '%', decimals: 0,
    description: 'Overnight SpO2 from the Watch — sustained dips can flag breathing disturbances.' },
  { metric: 'breathing_disturbances', title: 'Breathing Disturbances', unit: 'count', decimals: 1,
    description: 'Apple’s nightly count of interruptions in your breathing — a screening signal, never a diagnosis.' },
  { metric: 'respiratory_rate', title: 'Respiratory Rate', unit: 'br/min', decimals: 1,
    description: 'Breaths per minute — mostly captured overnight by the Watch during sleep.' },
  { metric: 'apple_sleeping_wrist_temperature', title: 'Wrist Temp', unit: '°C', decimals: 1,
    description: 'Overnight skin temperature deviation — can flag illness or cycle changes.' },
  // Removed 2026-09-24: sleeping_heart_rate (Fitbit-only, never a single row)
  // and skin_temperature (Fitbit's name for what Wrist Temp above already
  // shows from the Watch; last row 2026-08-29).
]

// Ambient Noise / Headphone Audio / Mindful Minutes / Falls Detected / Sexual
// Activity were removed on explicit user request (2026-09-06) — not dead data,
// just judged not worth a permanent card; they still land in health_metrics.
export const BODY_EXTRA_METRICS: MiniMetricConfig[] = [
  // UV Exposure and Handwashing removed on request (2026-09-24). uv_exposure
  // had never produced a single row -- that card could only ever read "—" --
  // and handwashing stopped arriving on 2026-08-20. Daylight Time takes the
  // sun/environment slot UV held; it moved here from Steps, where it sat among
  // gait metrics it has nothing to do with.
  { metric: 'time_in_daylight', title: 'Daylight Time', unit: 'min', decimals: 0,
    description: 'Minutes spent in outdoor daylight — linked to sleep quality & mood.' },
  // Waist circumference removed on request (2026-09-24): it already comes
  // through Hevy's own body measurements, and two sources for one tape reading
  // is one too many.
  { metric: 'toothbrushing', title: 'Toothbrushing', unit: 's', decimals: 0, showTodayCount: true, showTodayTimes: true,
    description: 'Total time spent brushing teeth today.' },
]
