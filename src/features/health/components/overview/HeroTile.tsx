import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { KeepRoom, Skeleton, TonePill, cx, type Tone, Truncate } from '../../../../shared/ui'
import type { Aim } from '../../benchmarks/healthBenchmarks'
import { AimLine } from './AimLine'

/**
 * A tile's middle (its figures and Aim) before this device has seen it loaded, in rem: one line and the Aim's two —
 * what every tile shows, also one with no readings ("No steps recorded…"). The old loading copy's height too.
 */
const FIRST_ROOM_REM = 3.5

/**
 * The loading copy of a tile's middle: a loaded tile's rows (value, figure under it, range pill, Aim), drawn in
 * the room KeepRoom keeps and cut to it — the room is the tile's own last height, never this copy's.
 */
const TILE_SKELETON = (
  <span aria-busy="true" className="absolute inset-0 flex flex-col gap-2 overflow-hidden">
    <span className="flex h-[2.0625rem] shrink-0 items-center"><Skeleton className="h-7 w-32" /></span>
    <Skeleton className="h-4 w-44 shrink-0" />
    <Skeleton rounded="rounded-full" className="h-5 w-40 shrink-0" />
    <span className="flex h-[2.0625rem] shrink-0 flex-col justify-center gap-1.5"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></span>
  </span>
)

// One "How you're doing" tile: value, change vs the previous window, ONE tone
// band against a cited reference and which way is better, what to aim for,
// and one plain sentence on what the metric means in everyday life. The
// citations live in the detail sheet; the whole tile is its tap target.

export interface HeroTileProps {
  /** The tile's name in the layout memory: its middle keeps the room it took last time while it loads. */
  id: string
  icon: ReactNode
  label: string
  value: ReactNode
  unit?: ReactNode
  /** Secondary figure under the value. */
  sub?: ReactNode
  change?: { text: string; tone: Tone } | null
  band?: { label: string; tone: Tone } | null
  /** "Lower is better" / "Higher is better" / "A healthy range is best". */
  better?: string
  aim?: Aim | null
  /** What the short name stands for and means in everyday life. */
  plain: string
  isLoading?: boolean
  /** A read the tile is drawn from failed: its height is not remembered for the next visit. */
  failed?: boolean
  /** Shown instead of the value when there is no data. */
  empty?: string | null
  onOpen: () => void
}

export function HeroTile({ id, icon, label, value, unit, sub, change, band, better, aim, plain, isLoading, failed, empty, onOpen }: HeroTileProps) {
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog"
      className="card-interactive flex min-h-[44px] min-w-0 flex-col gap-2 p-4 text-left">
      <span className="flex items-center gap-2">
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        <Truncate className="section-label flex-1">{label}</Truncate>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
      </span>
      {/* While the numbers load, the middle keeps the room this tile's took last time (THEME.md §5): a tile with
          readings is twice as tall as one without, and only the owner's data says which it will be. */}
      <KeepRoom as="span" ids={`health:tile:${id}`} loading={!!isLoading} remember={!failed} first={FIRST_ROOM_REM} skeleton={TILE_SKELETON}
        className={cx('flex flex-col gap-2', isLoading && 'relative')}>
        {empty ? (
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
            {(band || better) && (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {band && <TonePill tone={band.tone}>{band.label}</TonePill>}
                {better && <span className="text-micro font-normal text-fg-muted">{better}</span>}
              </span>
            )}
          </>
        )}
        {aim && <AimLine aim={aim} />}
      </KeepRoom>
      <span className="mt-auto text-micro font-normal leading-snug text-fg-muted">{plain}</span>
    </button>
  )
}
