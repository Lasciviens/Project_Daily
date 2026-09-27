// Warm-up ramp for a lift's top set — pure and import-free (sucrase-tested,
// scripts/verify-training-plan.cjs).
//
// The ramp is a COACHING CONVENTION, not a trial result: no study sets the
// exact percentages. The general idea (a few progressively heavier, low-rep
// sets before a heavy set) is supported for upper-body strength performance
// by a systematic review (McCrary 2015, Br J Sports Med); the numbers below
// (bar, ~40/60/80%, plus ~90% for a heavy top set) are the common practitioner
// ramp. Reps drop as the load rises so the warm-up doesn't tire the lifter.
//
// Every weight is rounded to something you can actually load: a barbell to
// the plates on hand (per side, greedy), a dumbbell or machine to its step.
// A warm-up that rounds to the same load as the previous one, to the top set
// itself, less than 5 kg above the previous barbell set, or below an empty
// bar is dropped rather than shown twice. A dumbbell or machine top set under
// 10 kg gets no ramp at all.

export type WarmupEquipment = 'barbell' | 'dumbbell' | 'machine' | null

export interface WarmupOptions {
  equipment: WarmupEquipment
  /** Empty bar weight (barbell only). Default 20 kg. */
  barKg?: number
  /** Plates available per side, kg (barbell only). Default a commercial gym's
   *  25/20/15/10/5/2.5/1.25. */
  plates?: readonly number[]
  /** Loadable step for a dumbbell / machine / unknown implement. Defaults:
   *  dumbbell 2 kg, machine 2.5 kg, unknown 2.5 kg. */
  stepKg?: number
}

export interface WarmupSet {
  weightKg: number
  reps: number
  /** Share of the top set, rounded to a whole percent (0 for the empty bar). */
  pctOfTop: number
  label: string
  /** Plates per side for a barbell set (heaviest first); empty for the bar
   *  alone or for a non-barbell implement. */
  platesPerSide: number[]
}

export const DEFAULT_BAR_KG = 20
export const DEFAULT_PLATES: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25]
/** A barbell warm-up closer than this to the previous one isn't worth a set
 *  (20 → 22.5 kg), so it is skipped. */
export const MIN_BARBELL_JUMP_KG = 5
/** A dumbbell/machine top set lighter than this needs no ramp. */
export const MIN_LOOSE_TOP_KG = 10
const DEFAULT_STEP: Record<'dumbbell' | 'machine' | 'other', number> = { dumbbell: 2, machine: 2.5, other: 2.5 }

/** The percentage ramp: [share of top, reps]. A top set of 100 kg or more
 *  gets one extra single at ~90%. */
export function rampFor(topKg: number): [number, number][] {
  const ramp: [number, number][] = [[0.4, 5], [0.6, 3], [0.8, 2]]
  if (topKg >= 100) ramp.push([0.9, 1])
  return ramp
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

/** Plates per side (greedy, heaviest first) for the heaviest loadable weight
 *  at or below `targetKg` — never above it, so a warm-up can't overshoot. */
export function loadBarbell(targetKg: number, barKg = DEFAULT_BAR_KG, plates: readonly number[] = DEFAULT_PLATES): { weightKg: number; platesPerSide: number[] } {
  if (!Number.isFinite(targetKg) || targetKg <= barKg) return { weightKg: barKg, platesPerSide: [] }
  let perSide = round2((targetKg - barKg) / 2)
  const sorted = [...plates].filter(p => p > 0).sort((a, b) => b - a)
  const used: number[] = []
  for (const p of sorted) {
    while (perSide + 1e-9 >= p) { used.push(p); perSide = round2(perSide - p) }
  }
  const loaded = round2(barKg + 2 * used.reduce((s, p) => s + p, 0))
  return { weightKg: loaded, platesPerSide: used }
}

/** Nearest multiple of `step` (a dumbbell rack, a machine stack). */
export function roundToStep(kg: number, step: number): number {
  if (!(step > 0)) return round2(kg)
  return round2(Math.round(kg / step) * step)
}

/** The warm-up sets for one top set, lightest first. Empty when the top set
 *  is too light to need a ramp (at or below one step above the start). */
export function buildWarmupSets(topKg: number | null | undefined, opts: WarmupOptions): WarmupSet[] {
  if (topKg == null || !Number.isFinite(topKg) || topKg <= 0) return []
  const out: WarmupSet[] = []
  const pct = (w: number) => Math.round((w / topKg) * 100)

  if (opts.equipment === 'barbell') {
    const bar = opts.barKg ?? DEFAULT_BAR_KG
    const plates = opts.plates ?? DEFAULT_PLATES
    if (topKg <= bar) return []
    out.push({ weightKg: bar, reps: 10, pctOfTop: 0, label: 'Empty bar', platesPerSide: [] })
    for (const [share, reps] of rampFor(topKg)) {
      const { weightKg, platesPerSide } = loadBarbell(topKg * share, bar, plates)
      const prev = out[out.length - 1]
      if (weightKg < prev.weightKg + MIN_BARBELL_JUMP_KG || weightKg >= topKg) continue
      out.push({ weightKg, reps, pctOfTop: pct(weightKg), label: `${pct(weightKg)}%`, platesPerSide })
    }
    return out
  }

  if (topKg < MIN_LOOSE_TOP_KG) return []
  const step = opts.stepKg ?? (opts.equipment === 'dumbbell' ? DEFAULT_STEP.dumbbell : opts.equipment === 'machine' ? DEFAULT_STEP.machine : DEFAULT_STEP.other)
  for (const [share, reps] of rampFor(topKg)) {
    const weightKg = roundToStep(topKg * share, step)
    const prev = out[out.length - 1]
    if (weightKg <= 0 || weightKg >= topKg || (prev && weightKg <= prev.weightKg)) continue
    out.push({ weightKg, reps, pctOfTop: pct(weightKg), label: `${pct(weightKg)}%`, platesPerSide: [] })
  }
  return out
}

/** "2×20 + 5" style text for the plates on one side. */
export function formatPlates(platesPerSide: readonly number[]): string {
  if (platesPerSide.length === 0) return ''
  const groups: { plate: number; n: number }[] = []
  for (const p of platesPerSide) {
    const last = groups[groups.length - 1]
    if (last && last.plate === p) last.n++
    else groups.push({ plate: p, n: 1 })
  }
  return groups.map(g => (g.n > 1 ? `${g.n}×${g.plate}` : `${g.plate}`)).join(' + ')
}
