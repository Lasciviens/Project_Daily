import type { ReactNode } from 'react'
import type { Pin } from './useChartDrilldown'
import { X } from 'lucide-react'

// ONE drill-down interaction for every daily Health chart (H-11). Before this,
// Steps/Energy/Heart put "Go to this day" inside the HOVER tooltip — which
// re-anchors or hides the moment the pointer moves toward it, so the link was
// unreachable in practice — Sleep had a pinned popover, and Energy showed a
// pointer cursor with no click handler at all.
//
// Now: hover (or a tap) shows values; a click pins this popover at the clicked
// point, carrying the day's values and its actions. Clicking the same point
// again, ✕ or Escape closes it. The hover tooltip is hidden while a pin is open
// so two boxes never show at once.

export interface PinAction { label: string; onClick: () => void }

export function ChartPin({ pin, title, children, actions, onClose }: {
  pin: Pin
  title: ReactNode
  children?: ReactNode
  actions: PinAction[]
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-label="Day details"
      className="menu absolute z-popover w-[208px] px-2.5 py-2 text-meta"
      style={{ left: pin.x, top: pin.y, transform: 'translate(-50%, calc(-100% - 10px))' }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="font-medium text-fg-muted">{title}</p>
          {children}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="icon-btn -mr-1 -mt-1">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {actions.length > 0 && (
        <div className="mt-0.5 flex flex-col items-start">
          {actions.map(a => (
            <button key={a.label} type="button" onClick={() => { a.onClick(); onClose() }}
              className="flex min-h-[44px] items-center text-meta font-semibold text-accent-600">
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
