import { Link } from 'react-router-dom'
import { Briefcase, Home } from 'lucide-react'
import type { UserTransitStop } from '../../hooks/useTransitStops'
import { findPlace, PLACE_LABEL, type PlaceKind } from '../../transitPlaces'

const PLACE_ICON: Record<PlaceKind, typeof Home> = { home: Home, work: Briefcase }
const KINDS: PlaceKind[] = ['home', 'work']

/** Two one-tap trips to the saved Home / Work places (Settings → Places). */
export function PlaceButtons({ stops, disabled, hideMissing = false, onPick }: {
  stops: readonly UserTransitStop[]
  disabled?: boolean
  /** Home's card: only the places that are set, and no "not set" hint (the planner keeps it). */
  hideMissing?: boolean
  onPick: (stop: UserTransitStop) => void
}) {
  const all = KINDS.map(kind => ({ kind, stop: findPlace(stops, kind) }))
  const places = hideMissing ? all.filter(p => p.stop) : all
  const missing = hideMissing ? [] : all.filter(p => !p.stop).map(p => PLACE_LABEL[p.kind])
  if (places.length === 0) return null
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        {places.map(({ kind, stop }) => {
          const Icon = PLACE_ICON[kind]
          return (
            <button
              key={kind}
              type="button"
              disabled={!stop || disabled}
              onClick={() => stop && onPick(stop)}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-control border border-line bg-surface-2 px-3 text-body font-semibold text-fg transition-colors duration-150 hover:bg-surface-hover disabled:opacity-50"
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0 text-accent-600" />To {PLACE_LABEL[kind].toLowerCase()}
            </button>
          )
        })}
      </div>
      {missing.length > 0 && (
        <p className="mt-1 text-meta text-fg-muted">
          {missing.join(' and ')} not set.{' '}
          <Link to="/settings?tab=places" className="inline-flex min-h-[44px] items-center font-semibold text-accent-600">Set in Settings → Places</Link>
        </p>
      )}
    </div>
  )
}
