import type { Slug } from 'react-muscle-highlighter'

// ─────────────────────────────────────────────────────────────────────────────
//  Muscle mapping + a volume-based, evidence-anchored coloring model.
//
//  Designed with an elite S&C coach + an exercise-physiology reviewer:
//  color encodes weekly HARD-SET VOLUME per muscle against published per-muscle
//  volume landmarks (MV/MEV/MAV/MRV, Renaissance Periodization; Schoenfeld
//  dose-response), NOT rank-relative-to-your-own-max. So a muscle reads
//  "under-dosed" or "optimal" on an ABSOLUTE scale — the colouring is meaningful,
//  not arbitrary. It is a diverging scale: cold = too little, green = the growth
//  sweet spot, hot = beyond what you can recover from.
// ─────────────────────────────────────────────────────────────────────────────

// Complete Hevy `primary_muscle_group` enum → body slug. cardio/full_body/other
// aren't single muscles → null (their PRIMARY isn't coloured; their secondaries
// still count — see the component's "unattributed work" handling).
export const HEVY_TO_SLUG: Record<string, Slug | null> = {
  abdominals: 'abs',
  shoulders:  'deltoids',
  biceps:     'biceps',
  triceps:    'triceps',
  forearms:   'forearm',
  quadriceps: 'quadriceps',
  hamstrings: 'hamstring',
  calves:     'calves',
  glutes:     'gluteal',
  abductors:  'gluteal',
  adductors:  'adductors',
  lats:       'upper-back',
  upper_back: 'upper-back',
  traps:      'trapezius',
  lower_back: 'lower-back',
  chest:      'chest',
  neck:       'neck',
  cardio:     null,
  full_body:  null,
  other:      null,
}

export function slugForHevyGroup(group: string | null | undefined): Slug | null {
  if (!group) return null
  return HEVY_TO_SLUG[group.trim().toLowerCase()] ?? null
}

// ── Contribution seam (future-proofing) ─────────────────────────────────────
// The fraction of a working set a muscle earns for a given exercise, by role.
// PRIMARY 1.0, SECONDARY 0.5, TERTIARY 0.25.
// ⚠️ These fractions are a PRACTITIONER CONVENTION, not a measured constant.
// Per the sports-science review: no validated %MVIC / fractional-set value
// generalises across exercises (surface EMG amplitude does NOT predict
// hypertrophy — Vigotsky 2022), and the largest meta to date found the *choice*
// of fractional counting materially changes the dose-response while the correct
// fraction stays unresolved (Pelland 2025). So 0.5 is a sane default, not truth
// — surface it as such in the UI and never present credited-set decimals as
// precise. The CONTRIBUTION_OVERRIDES seam is where a real per-exercise % goes.
//
// FUTURE: we'll store a per-(exercise, muscle) contribution PERCENTAGE in the
// DB (primary/secondary/tertiary as explicit numbers). `contribution()` already
// routes through an override table, so that day only the resolver reads from the
// DB — the volume math, bands and UI downstream never reference primary/
// secondary directly and won't change.
export type MuscleRole = 'primary' | 'secondary' | 'tertiary'
export const ROLE_WEIGHTS: Record<MuscleRole, number> = {
  primary:   1.0,
  secondary: 0.5,
  tertiary:  0.25,
}

// Placeholder for the future DB-backed overrides: CONTRIBUTION_OVERRIDES[templateId][slug] = 0..1
export const CONTRIBUTION_OVERRIDES: Record<string, Partial<Record<string, number>>> = {}

export function contribution(templateId: string, slug: string, role: MuscleRole): number {
  const override = CONTRIBUTION_OVERRIDES[templateId]?.[slug]
  return override != null ? override : ROLE_WEIGHTS[role]
}

// ── Per-muscle weekly working-set landmarks ─────────────────────────────────
// MV maintenance · MEV minimum effective · MAV maximum adaptive · MRV maximum
// recoverable. Per-muscle (large muscles tolerate more; small synergist-heavy
// muscles have lower ceilings). Tunable in one place; every colour derives here.
export interface Landmarks { mv: number; mev: number; mav: number; mrv: number }
export const MUSCLE_LANDMARKS: Record<string, Landmarks> = {
  chest:        { mv: 6, mev: 8,  mav: 20, mrv: 22 },
  'upper-back': { mv: 8, mev: 10, mav: 22, mrv: 25 },
  'lower-back': { mv: 4, mev: 6,  mav: 14, mrv: 18 },
  trapezius:    { mv: 4, mev: 8,  mav: 20, mrv: 26 },
  deltoids:     { mv: 6, mev: 8,  mav: 22, mrv: 26 },
  biceps:       { mv: 6, mev: 8,  mav: 20, mrv: 26 },
  triceps:      { mv: 4, mev: 6,  mav: 14, mrv: 18 },
  forearm:      { mv: 2, mev: 4,  mav: 12, mrv: 16 },
  abs:          { mv: 0, mev: 6,  mav: 20, mrv: 25 },
  obliques:     { mv: 0, mev: 4,  mav: 16, mrv: 20 },
  quadriceps:   { mv: 6, mev: 8,  mav: 18, mrv: 20 },
  hamstring:    { mv: 4, mev: 6,  mav: 16, mrv: 20 },
  gluteal:      { mv: 0, mev: 4,  mav: 12, mrv: 16 },
  adductors:    { mv: 2, mev: 4,  mav: 12, mrv: 16 },
  calves:       { mv: 6, mev: 8,  mav: 16, mrv: 20 },
  neck:         { mv: 0, mev: 4,  mav: 12, mrv: 16 },
}

