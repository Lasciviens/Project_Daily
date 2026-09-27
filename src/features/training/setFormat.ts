// THE one way a logged or planned set is written out ("80 kg × 8",
// "1m 30s", "2.5 km · 12m", "20 kg assist × 8"). Pure and import-free
// (scripts/verify-hevy-training.cjs). Before this the workout detail printed
// every set as "weight × reps" — a plank or a run read "— × —" — while the
// routine chips and the log form each did their own thing.
//
// What a set shows depends on how the exercise is logged (Hevy's
// CustomExerciseType on the template). Without a type (templates not loaded
// yet) it shows whichever values the set actually carries.

export interface SetValueFields {
  weight_kg?:        number | null
  reps?:             number | null
  duration_seconds?: number | null
  distance_meters?:  number | null
  custom_metric?:    number | null
  rep_range_start?:  number | null
  rep_range_end?:    number | null
}

const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** "45s", "1m 30s", "1h 5m". */
export function formatDurationShort(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = s % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return rest > 0 ? `${m}m ${rest}s` : `${m}m`
}

/** "400 m", "2.5 km". */
export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${Number((meters / 1000).toFixed(2))} km`
  return `${Math.round(meters)} m`
}

/** "80 kg", "62.5 kg" — never a trailing ".0". */
export function formatKg(kg: number): string {
  return `${Number(kg.toFixed(2))} kg`
}

function repsText(set: SetValueFields): string | null {
  if (has(set.reps)) return String(set.reps)
  if (has(set.rep_range_start) && has(set.rep_range_end)) return `${set.rep_range_start}–${set.rep_range_end}`
  return null
}

function join(parts: (string | null)[]): string {
  const out = parts.filter((p): p is string => !!p)
  return out.length ? out.join(' · ') : '—'
}

function weightReps(w: number | null, r: string | null): string | null {
  if (w != null && r) return `${formatKg(w)} × ${r}`
  if (w != null) return formatKg(w)
  if (r) return `${r} reps`
  return null
}

export function formatSet(set: SetValueFields, exerciseType?: string | null): string {
  const w = has(set.weight_kg) ? set.weight_kg : null
  const r = repsText(set)
  const dur = has(set.duration_seconds) ? formatDurationShort(set.duration_seconds) : null
  const dist = has(set.distance_meters) ? formatDistance(set.distance_meters) : null
  const custom = has(set.custom_metric) ? set.custom_metric : null

  switch (exerciseType) {
    case 'weight_reps':
      return weightReps(w, r) ?? '—'
    case 'reps_only':
    case 'bodyweight_reps':
      return r ? `${r} reps` : '—'
    case 'bodyweight_weighted':
      // Added load on top of bodyweight.
      if (w != null && w !== 0) return r ? `+${formatKg(w)} × ${r}` : `+${formatKg(w)}`
      return r ? `${r} reps` : '—'
    case 'bodyweight_assisted':
      // The weight is the ASSISTANCE — less of it is harder.
      if (w != null && w !== 0) return r ? `${formatKg(w)} assist × ${r}` : `${formatKg(w)} assist`
      return r ? `${r} reps` : '—'
    case 'duration':
      return dur ?? '—'
    case 'floors_duration':
      return join([custom != null ? `${custom} floors` : null, dur])
    case 'steps_duration':
      return join([custom != null ? `${custom} steps` : null, dur])
    case 'weight_duration':
      return join([w != null ? formatKg(w) : null, dur])
    case 'distance_duration':
      return join([dist, dur])
    case 'short_distance_weight':
    case 'weight_distance':
      return join([w != null ? formatKg(w) : null, dist])
    default:
      return join([weightReps(w, r), dur, dist])
  }
}
