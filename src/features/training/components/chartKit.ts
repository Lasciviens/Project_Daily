import { useMemo, type CSSProperties } from 'react'
import { useChartColors } from '../../../shared/ui'

/** Class list for a custom recharts tooltip `content` renderer. */
export const TOOLTIP_BOX = 'rounded-row border border-line-strong bg-surface px-2.5 py-1.5 text-meta shadow-menu space-y-0.5'

/** Styles for recharts' built-in Tooltip, resolved from the theme tokens. */
export function useTooltipStyle(): { contentStyle: CSSProperties; labelStyle: CSSProperties; itemStyle: CSSProperties } {
  const c = useChartColors()
  return useMemo(() => ({
    contentStyle: { fontSize: 12, borderRadius: 12, padding: '6px 10px', background: c.tooltipBg, border: `1px solid ${c.grid}` },
    labelStyle: { color: c.axis, fontWeight: 500 },
    itemStyle: { padding: 0 },
  }), [c])
}

/** Axis tick props (font size + token colour). */
export function useAxisTick(fontSize = 10) {
  const c = useChartColors()
  return useMemo(() => ({ fontSize, fill: c.axis }), [c, fontSize])
}
