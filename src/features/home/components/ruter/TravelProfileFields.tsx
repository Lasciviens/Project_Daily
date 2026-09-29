import type { ReactNode } from 'react'
import { useTravelProfile, type WalkPace } from '../../hooks/useTravelProfile'
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
