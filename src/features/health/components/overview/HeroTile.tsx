import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Skeleton, TonePill, cx, type Tone } from '../../../../shared/ui'

// One "How you're doing" tile: value, change vs the previous window, ONE tone
// band against a cited reference, one line of why. The whole tile is the tap
// target for its detail sheet.

export interface HeroTileProps {
  icon: ReactNode
  label: string
  value: ReactNode
  unit?: ReactNode
  /** Secondary figure under the value. */
  sub?: ReactNode
  change?: { text: string; tone: Tone } | null
  band?: { label: string; tone: Tone } | null
  why: string
  isLoading?: boolean
  /** Shown instead of the value when there is no data. */
  empty?: string | null
  onOpen: () => void
}

export function HeroTile({ icon, label, value, unit, sub, change, band, why, isLoading, empty, onOpen }: HeroTileProps) {
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog"
      className="card-interactive flex min-h-[44px] min-w-0 flex-col gap-2 p-4 text-left">
      <span className="flex items-center gap-2">
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        <span className="section-label min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
      </span>
      {isLoading ? (
        <span className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-44" />
        </span>
      ) : empty ? (
        <span className="text-meta text-fg-muted">{empty}</span>
      ) : (
        <>
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-kpi font-bold leading-tight tabular-nums tracking-tight text-fg">
              {value}
              {unit != null && <span className="text-body font-normal text-fg-muted"> {unit}</span>}
            </span>
            {change && (
              <span data-tone={change.tone} className={cx('text-meta font-semibold tabular-nums', change.tone !== 'neutral' ? 'tone-text' : 'text-fg-muted')}>
                {change.text}
              </span>
            )}
          </span>
          {sub != null && <span className="text-meta text-fg-2">{sub}</span>}
          {band && <TonePill tone={band.tone} className="self-start">{band.label}</TonePill>}
        </>
      )}
      <span className="mt-auto text-micro font-normal leading-snug text-fg-muted">{why}</span>
    </button>
  )
}
