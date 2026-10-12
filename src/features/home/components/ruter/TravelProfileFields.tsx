import type { ReactNode } from 'react'
import { useTravelProfile, WALK_SPEED_MPS, type WalkPace } from '../../hooks/useTravelProfile'
import { cx } from '../../../../shared/ui'

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'min-h-[44px] flex-1 rounded-control border px-2 text-body capitalize transition-colors duration-150',
        active ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-line text-fg-2 hover:bg-surface-hover',
      )}
    >
      {children}
    </button>
  )
}

/** "about 4.7 km/h — a 400 m walk takes about 5 min" for a pace. */
function paceEffect(pace: WalkPace): string {
  const mps = WALK_SPEED_MPS[pace]
  const kmh = (mps * 3.6).toFixed(1)
  return `About ${kmh} km/h — a 400 m walk takes about ${Math.round(400 / mps / 60)} min.`
}

/** Walking pace, transfers and accessibility — applied to every route search (Transit settings, Settings → Places). */
export function TravelProfileFields() {
  const { profile, update: updateProfile } = useTravelProfile()
  return (
    <div className="space-y-3">
      <div>
        <p className="field-label">Walking pace</p>
        <div className="flex gap-1.5">
          {(['slow', 'normal', 'fast'] as WalkPace[]).map(pace => (
            <Choice key={pace} active={profile.walkPace === pace} onClick={() => updateProfile({ walkPace: pace })}>{pace}</Choice>
          ))}
        </div>
        <p className="mt-1.5 text-meta text-fg-muted">
          {paceEffect(profile.walkPace)} Every walk in a trip (to the stop, between platforms, to where you're
          going) is timed at this pace, so it changes when to leave and which changes are reachable. Slow leaves
          more time; Fast allows tighter changes.
        </p>
      </div>
      <div>
        <p className="field-label">Maximum transfers</p>
        <div className="flex gap-1.5">
          {[null, 0, 1, 2].map(n => (
            <Choice key={n ?? 'any'} active={profile.maximumTransfers === n} onClick={() => updateProfile({ maximumTransfers: n })}>
              {n === null ? 'No limit' : n}
            </Choice>
          ))}
        </div>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-body text-fg-2">
        <input
          type="checkbox"
          checked={profile.wheelchairAccessible}
          onChange={e => updateProfile({ wheelchairAccessible: e.target.checked })}
          className="rounded border-line-strong"
        />
        Wheelchair-accessible routes only
      </label>
    </div>
  )
}
