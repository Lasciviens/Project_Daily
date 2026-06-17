import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTrips, type StopResult, type TransitPlace } from '../../api/ruterApi'
import { useTransitRoutes, type UserTransitRoute } from '../../hooks/useTransitRoutes'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { TripCard } from './TripCard'
import { fmtLastUpdated, fmtTime } from './transitUtils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutesTabProps {
  ws:  WidgetStateResult
  now: number
}

type LocationState = 'idle' | 'loading' | 'granted' | 'denied' | 'error'
type WhenPreset    = 'now' | '+15' | '+30' | '+1h' | 'arriveBy' | 'custom'
type TripMode      = 'departAt' | 'arriveBy'

interface SearchParams {
  from:          TransitPlace
  to:            TransitPlace
  dateTime?:     string
  arriveBy:      boolean
  label:         string
  preferredLine?: string  // filter results to trips using this line
  version:       number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

// Converts a geocoder result to a TransitPlace; returns null if coords are missing for address results
function toTransitPlace(s: StopResult): TransitPlace | null {
  if (s.id.startsWith('NSR:')) return { kind: 'stop', id: s.id, name: s.name }
  if (s.lat !== undefined && s.lon !== undefined) return { kind: 'coords', lat: s.lat, lon: s.lon, name: s.name }
  return null
}

function planningLabel(preset: WhenPreset, mode: TripMode, dateTime: string | undefined): string {
  const modeLabel = (preset === 'arriveBy' || mode === 'arriveBy') ? 'Arrive by' : 'Leave'
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

// ─── Sub-components ───────────────────────────────────────────────────────────

// Inline row inside the from/to planner card — shows place name + clear button when selected,
// or a search input + GPS button when empty
function PlaceRow({
  dot,
  place,
  locState,
  placeholder,
  favorites,
  onSelect,
  onClear,
  onLocate,
}: {
  dot:         'from' | 'to'
  place:       TransitPlace | null
  locState:    LocationState
  placeholder: string
  favorites:   { id: string; name: string }[]
  onSelect:    (s: StopResult) => void
  onClear:     () => void
  onLocate:    () => void
}) {
  const dotColor = dot === 'from' ? 'bg-blue-500' : 'bg-red-400'

  return (
    <div className="flex items-center gap-2.5 px-3 min-h-[44px]">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
      {place ? (
        <>
          <span className="flex-1 text-sm text-ink-700 truncate">
            {place.name}
          </span>
          <button
            onClick={onClear}
            className="text-ink-300 hover:text-ink-600 transition-colors duration-150 text-xs min-w-[32px] min-h-[44px] flex items-center justify-center flex-shrink-0"
          >
            ✕
          </button>
        </>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <StopSearchInput
              placeholder={placeholder}
              favorites={favorites}
              onSelect={onSelect}
            />
          </div>
          {locState === 'loading' ? (
            <span className="text-[10px] text-ink-400 flex-shrink-0">…</span>
          ) : locState === 'denied' ? (
            <span className="text-[10px] text-red-400 flex-shrink-0">denied</span>
          ) : (
            <button
              onClick={onLocate}
              title="Use current location"
              className="text-ink-400 hover:text-accent-600 transition-colors duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 text-base"
            >
              📍
            </button>
          )}
        </>
      )}
    </div>
  )
}

function SavedRouteChip({
  route,
  active,
  onSelect,
  onDelete,
}: {
  route:    UserTransitRoute
  active:   boolean
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <div className="relative group inline-flex">
      <button
        onClick={onSelect}
        className={`flex flex-col text-left px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] pr-7 ${
          active
            ? 'bg-accent-500 text-white border-accent-500'
            : 'bg-white text-ink-700 border-ink-200 hover:border-accent-300'
        }`}
      >
        <span className="text-xs font-medium leading-tight">{route.label}</span>
        <span className={`text-[10px] leading-tight mt-0.5 truncate max-w-[120px] ${active ? 'text-white/70' : 'text-ink-400'}`}>
          {route.from_stop_name.split(',')[0]} → {route.to_stop_name.split(',')[0]}
        </span>
      </button>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        title="Remove"
        className={`absolute top-0.5 right-0.5 w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center transition-opacity duration-150 opacity-0 group-hover:opacity-100 ${
          active ? 'bg-white/30 text-white' : 'bg-ink-100 text-ink-500 hover:bg-red-100 hover:text-red-600'
        }`}
      >
        ✕
      </button>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RoutesTab({ ws, now }: RoutesTabProps) {
  // Mobile audit: 2026-06-15 — WhenPreset buttons raised from min-h-[36px]/py-1.5 to min-h-[44px]/py-2.5; flex-wrap verified OK for 6 buttons at 375px; "Arrive by…" wraps cleanly as full-width row if needed
  const { routes, addRoute, removeRoute } = useTransitRoutes()

  // ── Draft state ──
  const [draftFrom,     setDraftFrom]     = useState<TransitPlace | null>(null)
  const [draftTo,       setDraftTo]       = useState<TransitPlace | null>(null)
  const [fromLocState,  setFromLocState]  = useState<LocationState>('idle')
  const [toLocState,    setToLocState]    = useState<LocationState>('idle')
  const [draftWhen,     setDraftWhen]     = useState<WhenPreset>('now')
  const [draftDate,     setDraftDate]     = useState(todayString)
  const [draftTime,     setDraftTime]     = useState(nowTimeString)
  const [draftMode,     setDraftMode]     = useState<TripMode>('departAt')
  const [draftLine,     setDraftLine]     = useState('')

  // ── Submitted / results state ──
  const [search,      setSearch]      = useState<SearchParams | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  // ── Save form state ──
  const [saveLabel,     setSaveLabel]     = useState('')
  const [showSaveForm,  setShowSaveForm]  = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [saveMsg,       setSaveMsg]       = useState<string | null>(null)

  // Unique stops extracted from saved routes — shown in search dropdown as quick picks
  const favoriteStops = useMemo(() => {
    const seen = new Set<string>()
    const stops: { id: string; name: string }[] = []
    for (const r of routes) {
      if (!seen.has(r.from_stop_id)) {
        seen.add(r.from_stop_id)
        stops.push({ id: r.from_stop_id, name: r.from_stop_name })
      }
      if (!seen.has(r.to_stop_id)) {
        seen.add(r.to_stop_id)
        stops.push({ id: r.to_stop_id, name: r.to_stop_name })
      }
    }
    return stops
  }, [routes])

  // ─── Saved route presets ──────────────────────────────────────────────────

  // Clicking a saved route fills the form AND immediately triggers the search
  function applyPreset(r: UserTransitRoute) {
    const from: TransitPlace = { kind: 'stop', id: r.from_stop_id, name: r.from_stop_name }
    const to:   TransitPlace = { kind: 'stop', id: r.to_stop_id,   name: r.to_stop_name   }
    setDraftFrom(from)
    setDraftTo(to)
    setDraftWhen('now')
    setSaveMsg(null)
    setShowSaveForm(false)
    setSearch({
      from,
      to,
      dateTime:      undefined,
      arriveBy:      false,
      label:         'Leave now',
      preferredLine: draftLine.trim() || undefined,
      version:       (search?.version ?? 0) + 1,
    })
  }

  function swapStops() {
    setDraftFrom(draftTo)
    setDraftTo(draftFrom)
  }

  async function locateFor(side: 'from' | 'to') {
    const setState = side === 'from' ? setFromLocState : setToLocState
    const setPlace = side === 'from' ? setDraftFrom    : setDraftTo
    setState('loading')
    try {
      const place = await getCurrentLocation()
      setPlace(place)
      setState('granted')
    } catch (e) {
      const err = e as GeolocationPositionError
      setState(err.code === 1 ? 'denied' : 'error')
    }
  }

  // ─── Plan route ───────────────────────────────────────────────────────────

  function handlePlan() {
    if (!draftFrom || !draftTo) return

    let dateTime: string | undefined
    if      (draftWhen === '+15')    dateTime = offsetISO(now, 15)
    else if (draftWhen === '+30')    dateTime = offsetISO(now, 30)
    else if (draftWhen === '+1h')    dateTime = offsetISO(now, 60)
    else if (draftWhen === 'arriveBy') dateTime = new Date(`${todayString()}T${draftTime}`).toISOString()
    else if (draftWhen === 'custom')   dateTime = new Date(`${draftDate}T${draftTime}`).toISOString()

    setSearch({
      from:          draftFrom,
      to:            draftTo,
      dateTime,
      arriveBy:      draftWhen === 'arriveBy' || draftMode === 'arriveBy',
      label:         planningLabel(draftWhen, draftMode, dateTime),
      preferredLine: draftLine.trim() || undefined,
      version:       (search?.version ?? 0) + 1,
    })
    setShowSaveForm(false)
    setSaveMsg(null)
  }

  // ─── TanStack Query ───────────────────────────────────────────────────────

  const fromKey = search?.from.kind === 'stop'
    ? search.from.id
    : search ? `${(search.from as { lat: number }).lat},${(search.from as { lon: number }).lon}` : ''
  const toKey = search?.to.kind === 'stop'
    ? search.to.id
    : search ? `${(search.to as { lat: number }).lat},${(search.to as { lon: number }).lon}` : ''

  const { data, isLoading, error } = useQuery({
    queryKey: ['trip', fromKey, toKey, search?.arriveBy, search?.dateTime ?? 'now', search?.version],
    queryFn:  async () => {
      const result = await fetchTrips(search!.from, search!.to, undefined, search!.dateTime, search!.arriveBy)
      setLastUpdated(Date.now())
      return result
    },
    staleTime:       Infinity,
    refetchInterval: false,
    enabled:         !ws.collapsed && !!search,
  })

  // Client-side line filter — keeps all trips if preferred line matches none
  const { filteredData, lineFilterActive, lineMatchCount } = useMemo(() => {
    if (!data) return { filteredData: undefined, lineFilterActive: false, lineMatchCount: 0 }
    const pref = search?.preferredLine?.trim().toLowerCase()
    if (!pref) return { filteredData: data, lineFilterActive: false, lineMatchCount: 0 }

    const matched = data.filter(trip =>
      trip.legs.some(leg => leg.line?.toLowerCase() === pref || leg.line?.toLowerCase().includes(pref))
    )
    return {
      filteredData:    matched.length > 0 ? matched : data,
      lineFilterActive: true,
      lineMatchCount:   matched.length,
    }
  }, [data, search?.preferredLine])

  // ─── Save route ───────────────────────────────────────────────────────────

  const canSave = !!(search?.from.kind === 'stop' && search.to.kind === 'stop')
  const alreadySaved = canSave && routes.some(
    r => r.from_stop_id === (search!.from as { id: string }).id &&
         r.to_stop_id   === (search!.to   as { id: string }).id
  )

  async function handleSaveRoute() {
    if (!saveLabel.trim() || !canSave) return
    setSaving(true)
    try {
      await addRoute(saveLabel.trim(), search!.from as StopResult, search!.to as StopResult)
      setSaveMsg('Saved ✓')
      setSaveLabel('')
      setShowSaveForm(false)
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e) {
      setSaveMsg(`Failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  function openSaveForm() {
    setSaveLabel(suggestLabel(search!.from, search!.to))
    setShowSaveForm(true)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const canPlan    = !!(draftFrom && draftTo)
  const hasResults = !!(filteredData && search)
  const [formExpanded, setFormExpanded] = useState(true)
  // Show the full form when: no results yet, OR user clicked Edit
  const showForm = !hasResults || formExpanded

  return (
    <div>
      {/* ── Saved routes ── */}
      {routes.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-2">Saved routes</p>
          <div className="flex items-start gap-1.5 flex-wrap">
            {routes.map(r => {
              const active =
                draftFrom?.kind === 'stop' && draftFrom.id === r.from_stop_id &&
                draftTo?.kind   === 'stop' && draftTo.id   === r.to_stop_id
              return (
                <SavedRouteChip
                  key={r.id}
                  route={r}
                  active={active}
                  onSelect={() => { applyPreset(r); setFormExpanded(false) }}
                  onDelete={() => removeRoute(r.id)}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* ── Collapsed summary bar — shown when results exist and form is hidden ── */}
      {hasResults && !formExpanded && search && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-ink-50 rounded-xl border border-ink-100">
          <span className="flex-1 text-xs text-ink-700 truncate">
            <span className="font-medium">{search.from.name.split(',')[0]}</span>
            <span className="text-ink-400"> → </span>
            <span className="font-medium">{search.to.name.split(',')[0]}</span>
            <span className="text-ink-400"> · {search.label}</span>
          </span>
          <button
            onClick={() => setFormExpanded(true)}
            className="text-xs text-accent-600 hover:text-accent-800 transition-colors duration-150 font-medium flex-shrink-0 min-h-[44px] px-1 flex items-center"
          >
            ✏ Edit
          </button>
        </div>
      )}

      {/* ── Plan route form ── */}
      {showForm && (
        <div className="mb-3">

          {/* From/To compact card */}
          <div className="border border-ink-200 rounded-xl overflow-hidden mb-2 bg-white">
            <PlaceRow
              dot="from"
              place={draftFrom}
              locState={fromLocState}
              placeholder="From — stop or address…"
              favorites={favoriteStops}
              onSelect={s => { const p = toTransitPlace(s); if (p) setDraftFrom(p) }}
              onClear={() => { setDraftFrom(null); setFromLocState('idle') }}
              onLocate={() => locateFor('from')}
            />
            {/* Divider with swap */}
            <div className="flex items-center border-t border-dashed border-ink-100">
              <div className="flex-1 h-px" />
              <button
                onClick={swapStops}
                disabled={!draftFrom && !draftTo}
                title="Swap from / to"
                className="text-ink-400 hover:text-accent-600 transition-colors duration-150 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-30 text-base"
              >
                ⇅
              </button>
            </div>
            <PlaceRow
              dot="to"
              place={draftTo}
              locState={toLocState}
              placeholder="To — stop or address…"
              favorites={favoriteStops}
              onSelect={s => { const p = toTransitPlace(s); if (p) setDraftTo(p) }}
              onClear={() => { setDraftTo(null); setToLocState('idle') }}
              onLocate={() => locateFor('to')}
            />
          </div>

          {/* WHEN chips */}
          <div className="mb-2">
            <div className="flex items-center gap-1 flex-wrap mb-1.5">
              {(['now', '+15', '+30', '+1h', 'arriveBy', 'custom'] as WhenPreset[]).map(p => (
                <button
                  key={p}
                  onClick={() => setDraftWhen(p)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors duration-150 min-h-[44px] ${
                    draftWhen === p
                      ? 'bg-accent-500 text-white border-accent-500'
                      : 'text-ink-600 border-ink-200 hover:border-accent-300'
                  }`}
                >
                  {p === 'now' ? 'Now' : p === 'arriveBy' ? 'Arrive by' : p === 'custom' ? 'Custom' : p}
                </button>
              ))}
            </div>

            {/* Arrive by: today only, pick a time */}
            {draftWhen === 'arriveBy' && (
              <div className="mb-1.5">
                <select
                  value={draftTime}
                  onChange={e => setDraftTime(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-accent-300 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-accent-50 min-h-[44px]"
                >
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <p className="text-[10px] text-ink-400 mt-1">Arrive by this time today</p>
              </div>
            )}

            {draftWhen === 'custom' && (
              <div className="space-y-1.5 mb-1.5">
                <div className="flex gap-1.5">
                  {(['departAt', 'arriveBy'] as TripMode[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setDraftMode(m)}
                      className={`text-xs px-2.5 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
                        draftMode === m
                          ? 'bg-ink-700 text-white border-ink-700'
                          : 'text-ink-500 border-ink-200 hover:border-ink-400'
                      }`}
                    >
                      {m === 'departAt' ? 'Leave at' : 'Arrive by'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={draftDate}
                    min={todayString()}
                    onChange={e => setDraftDate(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
                  />
                  <select
                    value={draftTime}
                    onChange={e => setDraftTime(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
                  >
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Plan route button */}
          <button
            onClick={() => { handlePlan(); setFormExpanded(false) }}
            disabled={!canPlan}
            className="w-full py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors duration-150 disabled:opacity-40 min-h-[44px]"
          >
            Plan route
          </button>

          {/* Line filter — collapsible, hidden by default */}
          <LineFilterSection
            draftLine={draftLine}
            setDraftLine={setDraftLine}
            search={search}
            lineFilterActive={lineFilterActive}
            lineMatchCount={lineMatchCount}
          />
        </div>
      )}

      {/* ── Results ── */}
      {isLoading && <div className="text-ink-400 text-sm py-1">Loading trips…</div>}

      {error && (
        <div className="text-red-500 text-xs py-1">
          {(error as Error).message?.includes('Rate')
            ? '⏳ Rate limited — wait a moment'
            : `⚠ ${(error as Error).message}`
          }
        </div>
      )}

      {hasResults && search && (
        <>
          {/* Timestamp + save action */}
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className="text-[10px] text-ink-400">
              {lastUpdated ? `Updated ${fmtLastUpdated(lastUpdated)}` : ''}
              {!canSave && ' · GPS routes cannot be saved'}
            </span>
            {canSave && !alreadySaved && !showSaveForm && (
              <button onClick={openSaveForm} className="text-[10px] text-accent-500 hover:text-accent-700 transition-colors duration-150 flex-shrink-0">
                + Save route
              </button>
            )}
          </div>

          {/* Line filter active notice */}
          {lineFilterActive && search.preferredLine && (
            <div className="mb-2 text-[10px] px-2.5 py-1.5 rounded-lg bg-accent-50 border border-accent-100 text-accent-700">
              {lineMatchCount > 0
                ? `Showing ${lineMatchCount} trip${lineMatchCount !== 1 ? 's' : ''} using line ${search.preferredLine}`
                : `No trips found with line ${search.preferredLine} — showing all`
              }
            </div>
          )}

          {/* Save form */}
          {canSave && !alreadySaved && showSaveForm && (
            <div className="flex items-center gap-2 mb-2">
              <input
                value={saveLabel}
                onChange={e => setSaveLabel(e.target.value)}
                placeholder="Route label…"
                className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
                onKeyDown={e => e.key === 'Enter' && handleSaveRoute()}
                autoFocus
              />
              <button
                onClick={handleSaveRoute}
                disabled={!saveLabel.trim() || saving}
                className="text-xs px-3 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors duration-150 disabled:opacity-40 min-h-[44px]"
              >
                {saving ? '…' : 'Save'}
              </button>
              <button
                onClick={() => { setShowSaveForm(false); setSaveLabel('') }}
                className="text-ink-400 hover:text-ink-600 text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
              >✕</button>
            </div>
          )}
          {saveMsg && (
            <p className={`text-xs mb-2 ${saveMsg.startsWith('Failed') ? 'text-red-500' : 'text-green-600'}`}>
              {saveMsg}
            </p>
          )}

          {/* Trip cards */}
          <div className="space-y-2">
            {filteredData!.length === 0
              ? <div className="text-ink-400 text-sm">No trips found</div>
              : filteredData!.map((trip, i) => (
                  <TripCard key={i} trip={trip} now={now} isBest={i === 0} />
                ))
            }
          </div>
        </>
      )}
    </div>
  )
}

// ─── Line filter collapsible ──────────────────────────────────────────────────

// Separate component so the main render block stays readable
function LineFilterSection({
  draftLine,
  setDraftLine,
  search,
  lineFilterActive,
  lineMatchCount,
}: {
  draftLine:        string
  setDraftLine:     (v: string) => void
  search:           SearchParams | null
  lineFilterActive: boolean
  lineMatchCount:   number
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="text-[10px] text-ink-400 hover:text-ink-600 transition-colors duration-150 flex items-center gap-1 min-h-[32px]"
      >
        <span>{open ? '▲' : '+'}</span>
        <span>Filter by line</span>
        {draftLine && <span className="text-accent-500 font-medium">{draftLine}</span>}
      </button>
      {open && (
        <div className="mt-1.5">
          <div className="flex items-center gap-2">
            <input
              value={draftLine}
              onChange={e => setDraftLine(e.target.value)}
              placeholder="e.g. 68, 31E"
              className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px] placeholder:text-ink-300"
            />
            {draftLine && (
              <button
                onClick={() => setDraftLine('')}
                className="text-ink-300 hover:text-ink-600 text-xs min-w-[44px] min-h-[44px] flex items-center justify-center"
              >✕</button>
            )}
          </div>
          {lineFilterActive && search?.preferredLine && (
            <p className="text-[10px] text-ink-400 mt-1">
              {lineMatchCount > 0
                ? `${lineMatchCount} trip${lineMatchCount !== 1 ? 's' : ''} using line ${search.preferredLine}`
                : `No trips with line ${search.preferredLine} — showing all`
              }
            </p>
          )}
        </div>
      )}
    </div>
  )
}
