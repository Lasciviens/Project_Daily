// Health Auto Export metric classification — shared by the Health tab's
// category pills, generic table, and every dedicated section (rings, steps,
// energy, heart, sleep, body). Metric names arrive from HealthKit as
// snake_case identifiers (e.g. "step_count", "active_energy").

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

  // Point-in-time measurements — latest reading of the day wins
  weight_body_mass: 'latest',
  body_fat_percentage: 'latest',
  body_mass_index: 'latest',
  resting_heart_rate: 'latest',
  cardio_recovery: 'latest',
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

// ─── Category (for pills + generic table) ──────────────────────────────────
// Health Auto Export's metric identifiers use underscores; matching is
// separator-agnostic (strips all non-alphanumeric chars from both sides)
// so it doesn't matter whether a name is "physical_effort" or "Physical Effort".

const CATEGORY_KEYWORDS: [string, string[]][] = [
  ['Sleep',           ['sleep']],
  ['Cardiovascular',  ['heart', 'blood_pressure', 'afib', 'atrial', 'cardio']],
  ['Respiratory',     ['respiratory', 'oxygen_saturation', 'expiratory', 'vital_capacity', 'inhaler', 'perfusion', 'peak_flow']],
  ['Mobility',        ['walking', 'stair', 'running_', 'six_minute']],
  ['Body',            ['weight', 'height', 'body_mass', 'body_fat', 'lean_body', 'waist']],
  ['Nutrition',       ['dietary', 'protein', 'carbohydrate', 'total_fat', 'fiber', 'sodium', 'potassium', 'calcium', 'iron', 'magnesium',
                        'phosphorus', 'zinc', 'copper', 'manganese', 'selenium', 'iodine', 'chromium', 'molybdenum', 'chloride', 'caffeine',
                        'biotin', 'folate', 'niacin', 'pantothenic', 'riboflavin', 'thiamin', 'vitamin', 'cholesterol', 'sugar', 'water']],
  ['Health Records',  ['blood_glucose', 'insulin']],
  ['Lifestyle',        ['sexual_activity', 'handwashing', 'toothbrushing', 'fallen', 'alcohol', 'mindful']],
  ['Environmental',   ['audio_exposure', 'uv_exposure', 'daylight', 'underwater']],
  ['Activity',         ['step', 'energy', 'distance', 'flights', 'stand', 'move_time', 'exercise_time', 'cadence', 'vo2',
                        'physical_effort', 'push_count', 'swim', 'cycling']],
  ['Vitals',           ['temperature']],
]

export const CATEGORY_COLORS: Record<string, string> = {
  Activity:        'bg-orange-400',
  Body:            'bg-purple-400',
  Cardiovascular:  'bg-rose-400',
  Mobility:        'bg-teal-400',
  Respiratory:     'bg-sky-400',
  Sleep:           'bg-indigo-400',
  Vitals:          'bg-pink-400',
  Nutrition:       'bg-lime-500',
  'Health Records': 'bg-red-400',
  Lifestyle:       'bg-fuchsia-400',
  Environmental:   'bg-emerald-400',
  Other:           'bg-ink-300',
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function categorize(metricName: string): string {
  const n = normalize(metricName)
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some(k => n.includes(normalize(k)))) return category
  }
  return 'Other'
}
