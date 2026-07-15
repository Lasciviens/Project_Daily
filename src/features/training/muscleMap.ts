import type { Slug } from 'react-muscle-highlighter'

// ─────────────────────────────────────────────────────────────────────────────
//  Complete Hevy `primary_muscle_group` enum (verified against Hevy's OpenAPI
//  spec, components/schemas/MuscleGroup) → the react-muscle-highlighter body
//  slug it colours. Every Hevy exercise's primary_muscle_group is one of these
//  20 keys, so EVERY exercise maps. cardio/full_body/other aren't single
//  muscles → null (never highlighted, by design).
// ─────────────────────────────────────────────────────────────────────────────

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
  abductors:  'gluteal',     // hip abductors (glute med/min) — nearest visible region
  adductors:  'adductors',
  lats:       'upper-back',  // no dedicated lats slug; lats live in the upper-back region
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
  return HEVY_TO_SLUG[group.toLowerCase()] ?? null
}

// Low→high intensity ramp (teal → red), matching the reference activation legend
// (low = teal, high = red). Fixed data-viz colours (not UI chrome).
export const RAMP = ['#2dd4bf', '#84cc16', '#facc15', '#fb923c', '#ef4444']
export const BANDS = RAMP.length

// Neutral colour for muscles not worked in the selected period.
export const BASE_MUSCLE_COLOR = '#6f6a63'

// Human labels for the slugs we actually colour.
const SLUG_LABEL: Record<string, string> = {
  abs: 'Abs', deltoids: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps',
  forearm: 'Forearms', quadriceps: 'Quadriceps', hamstring: 'Hamstrings',
  calves: 'Calves', gluteal: 'Glutes', adductors: 'Adductors',
  'upper-back': 'Back (lats / upper)', trapezius: 'Traps', 'lower-back': 'Lower back',
  chest: 'Chest', neck: 'Neck',
}

export function labelForSlug(slug: string): string {
  return SLUG_LABEL[slug] ?? slug.replace(/-/g, ' ')
}

// Which mapped slugs are visible on each body side (some — deltoids, forearm —
// show on both). Used to filter the stats to the side currently being viewed.
export const SIDE_SLUGS: Record<'front' | 'back', ReadonlySet<Slug>> = {
  front: new Set<Slug>(['chest', 'abs', 'biceps', 'quadriceps', 'adductors', 'deltoids', 'forearm', 'neck']),
  back:  new Set<Slug>(['upper-back', 'trapezius', 'lower-back', 'triceps', 'hamstring', 'gluteal', 'calves', 'deltoids', 'forearm']),
}
