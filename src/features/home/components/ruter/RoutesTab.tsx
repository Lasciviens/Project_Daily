import { useState, useMemo, useEffect } from 'react'
import { ArrowUpDown, LocateFixed, MapPin, RefreshCw, Save, X } from 'lucide-react'
import { quayLabel, type StopResult, type TransitPlace } from '../../api/ruterApi'
import { useTransitRoutes, type UserTransitRoute } from '../../hooks/useTransitRoutes'
import { useTransitStops, type UserTransitStop } from '../../hooks/useTransitStops'
import { useTransitRecentSearches, type RecentSearch } from '../../hooks/useTransitRecentSearches'
import { useGeolocation } from '../../hooks/useGeolocation'
import { useStopDirections, useTrips } from '../../hooks/useTransitQueries'
import { Button, IconButton, SectionLabel, Skeleton, cx } from '../../../../shared/ui'
import { StopSearchInput } from './StopSearchInput'
import { TripCard } from './TripCard'
import { fmtLastUpdated, fmtMinsAgo, fmtTime } from './transitUtils'
import { toast } from '../../../../app/store'
import { DateInput } from '../../../../shared/components/DateInput'
import { todayStr as todayString } from '../../../../shared/utils/dateUtils'

interface RoutesTabProps {
  /** False while the surrounding widget/sheet is closed: no fetching then. */
  active: boolean
  now: number
  // Lets Settings' "Favorite Routes" list select a route here: RuterWidget
  // sets pendingRouteId + switches to this tab; this effect applies it once,
  // then reports back so RuterWidget clears it.
  pendingRouteId?:   string | null
  onRouteConsumed?:  () => void
}

// Inline "name this route" form — appears both under the draft planner and
// under a search result; was duplicated identically in both spots.
function SaveRouteForm({
  label, onLabelChange, onSave, onCancel, saving, placeholder, heading,
}: {
  label:         string
  onLabelChange: (v: string) => void
  onSave:        () => void
  onCancel:      () => void
  saving:        boolean
  placeholder:   string
  heading?:      string
}) {
  return (
    <div className="space-y-2">
      {heading && <p className="section-label">{heading}</p>}
      <div className="flex items-center gap-2">
        <input
          value={label} onChange={e => onLabelChange(e.target.value)}
          placeholder={placeholder} autoFocus
          onKeyDown={e => e.key === 'Enter' && onSave()}
          aria-label="Route name"
          className="input min-w-0 flex-1"
        />
        <Button variant="primary" onClick={onSave} disabled={!label.trim()} loading={saving}>Save route</Button>
        <IconButton label="Cancel" onClick={onCancel}><X /></IconButton>
      </div>
    </div>
  )
}

type LocationState = 'idle' | 'loading' | 'granted' | 'denied' | 'error'
type WhenPreset    = 'now' | '+15' | '+30' | '+1h' | 'arriveBy' | 'custom'
type TripMode      = 'departAt' | 'arriveBy'

interface SearchParams {
  from:           TransitPlace
  to:             TransitPlace
  dateTime?:      string
  arriveBy:       boolean
  label:          string
  preferredLine?: string
  version:        number
}

function getCurrentLocation(): Promise<TransitPlace> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ kind: 'coords', lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'Current location' }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  })
}


function nowTimeString(): string {
  const d = new Date()
  const mins = Math.ceil(d.getMinutes() / 15) * 15
  const rounded = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), mins)
  return `${String(rounded.getHours()).padStart(2, '0')}:${String(rounded.getMinutes()).padStart(2, '0')}`
}

