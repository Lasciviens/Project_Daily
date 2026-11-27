// Weekly hard sets per muscle, read in words — the ONE source of the ranges (science.md S18) for every screen whose
// job is "how much did a muscle get": Results' Weekly sets card, the body map behind it, the weekly-sets chart, and
// the Plan tab's planned card (programBalance). Pure, sucrase-tested (scripts/verify-training-results.cjs).
//
// S18 (preprint numbers — high for the direction, moderate for the edges): below 4 = below minimum; 4–9 = low, still
// works; 10–20 = target; 21–30 = high, extra sets add less; above 30 = very high, little extra expected. No band is
// an error, so none takes a warning or danger tone (owner, 27.11.2026: "not confusing"). The Renaissance Periodization
// landmarks (MEV/MAV/MRV) are no longer how a muscle's sets are graded here.

import type { Tone } from '../../../shared/ui/Tone'

/** Below this many sets a week: under the smallest dose that reliably builds muscle (S18). */
export const VOLUME_MIN_SETS = 4
/** The 10–20 sets a week most recreational lifters aim for (S18). */
export const VOLUME_TARGET = { min: 10, max: 20 } as const
/** Above this, little extra is expected from more sets (S18). */
export const VOLUME_HIGH_MAX = 30

export type VolumeBandId = 'none' | 'below' | 'low' | 'target' | 'high' | 'very_high'

export interface VolumeBand {
  /** 0–5, the body map's colour index. */
  idx: number
  id: VolumeBandId
  /** The band in words — 1–4 words. */
  label: string
  /** One plain sentence: what the band means. */
  note: string
  /** Never warn or danger: no band is an error (S18). */
  tone: Tone
  /** The whole-set range it covers, for the legend ("10–20"). */
  range: string
}

export const VOLUME_BANDS: readonly VolumeBand[] = [
  { idx: 0, id: 'none', label: 'Not trained', tone: 'neutral', range: '0', note: 'No hard sets for this muscle in the window.' },
  { idx: 1, id: 'below', label: 'Below minimum', tone: 'info', range: 'under 4', note: 'Under 4 hard sets a week — below the smallest dose that reliably builds muscle.' },
  { idx: 2, id: 'low', label: 'Low, still works', tone: 'info', range: '4–9', note: '4–9 sets a week still build muscle; more sets add a little more.' },
  { idx: 3, id: 'target', label: 'Target', tone: 'success', range: '10–20', note: '10–20 sets a week — the range most recreational lifters aim for.' },
  { idx: 4, id: 'high', label: 'High — extra sets add less', tone: 'neutral', range: '21–30', note: '21–30 sets a week: more can still help a little, at a rising cost in time and fatigue. Not an error.' },
  { idx: 5, id: 'very_high', label: 'Very high', tone: 'neutral', range: 'over 30', note: 'Over 30 sets a week: little extra is expected from more. Not an error.' },
]

/** Sets a week as shown: whole sets (a half set from a helper muscle is never presented as precise). */
export function wholeSets(weeklySets: number): number {
  return Math.round(weeklySets)
}

/** The band of a weekly set count, read on whole sets (what the screen shows). Anything trained is at least
 *  "Below minimum", also when it rounds to 0. */
export function volumeBandOf(weeklySets: number): VolumeBand {
  if (!(weeklySets > 0)) return VOLUME_BANDS[0]
  const n = wholeSets(weeklySets)
  if (n < VOLUME_MIN_SETS) return VOLUME_BANDS[1]
  if (n < VOLUME_TARGET.min) return VOLUME_BANDS[2]
  if (n <= VOLUME_TARGET.max) return VOLUME_BANDS[3]
  if (n <= VOLUME_HIGH_MAX) return VOLUME_BANDS[4]
  return VOLUME_BANDS[5]
}

/** The band's colour index (0–5) — what the body map paints. */
export function volumeBandIdx(weeklySets: number): number {
  return volumeBandOf(weeklySets).idx
}
