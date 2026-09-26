import { useMemo } from 'react'
import { useChartColors } from '../../../shared/ui'

/**
 * Resolved colours for the six volume bands (index = band) and the two
 * limitation flags, for SVG fills and swatches. Both "maintenance" bands are
 * informational, so maintenance takes the teal categorical series to stay
 * distinguishable from below-maintenance; flags take the violet series so they
 * never read as a status colour.
 */
export function useBandColors() {
  const c = useChartColors()
  return useMemo(() => ({
    bands: [c.neutral, c.info, c.series[0], c.success, c.warn, c.danger],
    flag: { avoid: c.series[1], limit: withAlpha(c.series[1], 0.55) },
    untrained: c.neutral,
  }), [c])
}

/** `rgb(r, g, b)` → `rgb(r g b / a)`; other strings pass through. */
export function withAlpha(rgb: string, alpha: number): string {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  return m ? `rgb(${m[1]} ${m[2]} ${m[3]} / ${alpha})` : rgb
}