function timeSlots(): string[] {
  const slots: string[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return slots
}
const TIME_SLOTS = timeSlots()

function offsetISO(now: number, offsetMins: number): string {
  return new Date(now + offsetMins * 60_000).toISOString()
}

function toTransitPlace(s: StopResult): TransitPlace | null {
  if (s.id.startsWith('NSR:')) return { kind: 'stop', id: s.id, name: s.name }
  if (s.lat !== undefined && s.lon !== undefined) return { kind: 'coords', lat: s.lat, lon: s.lon, name: s.name }
  return null
}

function planningLabel(preset: WhenPreset, mode: TripMode, dateTime: string | undefined): string {
  const modeLabel = (preset === 'arriveBy' || (preset === 'custom' && mode === 'arriveBy')) ? 'Arrive by' : 'Leave'
  if (preset === 'now') return 'Leave now'
  if (dateTime) {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return `${modeLabel} ${DAYS[new Date(dateTime).getDay()]} ${fmtTime(dateTime)}`
  }
  return `${modeLabel} now`
}

function suggestLabel(from: TransitPlace, to: TransitPlace): string {
  return `${from.name.split(',')[0].trim()} → ${to.name.split(',')[0].trim()}`
}

// Stop card with quay direction hints.
// Uses fetchStopDirections (lightweight: 20 departures, one per line+destination)
// to get "Toward Oslo S" / "Toward Snarøya" labels from real departure context.
function PlaceDisplay({ place, label, onClear }: { place: TransitPlace; label: string; onClear: () => void }) {
  const isFrom = label.toLowerCase() === 'from'

  const { data: hints = [] } = useStopDirections(place.kind === 'stop' ? place.id : null)

  const directions = useMemo(() => [...new Set(hints.map(quayLabel))], [hints])

  return (
    <div className="flex items-center gap-2 px-2.5 py-2 bg-surface-2 border border-line rounded-row min-h-[44px]">
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isFrom ? 'bg-danger' : 'bg-success'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-body font-medium text-fg truncate leading-snug">{place.name}</p>
        {directions.length > 0 && (
          <p className="text-micro text-fg-muted truncate leading-tight">{directions.join(' · ')}</p>
        )}
      </div>
      <IconButton label={`Clear ${label} stop`} onClick={onClear}><X /></IconButton>
    </div>
  )
}

function SavedRouteChip({ route, active, onSelect, onDelete }: {
  route: UserTransitRoute; active: boolean; onSelect: () => void; onDelete: () => void
}) {
  return (
    <div className="relative group inline-flex">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={cx(
          'flex min-h-[44px] flex-col rounded-row border py-2 pl-3 pr-8 text-left transition-colors duration-150',
          active ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-line bg-surface text-fg-2 hover:bg-surface-hover',
        )}
      >
        <span className="text-meta font-semibold leading-tight">{route.label}</span>
        <span className={`text-micro leading-tight mt-0.5 max-w-[130px] truncate ${active ? 'text-on-accent/70' : 'text-fg-muted'}`}>
          {route.from_stop_name.split(',')[0]} → {route.to_stop_name.split(',')[0]}
        </span>
      </button>
      {/* Always visible on touch; hover-revealed only where hover exists. */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onDelete() }}
        aria-label={`Remove ${route.label}`}
        className={cx(
          'absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full transition-opacity duration-150',
          '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100',
          active ? 'bg-on-accent/20 text-on-accent' : 'bg-surface-2 text-fg-muted hover:bg-danger-soft hover:text-danger',
        )}
      ><X aria-hidden className="h-3.5 w-3.5" /></button>
    </div>
  )
}

