import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseHandlerDataParam } from 'recharts'

// State for the shared chart drill-down pin (see ChartPin.tsx): which point is
// pinned and where. The chart's own onClick reports the category index and
// the pointer position, so any bar or line chart can use it.
export interface Pin { index: number; x: number; y: number }

export function useChartDrilldown(enabled: boolean) {
  const [pin, setPin] = useState<Pin | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pin) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPin(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pin])

  const onChartClick = useCallback((state: MouseHandlerDataParam) => {
    if (!enabled) return
    const index = Number(state?.activeIndex)
    if (!Number.isInteger(index) || index < 0) return
    // Clamp at event time (refs must not be read during render) so the
    // popover never sticks out of the card.
    const w = wrapRef.current?.offsetWidth ?? 600
    const x = Math.min(Math.max(state.activeCoordinate?.x ?? w / 2, 104), w - 104)
    const y = Math.max(state.activeCoordinate?.y ?? 0, 0)
    setPin(p => (p?.index === index ? null : { index, x, y }))
  }, [enabled])

  return { pin, close: useCallback(() => setPin(null), []), wrapRef, onChartClick }
}

