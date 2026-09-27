/**
 * Colours for the weekly-volume body map: the six volume bands (index = band)
 * and the two limitation flags, for SVG fills and swatches.
 *
 * One fixed palette, not theme tokens: the diagram always sits on a dark stage
 * (bg-scrim) in both themes, and the light-theme tone values are too dark and
 * too close to each other there — after the restyle below-maintenance (cyan),
 * maintenance (teal) and optimal (green) looked alike and untrained grey was
 * brighter than trained muscles. The bands are a category the user reads by
 * colour, so they stay literal in this one constant (THEME.md §2, identity
 * colours). Flags are violet so they never read as a status colour.
 */
export const BODY_MAP_COLORS = {
  bands: ['#4b5563', '#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444'] as const,
  flag: { avoid: '#7c3aed', limit: '#a78bfa' },
  untrained: '#4b5563',
} as const

export type BodyMapColors = typeof BODY_MAP_COLORS

/** Kept as a hook so call sites read the same way as useChartColors(). */
export function useBandColors(): BodyMapColors {
  return BODY_MAP_COLORS
}