export function RoutesTab({ active, now, pendingRouteId, onRouteConsumed }: RoutesTabProps) {
  const { routes, addRoute, removeRoute } = useTransitRoutes()
  const { stops: savedStops } = useTransitStops()
  const { recent: recentSearches, recordSearch } = useTransitRecentSearches()
  const { data: geo, dataUpdatedAt: geoUpdatedAt, refetch: refetchGeo, isFetching: geoRefreshing } = useGeolocation()

  const [draftFrom,      setDraftFrom]      = useState<TransitPlace | null>(null)
  const [draftTo,        setDraftTo]        = useState<TransitPlace | null>(null)
  const [fromLocState,   setFromLocState]   = useState<LocationState>('idle')
  const [toLocState,     setToLocState]     = useState<LocationState>('idle')
  const [draftWhen,      setDraftWhen]      = useState<WhenPreset>('now')
  const [draftDate,      setDraftDate]      = useState(todayString)
  const [draftTime,      setDraftTime]      = useState(nowTimeString)
  const [draftMode,      setDraftMode]      = useState<TripMode>('departAt')
  const [draftLine,      setDraftLine]      = useState('')
  const [showLineFilter, setShowLineFilter] = useState(false)
  const [formCollapsed,  setFormCollapsed]  = useState(false)
  const [search,         setSearch]         = useState<SearchParams | null>(null)
  const [saveLabel,      setSaveLabel]      = useState('')
  const [showSaveForm,   setShowSaveForm]   = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [visibleCount,   setVisibleCount]   = useState(4)
  const [autoFilledFrom, setAutoFilledFrom] = useState(false)

  // Prefill "From" with the user's real location once it's available, so
  // planning a trip doesn't require tapping 📍 every time — but only once,
  // and only if From is still empty, so it never fights a manual choice or
  // re-fills itself right after the user clears it on purpose.
  if (!autoFilledFrom && !draftFrom && geo?.source === 'gps') {
    setDraftFrom({ kind: 'coords', lat: geo.lat, lon: geo.lon, name: 'Current location' })
    setAutoFilledFrom(true)
  }

  // A favorite Route selected from the Settings tab lands here once, applied
  // the same way tapping a "Saved routes" chip would.
  useEffect(() => {
    if (!pendingRouteId) return
    const route = routes.find(r => r.id === pendingRouteId)
    if (route) applyPreset(route)
    onRouteConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRouteId, routes])

  const favoriteStops = useMemo(() => {
    const seen = new Set<string>()
    const stops: { id: string; name: string }[] = []
    for (const r of routes) {
      if (!seen.has(r.from_stop_id)) { seen.add(r.from_stop_id); stops.push({ id: r.from_stop_id, name: r.from_stop_name }) }
      if (!seen.has(r.to_stop_id))   { seen.add(r.to_stop_id);   stops.push({ id: r.to_stop_id,   name: r.to_stop_name   }) }
    }
    return stops
  }, [routes])

  function applyPreset(r: UserTransitRoute) {
    const from: TransitPlace = { kind: 'stop', id: r.from_stop_id, name: r.from_stop_name }
    const to:   TransitPlace = { kind: 'stop', id: r.to_stop_id,   name: r.to_stop_name   }
    setDraftFrom(from); setDraftTo(to); setDraftWhen('now'); setShowSaveForm(false)
    setSearch({ from, to, dateTime: undefined, arriveBy: false, label: 'Leave now',
      preferredLine: draftLine.trim() || undefined, version: (search?.version ?? 0) + 1 })
    setFormCollapsed(true)
  }

  function swapStops() { setDraftFrom(draftTo); setDraftTo(draftFrom) }

  // Every async action must give feedback on completion (CLAUDE.md) — the
  // 'error' bucket (timeout / position unavailable) previously set state but
  // rendered NO message anywhere, so a GPS timeout failed completely silently
  // (only 'denied' had a visible message). A toast covers both branches.
  function reportLocationError(err: GeolocationPositionError): 'denied' | 'error' {
    if (err.code === 1) { toast.error('Location permission denied'); return 'denied' }
    toast.error(err.code === 3 ? 'Getting your location timed out' : 'Could not get your location')
    return 'error'
  }

  // Reuses the already-cached app-wide geolocation (shared with Weather, Home,
  // etc via useGeolocation's React Query cache) instead of hitting the browser
  // GPS API fresh on every click — a real bug this replaces: every "use current
  // location" action here called its own raw getCurrentLocation(), ignoring the
  // cache entirely and re-prompting/re-computing location every single time.
  async function resolveGpsPlace(): Promise<TransitPlace> {
    if (geo?.source === 'gps') return { kind: 'coords', lat: geo.lat, lon: geo.lon, name: 'Current location' }
    return getCurrentLocation()
  }

  async function planGpsToStop(stop: UserTransitStop) {
    setFromLocState('loading')
    try {
      const gpsPlace = await resolveGpsPlace()
      const isAddress = !stop.stop_id.startsWith('NSR:')
      // Real bug fix: an address favorite has no NSR stop id, so passing it as
      // `{kind:'stop'}` sent an invalid id to EnTur's trip planner (silently no
      // results) — addresses need their stored lat/lon as coordinates instead.
      const toPlace: TransitPlace = isAddress && stop.lat != null && stop.lon != null
        ? { kind: 'coords', lat: stop.lat, lon: stop.lon, name: stop.label ?? stop.stop_name }
        : { kind: 'stop', id: stop.stop_id, name: stop.label ?? stop.stop_name }
      setDraftFrom(gpsPlace); setDraftTo(toPlace); setFromLocState('granted')
      setSearch({
        from: gpsPlace, to: toPlace, dateTime: undefined, arriveBy: false,
        label: 'Leave now', preferredLine: undefined,
        version: (search?.version ?? 0) + 1,
      })
      setShowSaveForm(false); setFormCollapsed(true)
    } catch (e) {
      setFromLocState(reportLocationError(e as GeolocationPositionError))
    }
  }

  async function locateFor(side: 'from' | 'to') {
    const setState = side === 'from' ? setFromLocState : setToLocState
    const setPlace = side === 'from' ? setDraftFrom    : setDraftTo
    setState('loading')
    try {
      const place = await resolveGpsPlace()
      setPlace(place); setState('granted')
    } catch (e) {
      setState(reportLocationError(e as GeolocationPositionError))
    }
  }

  // Explicit "update current location" escape hatch — forces a fresh GPS read
  // (bypassing the cache) and, if From is currently set to the cached location,
  // refreshes it in place too.
  async function refreshCurrentLocation() {
    const { data: fresh } = await refetchGeo()
    if (fresh?.source === 'gps' && draftFrom?.kind === 'coords') {
      setDraftFrom({ kind: 'coords', lat: fresh.lat, lon: fresh.lon, name: 'Current location' })
    }
  }

  function handlePlan() {
    if (!draftFrom || !draftTo) return
    let dateTime: string | undefined
    if      (draftWhen === '+15')      dateTime = offsetISO(now, 15)
    else if (draftWhen === '+30')      dateTime = offsetISO(now, 30)
    else if (draftWhen === '+1h')      dateTime = offsetISO(now, 60)
    else if (draftWhen === 'arriveBy') dateTime = new Date(`${todayString()}T${draftTime}`).toISOString()
    else if (draftWhen === 'custom')   dateTime = new Date(`${draftDate}T${draftTime}`).toISOString()
    setSearch({
      from: draftFrom, to: draftTo, dateTime,
      arriveBy: draftWhen === 'arriveBy' || (draftWhen === 'custom' && draftMode === 'arriveBy'),
      label: planningLabel(draftWhen, draftMode, dateTime),
      preferredLine: draftLine.trim() || undefined,
      version: (search?.version ?? 0) + 1,
    })
    setShowSaveForm(false); setFormCollapsed(true)
    // Only stop→stop searches can be recorded (the recent-searches table has
    // no coordinate columns, so an address/GPS endpoint can't be represented).
    if (draftFrom.kind === 'stop' && draftTo.kind === 'stop') {
      recordSearch({ id: draftFrom.id, name: draftFrom.name }, { id: draftTo.id, name: draftTo.name })
    }
  }

  function planFromRecent(r: RecentSearch) {
    const from: TransitPlace = { kind: 'stop', id: r.from_stop_id, name: r.from_stop_name }
    const to:   TransitPlace = { kind: 'stop', id: r.to_stop_id,   name: r.to_stop_name   }
    setDraftFrom(from); setDraftTo(to); setDraftWhen('now'); setShowSaveForm(false)
    setSearch({ from, to, dateTime: undefined, arriveBy: false, label: 'Leave now',
      preferredLine: undefined, version: (search?.version ?? 0) + 1 })
    setFormCollapsed(true)
  }

  // Reset the load-more window whenever a fresh search runs.
  const [seenVersion, setSeenVersion] = useState(search?.version)
  if (seenVersion !== search?.version) {
    setSeenVersion(search?.version)
    setVisibleCount(4)
  }

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useTrips(search, { enabled: active })

  const { filteredData, lineFilterActive, lineMatchCount } = useMemo(() => {
    if (!data) return { filteredData: undefined, lineFilterActive: false, lineMatchCount: 0 }
    const pref = search?.preferredLine?.trim().toLowerCase()
    if (!pref) return { filteredData: data, lineFilterActive: false, lineMatchCount: 0 }
    const matched = data.filter(trip =>
      trip.legs.some(leg => leg.line?.toLowerCase() === pref || leg.line?.toLowerCase().includes(pref))
    )
    return { filteredData: matched.length > 0 ? matched : data, lineFilterActive: true, lineMatchCount: matched.length }
  }, [data, search?.preferredLine])

  const canSave = !!(search?.from.kind === 'stop' && search.to.kind === 'stop')
  const alreadySaved = canSave && routes.some(
    r => r.from_stop_id === (search!.from as { id: string }).id && r.to_stop_id === (search!.to as { id: string }).id
  )
  // Can save directly from draft (before planning) when both stops are NSR stops
  const draftCanSave = !formCollapsed && !!(draftFrom?.kind === 'stop' && draftTo?.kind === 'stop')
  const draftAlreadySaved = draftCanSave && routes.some(
    r => r.from_stop_id === (draftFrom as { id: string }).id && r.to_stop_id === (draftTo as { id: string }).id
  )

  async function handleSaveRoute() {
    if (!saveLabel.trim()) return
    // Use search state if available, fall back to draft state (before planning)
    const from = search?.from.kind === 'stop' ? search.from : draftFrom
    const to   = search?.to.kind   === 'stop' ? search.to   : draftTo
    if (!from || !to || from.kind !== 'stop' || to.kind !== 'stop') return
    setSaving(true)
    try {
      await addRoute(saveLabel.trim(), from as StopResult, to as StopResult)
      setSaveLabel(''); setShowSaveForm(false)
    } catch { /* toasted by the hook */ } finally { setSaving(false) }
  }

  const canPlan = !!(draftFrom && draftTo)

  return (
    <div className="space-y-4">

      {/* Saved routes */}
      {routes.length > 0 && (
        <div>
          <SectionLabel className="mb-2">Saved routes</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {routes.map(r => {
              const active = draftFrom?.kind === 'stop' && draftFrom.id === r.from_stop_id &&
                             draftTo?.kind   === 'stop' && draftTo.id   === r.to_stop_id
              return (
                <SavedRouteChip key={r.id} route={r} active={active}
                  onSelect={() => applyPreset(r)}
                  onDelete={() => removeRoute(r.id).catch(() => { /* toasted by the hook */ })} />
              )
            })}
          </div>
        </div>
      )}

      {/* Recent searches — repeat a stop→stop trip without re-typing it */}
      {recentSearches.length > 0 && (
        <div>
          <SectionLabel className="mb-2">Recent searches</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map(r => (
              <button
                key={r.id}
                onClick={() => planFromRecent(r)}
                className="flex items-center gap-1.5 text-meta px-3 py-2 rounded-row border border-line text-fg-2 hover:border-accent-500/40 transition-colors duration-150 min-h-[44px]"
              >
                <span className="truncate max-w-[100px]">{r.from_stop_name.split(',')[0]}</span>
                <span className="text-fg-faint">→</span>
                <span className="truncate max-w-[100px]">{r.to_stop_name.split(',')[0]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* GPS → saved stop quick chips */}
      {savedStops.length > 0 && (
        <div>
          <SectionLabel className="mb-2">Quick route from here</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {savedStops.map(s => (
              <button
                key={s.id}
                onClick={() => planGpsToStop(s)}
                className="flex items-center gap-1.5 text-meta px-3 py-2 rounded-row border border-line text-fg-2 hover:border-accent-500/40 transition-colors duration-150 min-h-[44px]"
              >
                <LocateFixed aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
                <span aria-hidden>→</span>
                <span className="flex flex-col items-start leading-tight">
                  <span>{s.label ?? s.stop_name.split(',')[0]}</span>
                  {/* Which platform/direction this favorite was saved for — was
                      only shown in Departures, not here, even though the same
                      ambiguity applies (a stop can have several saved directions). */}
                  {s.quay_description && (
                    <span className="text-micro opacity-70">{s.quay_description}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
          {/* Current-location freshness — reused from cache (see resolveGpsPlace)
              rather than re-computed on every click, so it's worth showing how
              old the cached fix is and offering an explicit refresh. */}
          {geo?.source === 'gps' && (
            <p className="text-micro text-fg-muted mt-1.5 flex items-center gap-1.5">
              <MapPin aria-hidden className="h-3 w-3" /> Using location from {fmtMinsAgo(geoUpdatedAt, now)}
              <button
                type="button"
                onClick={refreshCurrentLocation}
                disabled={geoRefreshing}
                className="min-h-[44px] font-semibold text-accent-600 disabled:opacity-50"
              >
                {geoRefreshing ? 'Updating…' : 'Update'}
              </button>
            </p>
          )}
          {fromLocState === 'denied' && (
            <p className="text-micro text-danger mt-1">Location permission denied</p>
          )}
          {fromLocState === 'loading' && !geo && (
            <p className="text-micro text-fg-muted mt-1">Getting location…</p>
          )}
        </div>
      )}

      {/* Planner form — collapses to a summary bar after planning */}
      {formCollapsed && search ? (
        <div className="flex items-center gap-2 px-3 py-3 bg-accent-50 border border-accent-500/30 rounded-row">
          {/* Route summary with colored origin/dest dots */}
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-danger flex-shrink-0" />
              <p className="text-meta font-medium text-fg-2 truncate">{search.from.name.split(',')[0]}</p>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
              <p className="text-meta font-medium text-fg-2 truncate">{search.to.name.split(',')[0]}</p>
            </div>
            <p className="text-micro text-accent-600 pl-3.5">{search.label}</p>
          </div>
          {/* Refresh button — solid accent, always visible */}
          <IconButton label="Refresh routes" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cx(isFetching && 'animate-spin motion-reduce:animate-none')} />
          </IconButton>
          <button
            onClick={() => setFormCollapsed(false)}
            className="text-meta font-medium text-accent-600 hover:text-accent-700 transition-colors duration-150 flex-shrink-0 min-h-[44px] px-2 flex items-center"
          >Edit</button>
        </div>
      ) : (
        <div className="space-y-3">

          {/* FROM + TO — grouped in a single card with a swap divider */}
          <div className="rounded-row border border-line bg-surface overflow-hidden divide-y divide-line">

            {/* FROM field */}
            <div className="px-3 pt-3 pb-3">
              {draftFrom ? (
                <PlaceDisplay place={draftFrom} label="From" onClear={() => { setDraftFrom(null); setFromLocState('idle') }} />
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0">
                      <StopSearchInput placeholder="From — stop or address…" favorites={favoriteStops}
                        onSelect={s => { const p = toTransitPlace(s); if (p) setDraftFrom(p) }} />
                    </div>
                    <button
                      onClick={() => locateFor('from')}
                      disabled={fromLocState === 'loading'}
                      title="Use current location"
                      aria-label="Use current location"
                      className="icon-btn shrink-0 disabled:opacity-50"
                    >
                      <LocateFixed aria-hidden className={cx('h-[18px] w-[18px]', fromLocState === 'loading' && 'animate-pulse')} />
                    </button>
                  </div>
                  {fromLocState === 'denied' && (
                    <span className="text-micro text-danger block">Location permission denied</span>
                  )}
                </div>
              )}
            </div>

            {/* Swap divider — only when both stops are set */}
            {draftFrom && draftTo && (
              <div className="flex items-center px-3 bg-surface-2">
                <div className="flex-1 border-t border-line" />
                <button onClick={swapStops}
                  className="text-meta text-fg-muted hover:text-accent-600 transition-colors duration-150 flex items-center gap-1 min-h-[44px] px-3">
                  <ArrowUpDown aria-hidden className="h-3.5 w-3.5" /> Swap
                </button>
                <div className="flex-1 border-t border-line" />
              </div>
            )}

            {/* TO field */}
            <div className="px-3 pt-3 pb-3">
              {draftTo ? (
                <PlaceDisplay place={draftTo} label="To" onClear={() => { setDraftTo(null); setToLocState('idle') }} />
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0">
                      <StopSearchInput placeholder="To — stop or address…" favorites={favoriteStops}
                        onSelect={s => { const p = toTransitPlace(s); if (p) setDraftTo(p) }} />
                    </div>
                    <button
                      onClick={() => locateFor('to')}
                      disabled={toLocState === 'loading'}
                      title="Use current location"
                      aria-label="Use current location"
                      className="icon-btn shrink-0 disabled:opacity-50"
                    >
                      <LocateFixed aria-hidden className={cx('h-[18px] w-[18px]', toLocState === 'loading' && 'animate-pulse')} />
                    </button>
                  </div>
                  {toLocState === 'denied' && (
                    <span className="text-micro text-danger block">Location permission denied</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* When chips + line filter trigger, same row */}
          <div>
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {(['now', '+15', '+30', '+1h', 'arriveBy', 'custom'] as WhenPreset[]).map(p => (
                <button key={p} onClick={() => setDraftWhen(p)}
                  className={`text-meta px-3 py-2 rounded-control border transition-colors duration-150 min-h-[44px] ${
                    draftWhen === p
                      ? 'bg-accent-500 text-on-accent border-accent-500'
                      : 'text-fg-2 border-line hover:border-accent-500/40'
                  }`}>
                  {p === 'now' ? 'Now' : p === 'arriveBy' ? 'Arrive by…' : p === 'custom' ? 'Custom…' : p}
                </button>
              ))}

              {!showLineFilter ? (
                <button onClick={() => setShowLineFilter(true)}
                  className="text-meta px-3 py-2 rounded-control border border-dashed border-line text-fg-muted hover:text-fg-2 hover:border-line-strong transition-colors duration-150 min-h-[44px]">
                  + Line №
                </button>
              ) : (
                <div className="flex items-center gap-1">
                  <input value={draftLine} onChange={e => setDraftLine(e.target.value)}
                    placeholder="e.g. 68" autoFocus
                    aria-label="Line number" className="input w-20" />
                  <IconButton label="Clear line filter" onClick={() => { setDraftLine(''); setShowLineFilter(false) }}><X /></IconButton>
                </div>
              )}
            </div>

            {draftWhen === 'arriveBy' && (
              <div className="space-y-1">
                <select value={draftTime} onChange={e => setDraftTime(e.target.value)}
                  className="select w-full">
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <p className="text-micro text-fg-muted">Arrive by this time today</p>
              </div>
            )}

            {draftWhen === 'custom' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {(['departAt', 'arriveBy'] as TripMode[]).map(m => (
                    <button key={m} onClick={() => setDraftMode(m)}
                      className={`flex-1 text-meta py-2 rounded-control border transition-colors duration-150 min-h-[44px] ${
                        draftMode === m ? 'bg-fg text-surface border-fg' : 'text-fg-muted border-line hover:border-line-strong'
                      }`}>
                      {m === 'departAt' ? 'Leave at' : 'Arrive by'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <DateInput value={draftDate} onChange={setDraftDate} min={todayString()}
                    className="input min-w-0 flex-1" />
                  <select value={draftTime} onChange={e => setDraftTime(e.target.value)} aria-label="Time"
                    className="select min-w-0 flex-1">
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Plan button — only shown once both stops are picked */}
          {canPlan && (
            <Button variant="primary" block onClick={handlePlan}>Plan route</Button>
          )}

          {/* Save as favorite — available as soon as both stops are NSR stops */}
          {draftCanSave && !draftAlreadySaved && !showSaveForm && (
            <button
              onClick={() => {
                setSaveLabel(suggestLabel(draftFrom!, draftTo!))
                setShowSaveForm(true)
              }}
              className="text-micro text-accent-600 hover:text-accent-700 transition-colors duration-150 min-h-[44px] flex items-center"
            >
              <Save aria-hidden className="mr-1 h-3.5 w-3.5" /> Save as favourite route
            </button>
          )}
          {draftCanSave && !draftAlreadySaved && showSaveForm && (
            <SaveRouteForm
              label={saveLabel} onLabelChange={setSaveLabel}
              onSave={handleSaveRoute} onCancel={() => { setShowSaveForm(false); setSaveLabel('') }}
              saving={saving} placeholder="e.g. Work to home" heading="Name this route"
            />
          )}
        </div>
      )}

      {/* Results */}
      {isLoading && <div className="space-y-2">{[0, 1].map(i => <Skeleton key={i} className="h-20 w-full" rounded="rounded-row" />)}</div>}

      {error && (
        <div className="flex flex-wrap items-center gap-2 py-1 text-meta text-danger">
          <span>{(error as Error).message?.includes('Rate') ? 'Rate limited — wait a moment and retry.' : (error as Error).message}</span>
          <button type="button" onClick={() => refetch()} className="min-h-[44px] font-semibold text-accent-600">Retry</button>
        </div>
      )}

      {filteredData && search && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro tabular-nums text-fg-muted">{dataUpdatedAt ? `Updated ${fmtLastUpdated(dataUpdatedAt)}` : ''}</span>
            {canSave && !alreadySaved && !showSaveForm && (
              <button onClick={() => { setSaveLabel(suggestLabel(search.from, search.to)); setShowSaveForm(true) }}
                className="text-micro text-accent-600 hover:text-accent-700 transition-colors duration-150 min-h-[44px] flex items-center">
                + Save this route
              </button>
            )}
          </div>

          {lineFilterActive && (
            <div className="text-micro px-3 py-2 rounded-control bg-accent-50 border border-accent-500/20 text-accent-700">
              {lineMatchCount > 0
                ? `Showing ${lineMatchCount} trip${lineMatchCount !== 1 ? 's' : ''} using line ${search.preferredLine}`
                : `No trips found with line ${search.preferredLine} — showing all`}
            </div>
          )}

          {canSave && !alreadySaved && showSaveForm && (
            <SaveRouteForm
              label={saveLabel} onLabelChange={setSaveLabel}
              onSave={handleSaveRoute} onCancel={() => { setShowSaveForm(false); setSaveLabel('') }}
              saving={saving} placeholder="Name this route…"
            />
          )}

          {filteredData.length === 0
            ? <p className="text-body text-fg-muted">No trips found</p>
            : filteredData.slice(0, visibleCount).map((trip, i) => <TripCard key={i} trip={trip} now={now} isBest={i === 0} />)
          }

          {filteredData.length > visibleCount && (
            <button
              onClick={() => setVisibleCount(c => c + 4)}
              className="min-h-[44px] w-full border-t border-line pt-2 text-meta font-medium text-fg-muted transition-colors duration-150 hover:text-accent-600"
            >
              Show {Math.min(4, filteredData.length - visibleCount)} more
            </button>
          )}
        </div>
      )}
    </div>
  )
}
