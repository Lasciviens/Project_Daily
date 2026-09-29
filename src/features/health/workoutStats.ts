// Deeper numbers for one logged workout — pure and import-free
// (scripts/verify-health-workout-stats.cjs): time in each heart-rate zone and
// the per-minute rates (energy, sets, volume).
//
// Zones are the ACSM intensity classes by % of estimated max heart rate
// (Garber 2011, Table 4: very light < 57%, light 57–63%, moderate 64–76%,
// vigorous 77–95%, near-maximal ≥ 96%) — the same moderate/vigorous edges as
// heartRateZones() in benchmarks/healthBenchmarks.ts. Max heart rate is the
// age estimate (Tanaka 2001), so every zone carries its ±10 bpm uncertainty.

export interface ZoneDef {
  id: 'very_light' | 'light' | 'moderate' | 'vigorous' | 'max'
  label: string
  /** Lower edge as a share of max heart rate (inclusive). */
  from: number
}

export const HR_ZONES: readonly ZoneDef[] = [
  { id: 'very_light', label: 'Very light', from: 0 },
  { id: 'light', label: 'Light', from: 0.57 },
  { id: 'moderate', label: 'Moderate', from: 0.64 },
  { id: 'vigorous', label: 'Vigorous', from: 0.77 },
  { id: 'max', label: 'Near max', from: 0.96 },
]

export interface ZoneTime {
  id: ZoneDef['id']
  label: string
  /** bpm range of the zone at this max heart rate; `high` null for the top zone. */
  lowBpm: number
  highBpm: number | null
  seconds: number
  /** 0–1 of the time with a heart-rate reading. */
  share: number
}

export interface ZoneSummary {
  hrMax: number
  zones: ZoneTime[]
  /** Seconds covered by heart-rate samples. */
  totalSeconds: number
  /** Moderate + vigorous + near max — what counts towards WHO's weekly minutes. */
  moderatePlusSeconds: number
}

/** Longest a single sample may stand for (a gap longer than this is a dropout, not a reading). */
export const MAX_SAMPLE_SECONDS = 180
/** A sample with no successor (the last one) counts this long, at most up to the workout end. */
export const DEFAULT_SAMPLE_SECONDS = 60

export function zoneFor(bpm: number, hrMax: number): ZoneDef {
  const pct = bpm / hrMax
  let z = HR_ZONES[0]
  for (const d of HR_ZONES) if (pct >= d.from) z = d
  return z
}

/**
 * Seconds spent in each zone. Each sample stands until the next one (capped
 * at MAX_SAMPLE_SECONDS); the last until `endMs` (capped at
 * DEFAULT_SAMPLE_SECONDS). Null without samples or a usable max heart rate.
 */
export function timeInZones(samples: readonly { t: number; bpm: number }[], hrMax: number | null | undefined, opts: { endMs?: number | null } = {}): ZoneSummary | null {
  if (!hrMax || !Number.isFinite(hrMax) || hrMax < 100) return null
  const pts = samples.filter(s => Number.isFinite(s.t) && Number.isFinite(s.bpm) && s.bpm > 0).slice().sort((a, b) => a.t - b.t)
  if (!pts.length) return null
  const secs = new Map<ZoneDef['id'], number>(HR_ZONES.map(z => [z.id, 0]))
  let total = 0
  for (let i = 0; i < pts.length; i++) {
    const next = pts[i + 1]
    let dur: number
    if (next) dur = Math.min(MAX_SAMPLE_SECONDS, Math.max(0, (next.t - pts[i].t) / 1000))
    else {
      const toEnd = opts.endMs != null && Number.isFinite(opts.endMs) ? (opts.endMs - pts[i].t) / 1000 : DEFAULT_SAMPLE_SECONDS
      dur = Math.min(DEFAULT_SAMPLE_SECONDS, Math.max(0, toEnd))
    }
    if (dur <= 0) continue
    const z = zoneFor(pts[i].bpm, hrMax)
    secs.set(z.id, (secs.get(z.id) ?? 0) + dur)
    total += dur
  }
  if (total <= 0) return null
  // The lowest whole bpm that zoneFor puts in the zone, so the labels match the counting.
  const lowOf = (d: ZoneDef) => Math.ceil(hrMax * d.from - 1e-9)
  const zones = HR_ZONES.map((d, i): ZoneTime => {
    const next = HR_ZONES[i + 1]
    const s = Math.round(secs.get(d.id) ?? 0)
    return {
      id: d.id, label: d.label,
      lowBpm: lowOf(d),
      highBpm: next ? lowOf(next) - 1 : null,
      seconds: s,
      share: (secs.get(d.id) ?? 0) / total,
    }
  })
  const moderatePlus = zones.filter(z => z.id === 'moderate' || z.id === 'vigorous' || z.id === 'max').reduce((a, z) => a + z.seconds, 0)
  return { hrMax, zones, totalSeconds: Math.round(total), moderatePlusSeconds: moderatePlus }
}

export interface WorkoutRates {
  /** Active kcal per minute of the Apple workout. */
  kcalPerMin: number | null
  /** Working sets per minute of the Hevy session. */
  setsPerMin: number | null
  /** The inverse: average minutes per working set, rest included. */
  minPerSet: number | null
  /** Volume (kg) per minute of the Hevy session. */
  kgPerMin: number | null
}

const positive = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

/** Rates per minute; each is null when its inputs are missing or the duration is under a minute. */
export function workoutRates(p: {
  activeKcal?: number | null
  appleSeconds?: number | null
  workingSets?: number | null
  volumeKg?: number | null
  hevySeconds?: number | null
}): WorkoutRates {
  const appleMin = positive(p.appleSeconds) != null && (p.appleSeconds as number) >= 60 ? (p.appleSeconds as number) / 60 : null
  const hevyMin = positive(p.hevySeconds) != null && (p.hevySeconds as number) >= 60 ? (p.hevySeconds as number) / 60 : null
  const kcal = positive(p.activeKcal)
  const sets = positive(p.workingSets)
  const vol = positive(p.volumeKg)
  return {
    kcalPerMin: kcal != null && appleMin != null ? r1(kcal / appleMin) : null,
    setsPerMin: sets != null && hevyMin != null ? r2(sets / hevyMin) : null,
    minPerSet: sets != null && hevyMin != null ? r1(hevyMin / sets) : null,
    kgPerMin: vol != null && hevyMin != null ? Math.round(vol / hevyMin) : null,
  }
}
