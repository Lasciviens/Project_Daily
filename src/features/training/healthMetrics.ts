// Health Auto Export metric classification — shared by every dedicated
// Health tab section (rings, steps, energy, heart, sleep, body) and their
// mini-metric grids. Metric names arrive from HealthKit as snake_case
// identifiers (e.g. "step_count", "active_energy").

export type AggType = 'sum' | 'average' | 'minmaxavg' | 'latest' | 'sleep'

// How to collapse multiple points (across a day, and across differing
// sources — a day can genuinely have several distinct source strings, e.g.
// "Furkan's Apple Watch" vs "Furkan's Apple Watch|Lasci"; we intentionally
// ignore source for this computation) into one representative daily value:
// - sum: cumulative/additive HealthKit quantities (steps, energy, distance,
//   durations, nutrition intake) — add every point's qty together.
// - average: rate/level metrics that are meaningless summed (speeds, dB
//   levels, physical effort, respiratory rate, HRV) — mean of all points.
// - minmaxavg: Min/Avg/Max-shaped points (heart_rate) — real day min/max +
//   weighted-by-nothing average of the per-point averages.
// - latest: point-in-time measurements (weight, body fat, BMI, resting HR)
//   where the most recent reading of the day already IS the answer.
// - sleep: sleep_analysis's own multi-field shape (core/rem/deep/awake or
//   raw per-segment points) — handled by its own merge, not a generic one.
export const METRIC_AGGREGATION: Record<string, AggType> = {
  // Activity rings + steps
  active_energy: 'sum',
  apple_exercise_time: 'sum',
  apple_stand_hour: 'sum',
  apple_stand_time: 'sum',
  apple_move_time: 'sum',
  step_count: 'sum',
  walking_running_distance: 'sum',
  flights_climbed: 'sum',
  push_count: 'sum',
  basal_energy_burned: 'sum',
  time_in_daylight: 'sum',

  // Rate/level metrics — never sum
  walking_speed: 'average',
  walking_step_length: 'average',
  walking_asymmetry_percentage: 'average',
  stair_speed_up: 'average',
  stair_speed_down: 'average',
  physical_effort: 'average',
  respiratory_rate: 'average',
  heart_rate_variability: 'average',
  environmental_audio_exposure: 'average',
  headphone_audio_exposure: 'average',
  uv_exposure: 'average',
  walking_heart_rate_average: 'average',

  // Heart rate — Min/Avg/Max shaped points
  heart_rate: 'minmaxavg',
  // Overnight resting HR while asleep (Fitbit reports this distinctly from the
  // waking resting_heart_rate) — a point-in-time nightly value.
  sleeping_heart_rate: 'latest',

  // Net-new metrics that arrive from Fitbit Air (registered inert in Phase 0 —
  // nothing writes them until the Google Health poller lands in Phase 3):
  // - oxygen_saturation: overnight SpO2. LOCKED as minmaxavg for now on the
  //   assumption it arrives heart_rate-shaped (Min/Avg/Max for a continuous
  //   overnight vital) — re-verify against the first real Fitbit payload in
  //   Phase 3 and correct here if it's actually single-point samples.
  oxygen_saturation: 'minmaxavg',
  // - active_zone_minutes: Fitbit's own cumulative daily activity metric.
  active_zone_minutes: 'sum',
  // - skin_temperature: nightly skin-temp deviation (point-in-time).
  skin_temperature: 'latest',

  // Running dynamics (rate/level metrics from a run — never sum)
  running_speed: 'average',
  running_power: 'average',
  running_stride_length: 'average',
  running_vertical_oscillation: 'average',
  running_ground_contact_time: 'average',

  // Point-in-time measurements — latest reading of the day wins
  weight_body_mass: 'latest',
  body_fat_percentage: 'latest',
  body_mass_index: 'latest',
  lean_body_mass: 'latest',
  resting_heart_rate: 'latest',
  cardio_recovery: 'latest',
  vo2_max: 'latest',
  apple_sleeping_wrist_temperature: 'latest',

  // Sleep — special multi-field merge
  sleep_analysis: 'sleep',

  // Event counts / nutrition intake — cumulative
  handwashing: 'sum',
  toothbrushing: 'sum',
  mindful_minutes: 'sum',
  number_of_times_fallen: 'sum',
  sexual_activity: 'sum',
  dietary_water: 'sum',
  dietary_sugar: 'sum',
  protein: 'sum',
  carbohydrates: 'sum',
  fiber: 'sum',
  caffeine: 'sum',
  total_fat: 'sum',
  vitamin_d: 'sum',
  magnesium: 'sum',
}

// Unrecognized metrics default to 'latest' — the safest fallback (shows the
// most recent reading, never silently produces a nonsense sum or average for
// a metric type we haven't seen yet).
export function getAggregationType(metricName: string): AggType {
  return METRIC_AGGREGATION[metricName] ?? 'latest'
}
