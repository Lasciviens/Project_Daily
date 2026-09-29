import { useState, type ReactNode } from 'react'
import { Briefcase, Home } from 'lucide-react'
import { Button, Card, CardHeader, PageBoard } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { useTransitStops, DuplicateStopError, type UserTransitStop } from '../../home/hooks/useTransitStops'
import type { StopResult } from '../../home/api/ruterApi'
import { StopSearchInput } from '../../home/components/ruter/StopSearchInput'
import { QuaySavePanel } from '../../home/components/ruter/QuaySavePanel'
import { TravelProfileFields } from '../../home/components/ruter/TravelProfileFields'
import { findPlace, PLACE_LABEL, type PlaceKind } from '../../home/transitPlaces'
import { PLACES_BOARD, type PlacesSection } from '../settingsBoards'

// Settings → Places: the saved Home and Work places Transit's "To home" /
// "To work" buttons (and ai-proxy's plan_trip) plan to. A place is a
// user_transit_stops row labelled "Home" / "Work" — no new table.

const ICON: Record<PlaceKind, typeof Home> = { home: Home, work: Briefcase }

function PlaceCard({ kind }: { kind: PlaceKind }) {
  const { stops, addStop, updateStop, removeStop } = useTransitStops()
  const modal = useEntityModal()
  const place = findPlace(stops, kind)
  const label = PLACE_LABEL[kind]
  const Icon = ICON[kind]
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<StopResult | null>(null)
  const [includeAddresses, setIncludeAddresses] = useState(true)

  const close = () => { setEditing(false); setPicked(null) }

  // The old place is dropped only after the new one saved, so a failed save
  // never leaves you without a Home.
  async function dropOld(old: UserTransitStop | null, keepId?: string) {
    if (old && old.id !== keepId) await removeStop(old.id)
  }

  async function handleSave(quayId: string | null, quayDescription: string | null, name: string) {
    if (!picked) return
    const old = place
    try {
      await addStop(picked, quayId ?? undefined, quayDescription ?? undefined, name)
      await dropOld(old)
      close()
    } catch (e) {
      if (!(e instanceof DuplicateStopError)) return
      // Already a favourite: label that row as this place instead.
      try {
        await updateStop(e.existing.id, { label: name, quayId, quayDescription })
        await dropOld(old, e.existing.id)
        close()
      } catch { /* toasted by the hook */ }
    }
  }

  async function handleRemove() {
    if (!place) return
    if (!(await modal.confirm({ title: `Remove your ${label.toLowerCase()} place?`, message: `${place.stop_name} is removed from your saved stops.`, confirmLabel: 'Remove', destructive: true }))) return
    removeStop(place.id).catch(() => { /* toasted by the hook */ })
  }

  return (
    <Card>
      <CardHeader icon={<Icon />} title={label} />
      {!editing && (
        <>
          {place ? (
            <div className="text-body text-fg">
              <p className="font-medium">{place.stop_name}</p>
              {(place.quay_description || place.stop_locality) && (
                <p className="text-meta text-fg-muted">{[place.quay_description, place.stop_locality].filter(Boolean).join(' · ')}</p>
              )}
            </div>
          ) : (
            <p className="text-meta text-fg-muted">Not set. Transit's “To {label.toLowerCase()}” button plans a trip here once it is.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant={place ? 'secondary' : 'primary'} onClick={() => setEditing(true)}>{place ? 'Change' : `Set ${label.toLowerCase()}`}</Button>
            {place && <Button size="sm" variant="ghost" onClick={() => { void handleRemove() }}>Remove</Button>}
          </div>
        </>
      )}
      {editing && !picked && (
        <div>
          <StopSearchInput placeholder={`Search your ${label.toLowerCase()} stop or address…`} onSelect={setPicked} stopsOnly={!includeAddresses} autoFocus />
          <label className="mt-1 flex min-h-[44px] items-center gap-2 text-meta text-fg-muted">
            <input type="checkbox" checked={includeAddresses} onChange={e => setIncludeAddresses(e.target.checked)} className="rounded border-line-strong" />
            Include addresses (trip planning only — no live departures)
          </label>
          <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
        </div>
      )}
      {editing && picked && (
        <QuaySavePanel stopId={picked.id} stopName={picked.name} initialLabel={label} onSave={handleSave} onCancel={close} />
      )}
    </Card>
  )
}

export function PlacesTab() {
  const sections: Record<PlacesSection, ReactNode> = {
    home: <PlaceCard kind="home" />,
    work: <PlaceCard kind="work" />,
    travel: (
      <Card>
        <CardHeader title="Travel profile" />
        <p className="mb-3 text-meta text-fg-muted">Applied to every route search.</p>
        <TravelProfileFields />
      </Card>
    ),
  }
  return <PageBoard sections={sections} layout={PLACES_BOARD} stackClassName="max-w-2xl" />
}
