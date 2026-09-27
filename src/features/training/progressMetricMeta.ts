import type { ProgressMetricKind } from './progressAggregate'

// What each metric kind is called and measured in — one lookup, so the
// weekly-change panel and any chart label a metric the same way. `invert`
// marks the kind where a LOWER number is the improvement (assistance).
export const METRIC_META: Record<ProgressMetricKind, { label: string; unit: string; invert?: boolean }> = {
  est1rm:         { label: 'Est. 1RM',         unit: 'kg' },
  reps:           { label: 'Top set reps',     unit: 'reps' },
  addedWeight:    { label: 'Added weight',     unit: 'kg' },
  assistedWeight: { label: 'Assistance',       unit: 'kg', invert: true },
  duration:       { label: 'Top set duration', unit: 's' },
  distance:       { label: 'Top set distance', unit: 'm' },
}
