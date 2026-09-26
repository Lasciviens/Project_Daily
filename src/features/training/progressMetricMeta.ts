import type { ProgressMetricKind } from './progressAggregate'

// `series` indexes useChartColors().series — one categorical colour per metric kind.
export const METRIC_META: Record<ProgressMetricKind, { label: string; unit: string; series: number; invert?: boolean }> = {
  est1rm:         { label: 'Est. 1RM',        unit: 'kg',   series: 1 },
  reps:           { label: 'Top set reps',    unit: 'reps', series: 0 },
  addedWeight:    { label: 'Added weight',    unit: 'kg',   series: 1 },
  assistedWeight: { label: 'Assistance',      unit: 'kg',   series: 2, invert: true },
  duration:       { label: 'Top set duration', unit: 's',   series: 4 },
  distance:       { label: 'Top set distance', unit: 'm',   series: 4 },
}
export const VOLUME_META = { label: 'Session volume', unit: 'kg', series: 2 }

// Toggling to raw tonnage only makes sense where weight_kg is the load unit
// in the first place — a rep-count/duration/distance exercise has no
// weight-based "volume" to switch to.
