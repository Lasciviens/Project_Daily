import type { Slug } from 'react-muscle-highlighter'
import type { ExperienceLevel } from './types.athlete'

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

/** Shared shape for the two consumers (WeeklySetsPerMuscleChart, Training
 *  Analysis) that need "which slugs does this exercise credit" per template —
 *  one mapping built once instead of two near-identical inline loops. */
export interface TemplateMuscleCredit { primarySlug: Slug | null; secondarySlugs: Slug[] }

export function buildTemplateMuscleMap(
  templates: { id: string; primary_muscle_group: string | null; secondary_muscle_groups: string[] }[],
): Map<string, TemplateMuscleCredit> {
  const m = new Map<string, TemplateMuscleCredit>()
  for (const t of templates) {
    m.set(t.id, {
      primarySlug: slugForHevyGroup(t.primary_muscle_group),
      secondarySlugs: t.secondary_muscle_groups.map(slugForHevyGroup).filter((s): s is Slug => s != null),
    })
  }
  return m
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

// `landmarksOverride` lets a caller that already scaled the landmarks for
// experience level (scaleLandmarksForExperience) pass that SAME object in,
// so the band this returns always agrees with whatever band/threshold is
// drawn on screen from it — real bug, fixed: WeeklySetsPerMuscleChart used to
// draw its ReferenceArea/ReferenceLine from scaled landmarks but call this
// function with no override, silently falling back to the raw unscaled
// table for the badge color, disagreeing by exactly the ±15% experience
// multiplier. WorkedMuscles.tsx never had this bug (it always scales first).
export function bandForWeeklySets(slug: string, weeklySets: number, landmarksOverride?: Landmarks): number {
  if (weeklySets <= 0) return 0
  const L = landmarksOverride ?? MUSCLE_LANDMARKS[slug]
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

// ── Athlete profile: movement-pattern taxonomy + limitation → muscle seam ───
// A short, fixed vocabulary of standard resistance-training movement patterns
// (not exotic — the same categories any S&C coach or a functional movement
// screen would use). This is what `athlete_limitations.movement_pattern`
// stores, and it is deliberately NOT one-to-one with a muscle: a limitation is
// on a MOVEMENT (e.g. "avoid overhead pressing — shoulder"), and
// PATTERN_AFFECTED_SLUGS below is the derivation seam that turns that into a
// per-muscle flag for a UI keyed by `Slug`, without the DB ever storing a
// muscle slug directly.
export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'horizontal_press'
  | 'vertical_press'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'lunge'
  | 'carry'
  | 'isolation'

export const MOVEMENT_PATTERN_LABEL: Record<MovementPattern, string> = {
  squat:            'Squat',
  hinge:            'Hinge (deadlift pattern)',
  horizontal_press: 'Horizontal Press (bench / push-up)',
  vertical_press:   'Vertical Press (overhead)',
  horizontal_pull:  'Horizontal Pull (row)',
  vertical_pull:    'Vertical Pull (pull-up / pulldown)',
  lunge:            'Lunge / Single-leg',
  carry:            'Loaded Carry',
  isolation:        'Isolation (single-joint)',
}

// Which muscles a restriction on this PATTERN realistically affects, and how
// hard: 'avoid' = this muscle has no comparable alternative loading pattern,
// so restricting the pattern effectively takes heavy loading of the muscle
// off the menu too; 'limit' = the muscle is a mover/stabiliser in this
// pattern but still has other patterns/isolation work that can train it, so
// even a pattern-level "avoid" limitation only caps this muscle at "train it,
// carefully" rather than zeroing it out — e.g. a shoulder-driven overhead
// restriction doesn't ban flat pressing, so deltoids/triceps stay 'limit'
// there, never 'avoid'. This is a coaching judgement call, same honesty as
// ROLE_WEIGHTS above — not a measured constant. `isolation` has no fixed
// muscle list: it is a catch-all spanning whatever single-joint exercise is
// in question, too broad to pin to specific slugs without exercise-level
// data (out of scope here).
export const PATTERN_AFFECTED_SLUGS: Record<MovementPattern, { slug: Slug; weight: 'avoid' | 'limit' }[]> = {
  squat: [
    { slug: 'quadriceps', weight: 'avoid' }, // primary knee-extension driver, no comparable substitute at heavy load
    { slug: 'gluteal',    weight: 'limit' }, // also trained via hinge/lunge
    { slug: 'adductors',  weight: 'limit' }, // stabiliser, also trained via lateral/isolation work
    { slug: 'lower-back', weight: 'avoid' }, // axial spinal loading — the usual concern behind a squat restriction
  ],
  hinge: [
    { slug: 'hamstring',  weight: 'limit' }, // also trained via lunges/leg curls
    { slug: 'gluteal',    weight: 'limit' }, // also trained via squat/lunge
    { slug: 'lower-back', weight: 'avoid' }, // hinge is the primary axial-loading pattern for this muscle
  ],
  horizontal_press: [
    { slug: 'chest',    weight: 'avoid' }, // primary chest-loading pattern, no comparable substitute at heavy load
    { slug: 'triceps',  weight: 'limit' }, // also trained via vertical press/isolation
    { slug: 'deltoids', weight: 'limit' }, // anterior-delt synergist, also trained via vertical press
  ],
  vertical_press: [
    { slug: 'deltoids', weight: 'limit' }, // also trained via horizontal press/lateral raises — doesn't ban flat pressing
    { slug: 'triceps',  weight: 'limit' }, // also trained via horizontal press/isolation
  ],
  horizontal_pull: [
    { slug: 'upper-back', weight: 'limit' }, // also trained via vertical pull
    { slug: 'trapezius',  weight: 'limit' }, // also trained via other pulling patterns
    { slug: 'biceps',     weight: 'limit' }, // secondary elbow flexor, also trained via vertical pull/isolation
  ],
  vertical_pull: [
    { slug: 'upper-back', weight: 'avoid' }, // lat width/depth is primarily loaded through vertical pulling
    { slug: 'biceps',     weight: 'limit' }, // also trained via horizontal pull/isolation
    { slug: 'forearm',    weight: 'limit' }, // grip synergist, also trained via carries/isolation
  ],
  lunge: [
    { slug: 'quadriceps', weight: 'limit' }, // also trained via squat/isolation
    { slug: 'gluteal',    weight: 'limit' }, // also trained via squat/hinge
    { slug: 'hamstring',  weight: 'limit' }, // also trained via hinge/isolation
    { slug: 'adductors',  weight: 'limit' }, // stabiliser, also trained via squat/isolation
  ],
  carry: [
    { slug: 'trapezius',  weight: 'limit' }, // also trained via pulls/shrugs
    { slug: 'forearm',    weight: 'limit' }, // grip, also trained via vertical pull/isolation
    { slug: 'lower-back', weight: 'limit' }, // isometric bracing load, lighter than squat/hinge's dynamic axial load
  ],
  isolation: [],
}

/** Which slugs carry an active training restriction, and how hard — the
 *  cross-check `trainingInsights.ts`'s Training Analysis panel needs before
 *  it tells a user to add volume to a muscle they've deliberately limited
 *  (a sports-scientist review, 2026-09-01, flagged the missing check as this
 *  app's most serious correctness defect: the panel is presented as a
 *  canonical verdict, and advice that contradicts a restriction the app
 *  already stores is worse than no advice). 'monitor'-severity limitations
 *  are excluded — that severity means "watch it", not "restricted", so it
 *  carries no volume implication. Same exact `PATTERN_AFFECTED_SLUGS[...] ??
 *  []` lookup WorkedMuscles.tsx already uses for its own flagged-muscle
 *  state — one mapping, not two — which also means the same caveat applies
 *  here: `movement_pattern` is free text on the DB side (see PATTERN_AFFECTED_SLUGS's
 *  own header comment), so a limitation whose phrasing doesn't match one of
 *  the nine `MovementPattern` keys exactly produces no match, same as it
 *  already does for the Muscles tab today. Worst case wins when two
 *  limitations disagree on one muscle ('avoid' never downgrades to 'limit'). */
export function limitedSlugsFromLimitations(
  limitations: { movement_pattern: string; severity: 'avoid' | 'limit' | 'monitor'; active: boolean }[],
): Map<Slug, 'avoid' | 'limit'> {
  const out = new Map<Slug, 'avoid' | 'limit'>()
  for (const lim of limitations) {
    if (!lim.active || lim.severity === 'monitor') continue
    for (const { slug, weight } of PATTERN_AFFECTED_SLUGS[lim.movement_pattern as MovementPattern] ?? []) {
      if (out.get(slug) !== 'avoid') out.set(slug, weight)
    }
  }
  return out
}

// ── Experience-scaled landmarks ──────────────────────────────────────────────
// RP framework: MEV/MRV shift with training age (a novice grows on less
// volume and can't yet tolerate as much; an advanced lifter needs more to
// keep progressing and can recover from more). MV/MAV are left UNSCALED on
// purpose — this was a cross-examined agreement, not an oversight: scaling
// the whole landmark set by experience would overclaim precision on a table
// that is already a heuristic, not a measured constant (same honesty as
// ROLE_WEIGHTS/BANDS_META above).
export const EXPERIENCE_MULTIPLIER: Record<ExperienceLevel, number> = {
  novice:       0.85,
  intermediate: 1,
  advanced:     1.15,
}

export function scaleLandmarksForExperience(L: Landmarks, level: ExperienceLevel | null | undefined): Landmarks {
  if (!level) return L
  const m = EXPERIENCE_MULTIPLIER[level]
  return { ...L, mev: Math.round(L.mev * m), mrv: Math.round(L.mrv * m) }
}