// ── Diverging bands ─────────────────────────────────────────────────────────
export interface BandMeta { idx: number; label: string; color: string; desc: string }
export const BANDS_META: BandMeta[] = [
  { idx: 0, label: 'Not trained',       color: '#4b5563', desc: 'No working sets for this muscle in the period.' },
  // Labels softened to conditional language per the science review: a low
  // 30-day average can just be a deload, and "over MRV" depends on unmeasured
  // recovery/effort — so neither asserts loss or wasted work as fact.
  { idx: 1, label: 'Below maintenance', color: '#3b82f6', desc: 'Probably not enough to build or hold this muscle over time. (A low number can also just reflect a recent light/rest week — check the trend.)' },
  { idx: 2, label: 'Maintenance',       color: '#14b8a6', desc: 'Enough to maintain, but below the minimum that reliably drives growth (MEV).' },
  { idx: 3, label: 'Optimal growth',    color: '#22c55e', desc: 'Inside the productive hypertrophy range (MEV–MAV) — the sweet spot.' },
  { idx: 4, label: 'High',              color: '#f59e0b', desc: 'Above the typical adaptive range (MAV) — near the usual recoverable ceiling.' },
  { idx: 5, label: 'Over MRV',          color: '#ef4444', desc: 'More than typical recovery guidelines suggest. Whether it is actually "too much" depends on your effort, sleep and recovery — none of which this measures. If you are recovering fine, no need to cut.' },
]

export function bandForWeeklySets(slug: string, weeklySets: number): number {
  if (weeklySets <= 0) return 0
  const L = MUSCLE_LANDMARKS[slug]
  if (!L) return 3
  if (weeklySets < L.mv)  return 1
  if (weeklySets < L.mev) return 2
  if (weeklySets <= L.mav) return 3
  if (weeklySets <= L.mrv) return 4
  return 5
}

// Colour for a muscle, selection-aware: full band colour, or grey when a
// selection is active and this muscle isn't in it.
export const UNTRAINED_COLOR = BANDS_META[0].color

// Which mapped slugs are visible on each body side (some show on both).
export const SIDE_SLUGS: Record<'front' | 'back', ReadonlySet<Slug>> = {
  front: new Set<Slug>(['chest', 'abs', 'biceps', 'quadriceps', 'adductors', 'deltoids', 'forearm', 'neck']),
  back:  new Set<Slug>(['upper-back', 'trapezius', 'lower-back', 'triceps', 'hamstring', 'gluteal', 'calves', 'deltoids', 'forearm']),
}

const SLUG_LABEL: Record<string, string> = {
  abs: 'Abs', deltoids: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps',
  forearm: 'Forearms', quadriceps: 'Quadriceps', hamstring: 'Hamstrings',
  calves: 'Calves', gluteal: 'Glutes', adductors: 'Adductors',
  'upper-back': 'Back (lats / upper)', trapezius: 'Traps', 'lower-back': 'Lower back',
  chest: 'Chest', neck: 'Neck', obliques: 'Obliques',
}

export function labelForSlug(slug: string): string {
  return SLUG_LABEL[slug] ?? slug.replace(/-/g, ' ')
}

// ── Consumer-facing helpers (expert review) ─────────────────────────────────
// The muscles a normal lifter actually trains/intends to — used to filter the
// verdict banner so it never nags about neck/adductors sitting at 0 sets
// ("you're neglecting your neck!" destroys trust). An unlisted muscle at low
// volume is simply not flagged as a problem.
export const MAJOR_MUSCLES: ReadonlySet<Slug> = new Set<Slug>([
  'chest', 'upper-back', 'deltoids', 'biceps', 'triceps',
  'quadriceps', 'hamstring', 'gluteal', 'abs', 'trapezius',
])

// "What to do next" for a muscle: how far its weekly sets are from the nearest
// edge of the growth sweet spot, translated to whole sets and rough sessions
// (≈4 added sets ≈ one more session). Returns null when it's in range / no
// landmark. Numbers are rounded — landmark integers aren't precise (see notes).
export function setDeltaToRange(slug: string, weeklySets: number):
  | { kind: 'add'; sets: number; sessions: number; mev: number; mav: number }
  | { kind: 'cut'; sets: number; mrv: number }
  | null {
  const L = MUSCLE_LANDMARKS[slug]
  if (!L) return null
  if (weeklySets < L.mev) {
    const deficit = Math.max(1, Math.round(L.mev - weeklySets))
    return { kind: 'add', sets: deficit, sessions: Math.max(1, Math.ceil(deficit / 4)), mev: L.mev, mav: L.mav }
  }
  if (weeklySets > L.mrv) {
    return { kind: 'cut', sets: Math.max(1, Math.round(weeklySets - L.mrv)), mrv: L.mrv }
  }
  return null
}
