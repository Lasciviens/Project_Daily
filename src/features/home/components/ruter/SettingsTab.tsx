import { useState, type ReactNode } from 'react'
import { MapPin, Star, X } from 'lucide-react'
import { useTransitStops, DuplicateStopError } from '../../hooks/useTransitStops'
import { useTransitRoutes } from '../../hooks/useTransitRoutes'
import { useNearbyStops } from '../../hooks/useTransitQueries'
import { useTravelProfile, type WalkPace } from '../../hooks/useTravelProfile'
import type { StopResult } from '../../api/ruterApi'
import { useEntityModal } from '../../../../shared/modals'
import { IconButton, SectionLabel, cx } from '../../../../shared/ui'
import { StopSearchInput } from './StopSearchInput'
import { QuaySavePanel } from './QuaySavePanel'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <SectionLabel className="mb-2">{title}</SectionLabel>
      {children}
    </section>
  )
}

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

export function SettingsTab({ active = true, onSelectRoute }: { active?: boolean; onSelectRoute?: (routeId: string) => void }) {
  const { stops, addStop, updateStop, removeStop, setDefault } = useTransitStops()
  const { routes, removeRoute } = useTransitRoutes()
  const { profile, update: updateProfile } = useTravelProfile()
  const modal = useEntityModal()

  const [newStop, setNewStop] = useState<StopResult | null>(null)
  // Off by default: most searches are for a transit stop, and addresses made results noisier.
  const [includeAddresses, setIncludeAddresses] = useState(false)

  // One-tap add for stops around you — adding "Home" shouldn't need typing its name while standing there.
  const { data: nearby = [] } = useNearbyStops({ enabled: active })

  async function handleSaveNewStop(quayId: string | null, quayDescription: string | null, label: string) {
    if (!newStop) return
    try {
      await addStop(newStop, quayId ?? undefined, quayDescription ?? undefined, label !== newStop.name ? label : undefined)
      setNewStop(null)
    } catch (e) {
      if (!(e instanceof DuplicateStopError)) return
      const proceed = await modal.confirm({
        title: 'Update the saved stop?',
        message: `You already have this saved as "${e.existing.label ?? e.existing.stop_name}". Update it with this direction and label instead?`,
        confirmLabel: 'Update stop',
      })
      if (!proceed) return
      try {
        await updateStop(e.existing.id, { label, quayId, quayDescription })
        setNewStop(null)
      } catch { /* toasted by the hook */ }
    }
  }

  async function handleRemoveStop(id: string, name: string) {
    if (!(await modal.confirm({ title: `Remove ${name}?`, confirmLabel: 'Remove', destructive: true }))) return
    removeStop(id).catch(() => { /* toasted by the hook */ })
  }

  async function handleRemoveRoute(id: string, name: string) {
    if (!(await modal.confirm({ title: `Remove ${name}?`, confirmLabel: 'Remove', destructive: true }))) return
    removeRoute(id).catch(() => { /* toasted by the hook */ })
  }

  return (
    <div className="space-y-4">
      <Section title="Add a stop">
        {!newStop && nearby.length > 0 && (
          <div className="mb-2">
            <p className="mb-1.5 flex items-center gap-1 text-meta text-fg-muted"><MapPin aria-hidden className="h-3.5 w-3.5" />Near you</p>
            <div className="flex flex-wrap gap-1.5">
              {nearby.map(n => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setNewStop({ id: n.id, name: n.name, layer: 'venue' })}
                  className="min-h-[44px] rounded-control border border-line px-3 text-meta text-fg-2 transition-colors duration-150 hover:bg-surface-hover"
                >
                  {n.name} <span className="tabular-nums text-fg-muted">· {n.distance} m</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!newStop && (
          <>
            <StopSearchInput placeholder="Search any stop…" onSelect={setNewStop} stopsOnly={!includeAddresses} />
            <label className="mt-1 flex min-h-[44px] items-center gap-2 text-meta text-fg-muted">
              <input type="checkbox" checked={includeAddresses} onChange={e => setIncludeAddresses(e.target.checked)} className="rounded border-line-strong" />
              Include addresses (for trip planning — no live departures)
            </label>
          </>
        )}

        {newStop && (
          <>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-body font-medium text-fg">{newStop.name}</span>
              <button type="button" onClick={() => setNewStop(null)} className="min-h-[44px] px-1 text-meta font-semibold text-accent-600">
                Change
              </button>
            </div>
            <QuaySavePanel stopId={newStop.id} stopName={newStop.name} onSave={handleSaveNewStop} onCancel={() => setNewStop(null)} />
          </>
        )}
      </Section>

      <Section title="Favourite stops">
        {stops.length === 0 && <p className="text-meta text-fg-muted">No stops saved yet — add one above.</p>}
        <ul className="space-y-0.5">
          {stops.map(s => (
            <li key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { if (!s.is_default) setDefault(s.id).catch(() => { /* toasted by the hook */ }) }}
                className="row row-interactive min-w-0 flex-1 text-left"
                title={s.is_default ? 'Default stop' : 'Set as default'}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-body text-fg">{s.label ?? s.stop_name}</span>
                  {s.label && <span className="ml-1.5 text-meta text-fg-muted">{s.stop_name}</span>}
                  {s.stop_locality && <span className="ml-1.5 text-meta text-fg-muted">{s.stop_locality}</span>}
                </span>
                {s.is_default && (
                  <span className="flex shrink-0 items-center gap-1 text-micro font-semibold text-accent-600">
                    <Star aria-hidden className="h-3 w-3 fill-current" />Default
                  </span>
                )}
              </button>
              <IconButton label={`Remove ${s.label ?? s.stop_name}`} onClick={() => handleRemoveStop(s.id, s.label ?? s.stop_name)}>
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Favourite routes">
        {routes.length === 0 && <p className="text-meta text-fg-muted">No routes saved yet. Plan one in the Routes tab and save it.</p>}
        <ul className="space-y-0.5">
          {routes.map(r => (
            <li key={r.id} className="flex items-center gap-1">
              <button type="button" onClick={() => onSelectRoute?.(r.id)} className="row row-interactive min-w-0 flex-1 text-left" title="Open in Routes">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-fg">{r.label}</span>
                  <span className="block truncate text-meta text-fg-muted">{r.from_stop_name} → {r.to_stop_name}</span>
                </span>
              </button>
              <IconButton label={`Remove ${r.label}`} onClick={() => handleRemoveRoute(r.id, r.label)}>
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      </Section>

      {/* Applied to every route search, so these never need re-entering. */}
      <Section title="Travel profile">
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
      </Section>
    </div>
  )
}
