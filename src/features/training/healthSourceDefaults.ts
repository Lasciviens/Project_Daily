// Curated per-metric DEFAULT source family — which source is shown FIRST when
// both Apple (Health Auto Export) and Fitbit (Google Health API) have data for
// the same metric on the same day.
//
// ⚖️ CARDINAL RULE (docs/fitbit-air-integration.md): this map ONLY decides
// which source is shown first. BOTH sources' data always lives in the DB in
// full, and the UI (Phase 4) can switch any metric to any source on demand,
// overriding this default per metric via `health_source_prefs`. This is a
// display-preference default, never a data filter.
//
// ⚠️ INERT UNTIL FITBIT IS LIVE. Today every row in the DB is 'apple' family,
// so the resolver in healthAggregate.ts never has to choose — it fast-paths
// when a day has ≤1 family present. This map does nothing observable until the
// Phase 3 poller starts writing 'fitbit' rows. It is committed now purely as
// the config the resolver will consult then.
//
// POLICY (red-team §13 H3, LOCKED in docs — but see the note below):
// The user's Fitbit Air is worn 24/7; the Apple Watch SE2 only during the day.
// So for CONTINUITY / CUMULATIVE metrics (steps, HR, energy, HRV, RHR, SpO2,
// respiratory rate, AZM, sleep), the 24/7 device gives more complete coverage
// and is the better default → 'fitbit'. The Apple Watch stays the default for
// what it uniquely measures well: running dynamics, walking mobility/gait,
// audio exposure, cardio recovery, VO2max, wrist temperature, and the Apple
// ring metrics — plus body-composition (comes from a HealthKit-connected
// scale; Fitbit Air has no scale) and app-logged nutrition (enters via
// HealthKit, Fitbit never provides it).
//
// ⚠️ OPEN DECISION (surface before Phase 4 wires the UI): the user originally
// said "default = Apple if present, else Fitbit (except sleep)". The red-team
// H3 pass REVERSED that for continuity metrics (the 24/7-coverage argument
// above) and that reversal is what's encoded here. This only becomes VISIBLE
// in Phase 4. Confirm the policy with the user then — flipping a metric is a
// one-line change here (and, per-metric at runtime, a `health_source_prefs`
// row), so nothing is locked in by shipping this now.

export type SourceFamily = 'apple' | 'fitbit'

// Metrics whose default is Fitbit (24/7 continuity advantage). Everything NOT
// listed here defaults to Apple (see DEFAULT_FALLBACK) — the incumbent source,
// which is also every existing row's family, so unknown/new metrics stay
// Apple-first until deliberately categorised.
const FITBIT_DEFAULT: ReadonlySet<string> = new Set([
  // Sleep — ALWAYS Fitbit (explicit user requirement, not just a default).
  'sleep_analysis',
  'sleeping_heart_rate',
  // Continuity heart metrics (24/7 wear beats day-only Watch coverage)
  'heart_rate',
  'resting_heart_rate',
  'heart_rate_variability',
  'respiratory_rate',
  'oxygen_saturation',
  'skin_temperature',
  // Cumulative daily activity/energy (complete only with 24/7 wear)
  'step_count',
  'walking_running_distance',
  'flights_climbed',
  'active_energy',
  'basal_energy_burned',
  'active_zone_minutes',
])

// Every metric not in FITBIT_DEFAULT resolves to this. Apple is the incumbent
// (all current data is Apple-family) and the categories that stay Apple —
// running dynamics, walking mobility/gait, audio exposure, cardio recovery,
// VO2max, wrist temperature, Apple ring metrics, body composition, nutrition,
// and Apple-only event detections (handwashing, falls, …) — are exactly the
// ones the Apple Watch measures and Fitbit Air either can't or doesn't.
const DEFAULT_FALLBACK: SourceFamily = 'apple'

// The display-default source family for a metric. Consulted by the resolver
// only when a given (metric, day) actually has BOTH families present; with one
// family it's irrelevant (the present one wins). A `health_source_prefs` row,
// when it exists (Phase 4), overrides this — that lookup lives at the call
// site, not here (this file is pure, DB-free config).
export function defaultSourceFor(metricName: string): SourceFamily {
  return FITBIT_DEFAULT.has(metricName) ? 'fitbit' : DEFAULT_FALLBACK
}
