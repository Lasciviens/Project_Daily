// Progress engine — shared set formatting. Pure, import-free (type-only
// imports). ONE formatter for "what was lifted" and "what to lift next", so a
// session read and its next target always look alike, and a top-set+backoff
// session is always shown with each set's OWN load ("102.5 kg × 5 · 80 kg ×
// 9/8"), never one weight glued onto every set's reps.

import type { CanonicalSet, ProgressMetricKind, SetTarget, TargetQuantityUnit } from './types'

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60)
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

export function quantityUnitFor(metricKind: ProgressMetricKind): TargetQuantityUnit {
  if (metricKind === 'duration') return 'seconds'
  if (metricKind === 'distance') return 'metres'
  return 'reps'
}

export function formatQuantity(value: number | null, unit: TargetQuantityUnit): string {
  if (value == null) return '—'
  if (unit === 'seconds') return fmtDuration(value)
  if (unit === 'metres') return `${value}m`
  return String(value)
}

export function formatKg(kg: number): string {
  return `${Math.round(kg * 100) / 100} kg`
}

interface DisplaySet { weightKg: number | null; quantity: number | null }

/** Groups consecutive sets sharing one load: "60 kg × 10/10/10",
 *  "102.5 kg × 5 · 80 kg × 9/8", "15 kg assist × 8/8/8", "6/6/5 reps",
 *  "45s/40s/40s", "20 kg × 45s/45s". */
export function formatSetGroups(sets: readonly DisplaySet[], metricKind: ProgressMetricKind): string {
  if (sets.length === 0) return '—'
  const unit = quantityUnitFor(metricKind)
  const groups: { weightKg: number | null; quantities: (number | null)[] }[] = []
  for (const s of sets) {
    const last = groups[groups.length - 1]
    if (last && last.weightKg === s.weightKg) last.quantities.push(s.quantity)
    else groups.push({ weightKg: s.weightKg, quantities: [s.quantity] })
  }
  return groups.map(g => {
    const qs = g.quantities.map(q => formatQuantity(q, unit)).join('/')
    if (g.weightKg == null) return unit === 'reps' ? `${qs} reps` : qs
    const load = metricKind === 'assistedWeight' ? `${formatKg(g.weightKg)} assist` : formatKg(g.weightKg)
    return `${load} × ${qs}`
  }).join(' · ')
}

/** The quantity a set SHOWS for this metric — the raw logged field (a
 *  weighted plank still shows its seconds), unlike metricStrategy's
 *  `quantityFor`, which refuses composite sets for the math. */
export function displayQuantity(set: CanonicalSet, metricKind: ProgressMetricKind): number | null {
  if (metricKind === 'duration') return set.durationSeconds
  if (metricKind === 'distance') return set.distanceMeters
  return set.reps
}

export function formatSessionSets(sets: readonly CanonicalSet[] | undefined, metricKind: ProgressMetricKind): string {
  if (!sets || sets.length === 0) return '—'
  return formatSetGroups(sets.map(s => ({ weightKg: s.weightKg, quantity: displayQuantity(s, metricKind) })), metricKind)
}

export function formatSetTargets(targets: readonly SetTarget[], metricKind: ProgressMetricKind): string {
  return formatSetGroups(targets, metricKind)
}
