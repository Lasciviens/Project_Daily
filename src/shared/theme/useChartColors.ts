import { useMemo } from 'react'
import { useThemeStore } from '../../app/store'

// SVG presentation attributes (recharts' fill/stroke props) can't resolve CSS
// variables, so charts read the resolved token values here. Re-computes when
// light/dark or the accent changes.
const read = (name: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
  return v ? `rgb(${v.split(/\s+/).join(', ')})` : 'currentColor'
}

export interface ChartColors {
  /** Categorical series, in order. Never the accent. */
  series: string[]
  accent: string
  grid: string
  axis: string
  tooltipBg: string
  success: string
  warn: string
  danger: string
  info: string
  neutral: string
}

export function useChartColors(): ChartColors {
  const theme = useThemeStore(s => s.theme)
  const accent = useThemeStore(s => s.accent)
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  return useMemo(() => ({
    series: [1, 2, 3, 4, 5, 6].map(i => read(`chart-${i}`)),
    accent: read('accent-500'),
    grid: read('ink-200'),
    axis: read('ink-500'),
    tooltipBg: read('cream-50'),
    success: read('success'),
    warn: read('warn'),
    danger: read('danger'),
    info: read('info'),
    neutral: read('neutral'),
  // theme/accent/dark are the invalidation signals for the computed style.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme, accent, dark])
}
