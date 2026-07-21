// Per-metric SOURCE RESOLUTION policy — how the aggregation layer picks which
// device stream to show when more than one wrote data for the same window.
//
// ⚖️ CARDINAL RULE (docs/fitbit-air-integration.md): this config ONLY decides
// what is DISPLAYED. Both sources' data always lives in the DB in full, and the
// UI (Phase 4) can show any metric from any source on demand — this is a
// display policy, never a data filter.
//
// MODEL (user-approved 2026-07-21, supersedes the earlier per-day/family
// design AND the health_source_prefs table, both removed):
// - The unit of competition is a STREAM (one raw `source` string), not a whole
//   family — live data showed two same-family streams (Watch + iPhone, and
//   even two Watch-labelled strings) writing the same hours.
// - Resolution granularity is the metric's STRATEGY below; within each window
//   exactly ONE stream wins, by the metric's priority LADDER. Streams are
//   never blended and never summed together inside a window.
// - Windows are independent: a stream missing from one window lets the next
//   ladder rung fill that window (gap-filling union — Watch off overnight →
//   Fitbit hours fill; Fitbit charging → Watch hours fill).
//
// EMPIRICAL BASIS (live DB scan, 14 days, 54k rows, 2026-07-21): step_count
// had 159/191 hours with 2+ streams (app showed 10,355 steps on a ~5,700-step
// day), walking_running_distance 4 hours, active_energy 21 hours (identical
// duplicate delivery under two Watch-labelled strings). All other metrics are
// single-stream today — but nearly every metric becomes two-family once the
// Fitbit poller (Phase 3) lands, so the policy is universal.

export type SourceFamily = 'apple' | 'fitbit'

// A stream's rung on the priority ladder. 'manual' is a user-entered
// correction (raw source === 'manual') — always outranks every device.
// 'watch' = any Apple-family stream whose source names the Watch;
// 'phone' = the remaining Apple-family streams (e.g. the bare iPhone name).
export type StreamTier = 'manual' | 'watch' | 'fitbit' | 'phone'

// How finely a metric resolves its winning stream:
// - 'bucket': per HOUR — flow/cumulative metrics where devices trade places
//   during the day and gaps must be filled at sub-day granularity.
// - 'day':    one winner for the whole calendar day — sparse or point-in-time
//   metrics where mixing two sensors' readings inside one day would fabricate
//   a value neither device measured (HRV, resting HR, weight, …).
// - 'night':  one winner per attributed night (sleep only — stages from two
//   devices must never be interleaved; Apple 'Core' ≠ Fitbit 'light').
export type ResolveStrategy = 'bucket' | 'day' | 'night'

// Flow/cumulative metrics resolved hour-by-hour. heart_rate is here too:
// it's continuous, and hourly winners let Fitbit cover the night while the
// Watch covers a workout, without ever averaging the two sensors inside one
// hour. Everything not listed (and not sleep) resolves per-day — the safe
// default for sparse/point-in-time metrics.
const BUCKET_METRICS: ReadonlySet<string> = new Set([
  'step_count',
  'walking_running_distance',
  'active_energy',
  'basal_energy_burned',
  'active_zone_minutes',
  'heart_rate',
])

export function strategyFor(metricName: string): ResolveStrategy {
  if (metricName === 'sleep_analysis') return 'night'
  return BUCKET_METRICS.has(metricName) ? 'bucket' : 'day'
}

// Ladders. First tier present in a window wins the window.
//
// CUMULATIVE (steps/distance/energy/AZM): user's explicit call ("ikisi
// takılıysa şimdilik Apple; bilekteki cihaz ceptekini yener") — Watch first,
// then Fitbit, and the pocket iPhone only when neither wrist device wrote.
// This supersedes red-team H3's fitbit-first lock for these metrics (user's
// direct decision on their own data, 2026-07-21).
const LADDER_CUMULATIVE: readonly StreamTier[] = ['manual', 'watch', 'fitbit', 'phone']

// PHYSIOLOGICAL continuity metrics (H3 reasoning untouched — the 24/7 device
// sees the whole night/day; a phone can't sense these at all, so 'phone' is a
// theoretical last rung): Fitbit first.
const LADDER_FITBIT_FIRST: readonly StreamTier[] = ['manual', 'fitbit', 'watch', 'phone']

// Everything else — Apple-exclusive or Apple-strength metrics (running
// dynamics, mobility/gait, audio exposure, cardio recovery, VO2max, wrist
// temp, ring metrics, body composition from a HealthKit scale, nutrition,
// event detections) plus any unknown/new metric: Apple first.
// NOTE flights_climbed deliberately stays in this Apple-first group — the
// Fitbit Air has no altimeter/barometer and cannot produce it (design doc
// §2/§8, HIGH-confidence hardware fact); don't move it to a Fitbit-first
// ladder.
const LADDER_APPLE_FIRST: readonly StreamTier[] = ['manual', 'watch', 'phone', 'fitbit']

// Sleep + the physiological set that Fitbit (worn 24/7, incl. every night)
// should lead. sleep_analysis is here as an explicit user requirement, not a
// tuning choice.
const FITBIT_FIRST: ReadonlySet<string> = new Set([
  'sleep_analysis',
  'sleeping_heart_rate',
  'heart_rate',
  'resting_heart_rate',
  'heart_rate_variability',
  'respiratory_rate',
  'oxygen_saturation',
  'skin_temperature',
])

const CUMULATIVE: ReadonlySet<string> = new Set([
  'step_count',
  'walking_running_distance',
  'active_energy',
  'basal_energy_burned',
  'active_zone_minutes',
  'apple_exercise_time',
  'apple_stand_time',
  'time_in_daylight',
])

export function ladderFor(metricName: string): readonly StreamTier[] {
  if (CUMULATIVE.has(metricName)) return LADDER_CUMULATIVE
  if (FITBIT_FIRST.has(metricName)) return LADDER_FITBIT_FIRST
  return LADDER_APPLE_FIRST
}
