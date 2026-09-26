import { useState, useMemo } from 'react'
import { MapPin, RefreshCw, Star, AlertTriangle } from 'lucide-react'
import type { Departure, StopResult } from '../../api/ruterApi'
import { useTransitStops, DuplicateStopError } from '../../hooks/useTransitStops'
import { useDepartures, useNearbyStops } from '../../hooks/useTransitQueries'
import { useEntityModal } from '../../../../shared/modals'
import { IconButton, SectionLabel, Skeleton, cx } from '../../../../shared/ui'
import { StopSearchInput } from './StopSearchInput'
import { QuaySavePanel } from './QuaySavePanel'
import { minsUntil, fmtTime, fmtLastUpdated, lineStyle, modeFallbackStyle, buildLineGroups, situationTone, type LineGroup } from './transitUtils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeparturesTabProps {
  /** False while the surrounding widget/sheet is closed: no fetching then. */
  active: boolean
  now: number
}

// ─── DepartureRow ─────────────────────────────────────────────────────────────

export function DepartureRow({ group, now }: { group: LineGroup; now: number }) {
  const first    = group.departures[0]
  const mins     = minsUntil(first.expected, now)
  const isNow    = mins <= 0
  const delayed  = Math.abs(new Date(first.expected).getTime() - new Date(first.aimed).getTime()) > 60_000
  const style    = lineStyle(group.lineColour, group.lineTextColour)
  const nextTimes = group.departures.slice(1, 4).map(d => fmtTime(d.expected))

  return (
    <div className="w-full flex items-center gap-2.5 py-2.5 min-h-[44px]">
      <span
        className="text-meta font-bold px-2 py-1 rounded flex-shrink-0 min-w-[2.25rem] text-center leading-tight"
        style={style ?? modeFallbackStyle(group.transport)}
      >
        {group.line}
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-body font-medium text-fg truncate leading-snug">{group.destination}</div>
        {nextTimes.length > 0 && (
          <div className="text-micro text-fg-muted truncate leading-tight mt-0.5">
            Next: {nextTimes.join(', ')}
          </div>
        )}
        {/* Live disruption/alert for this line, e.g. "Cancelled today" —
            straight from EnTur's own situations feed, not just the
            aimed-vs-expected delay indicator on the right. */}
        {group.situations.length > 0 && (
          <div data-tone={situationTone(group.situations[0].severity)} className="tone-soft tone-text mt-1 flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-micro">
            <AlertTriangle aria-hidden className="h-3 w-3 shrink-0" />
            <span className="truncate">{group.situations[0].summary}</span>
          </div>
        )}
      </div>

      <div className="text-right flex-shrink-0 flex items-center gap-1.5">
        {delayed && (
          <span className="text-micro text-fg-faint line-through tabular-nums">{fmtTime(first.aimed)}</span>
        )}
        <span className={`text-body font-bold tabular-nums ${
          isNow ? 'text-danger' : mins <= 2 || delayed ? 'text-warn' : 'text-fg'
        }`}>
          {isNow ? 'Now' : `${mins} min`}
        </span>
        {group.realtime
          ? <span className="w-1.5 h-1.5 rounded-full bg-success inline-block flex-shrink-0" title="Realtime" />
          : <span className="text-micro text-fg-faint flex-shrink-0" title="Scheduled">~</span>
        }
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeparturesTab({ active, now }: DeparturesTabProps) {
  const { stops, addStop, updateStop } = useTransitStops()
  const modal = useEntityModal()

  const defaultStop = stops.find(s => s.is_default) ?? stops[0] ?? null
  const [activeId,      setActiveId]      = useState<string | null>(null)
  const [adHocStop,     setAdHocStop]     = useState<StopResult | null>(null)
  const [showSavePanel, setShowSavePanel] = useState(false)
  const [visibleCount,  setVisibleCount]  = useState(4)
  const [includeAddresses, setIncludeAddresses] = useState(false)

  const { data: nearby = [] } = useNearbyStops({ enabled: active })

  const activeSaved = activeId ? stops.find(s => s.id === activeId) ?? defaultStop : defaultStop
  const queryStop   = adHocStop ?? (activeSaved ? { id: activeSaved.stop_id, name: activeSaved.stop_name } : null)
  // An address favorite (or an address search result) has no NSR stop id, so
  // there's no departures board for it — only saving it for trip planning.
  const isAddressQuery = !!queryStop && !queryStop.id.startsWith('NSR:')

  // A saved favorite's quay_id (which direction/platform it was saved for) —
  // real bug this fixes: the board used to always show EVERY platform at the
  // stop regardless of which one was actually saved, so "kaydedildigi quay'dan
  // bagimsiz sorgu atiyor" (queries independent of the saved quay) was literally
  // true. null quay_id means the favorite was saved as "all directions" on
  // purpose, so that case still shows everything.
  const savedQuayId = (!adHocStop && activeSaved?.quay_id) ? activeSaved.quay_id : null
  const [showAllDirections, setShowAllDirections] = useState(false)

  // Reset the load-more window (and the all-directions override) whenever the
  // viewed stop OR the viewed saved direction changes — two favorites can point
  // at the same physical stop with different quays, so stop id alone isn't enough.
  const scopeKey = `${queryStop?.id ?? ''}|${savedQuayId ?? ''}`
  const [seenScopeKey, setSeenScopeKey] = useState(scopeKey)
  if (seenScopeKey !== scopeKey) {
    setSeenScopeKey(scopeKey)
    setVisibleCount(4)
    setShowAllDirections(false)
  }

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useDepartures(queryStop?.id, { enabled: active && !isAddressQuery })

  // Scope to the saved favorite's quay at the DEPARTURE level, before any
  // grouping. Real bug this fixes (verified live at Visperud): scoping used to
  // happen on the built groups, but the grouping key was quayCode/description —
  // at ordinary roadside stops BOTH are empty ("" / null), so every direction
  // merged into one group whose quayId was whichever departure happened to come
  // first. The group filter then either passed that whole merged list or
  // matched nothing and fell back to everything — either way the saved quay was
  // ignored, which is exactly what the user reported.
  const { scopedDepartures, scopeActive } = useMemo(() => {
    const all = data?.departures ?? []
    if (!savedQuayId || showAllDirections) return { scopedDepartures: all, scopeActive: false }
    const matched = all.filter(d => d.quayId === savedQuayId)
    // Stale saved quay id (e.g. EnTur re-ids a quay) → show everything rather
    // than an empty board that reads as "no departures".
    if (matched.length === 0) return { scopedDepartures: all, scopeActive: false }
    return { scopedDepartures: matched, scopeActive: true }
  }, [data, savedQuayId, showAllDirections])

  const quayGroups = useMemo(() => {
    const rawMap = new Map<string, { quayId?: string; code?: string; description?: string; deps: Departure[] }>()
    for (const dep of scopedDepartures) {
      // Group by the quay's real NSR id — it's the only identifier that is
      // ALWAYS present. publicCode/description are both commonly empty at
      // roadside stops (verified live: Visperud's quays have publicCode ""
      // and description null), which previously merged distinct directions
      // into a single bucket.
      const key = dep.quayId ?? dep.quayCode ?? dep.quayDescription ?? '__default__'
      if (!rawMap.has(key)) {
        rawMap.set(key, { quayId: dep.quayId, code: dep.quayCode, description: dep.quayDescription, deps: [] })
      }
      rawMap.get(key)!.deps.push(dep)
    }
    return Array.from(rawMap.values()).map(({ quayId, code, description, deps }) => {
      // Derive "Toward X, Y" from the departures actually seen at this quay —
      // no extra API call needed, and it can't go stale/wrong the way a
      // single first-seen guess could (a platform often serves >1 destination).
      const destinations = [...new Set(deps.map(d => d.destination))]
      return { quayId, code, description, destinations, lineGroups: buildLineGroups(deps) }
    })
  }, [scopedDepartures])

  function handleSearchSelect(stop: StopResult) {
    setAdHocStop(stop); setActiveId(null); setShowSavePanel(false)
  }

  function handleSavedStopClick(id: string) {
    setActiveId(id); setAdHocStop(null); setShowSavePanel(false)
  }

  async function handleSaveFromPanel(quayId: string | null, quayDescription: string | null, label: string) {
    if (!adHocStop) return
    try {
      await addStop(adHocStop, quayId ?? undefined, quayDescription ?? undefined, label !== adHocStop.name ? label : undefined)
      setShowSavePanel(false)
    } catch (e) {
      // Same stop + direction already saved: offer to update it instead.
      if (!(e instanceof DuplicateStopError)) return
      const proceed = await modal.confirm({
        title: 'Update the saved stop?',
        message: `You already have this saved as "${e.existing.label ?? e.existing.stop_name}". Update it with this direction and label instead?`,
        confirmLabel: 'Update stop',
      })
      if (!proceed) return
      try {
        await updateStop(e.existing.id, { label, quayId, quayDescription })
        setShowSavePanel(false)
      } catch { /* toasted by the hook */ }
    }
  }

  const alreadySaved = adHocStop ? stops.some(s => s.stop_id === adHocStop.id) : false

  return (
    <div>
      {/* ── Saved stops ── */}
      {stops.length > 0 && (
        <div className="mb-3">
          <SectionLabel className="mb-1.5">Saved stops</SectionLabel>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {stops.map(s => {
              const active = !adHocStop && activeSaved?.id === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => handleSavedStopClick(s.id)}
                  aria-pressed={active}
                  className={cx(
                    'min-h-[44px] shrink-0 rounded-control border px-3 py-1.5 text-left text-meta transition-colors duration-150',
                    active ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-line text-fg-2 hover:bg-surface-hover',
                  )}
                >
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    {s.label ?? s.stop_name}
                    {/* Clarifies "why is this one pre-selected" — the default
                        is the first stop you ever saved, or whichever you
                        picked in Settings; it's not a fixed/hardcoded stop. */}
                    {s.is_default && (
                      <Star aria-label="Default stop" className={cx('h-3 w-3 fill-current', active ? 'text-on-accent/80' : 'text-accent-600')} />
                    )}
                  </span>
                  {s.quay_description && (
                    <span className="block whitespace-nowrap text-micro opacity-70">{s.quay_description}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Nearby stops — real stops around the user's actual location, from
             EnTur's `nearest` query. Only shown when location was granted (not
             the Oslo fallback, which would misleadingly suggest Oslo stops to
             someone elsewhere). ── */}
      {nearby.length > 0 && (
        <div className="mb-3">
          <SectionLabel className="mb-1.5 flex items-center gap-1"><MapPin aria-hidden className="h-3 w-3" />Nearby</SectionLabel>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {nearby.map(n => (
              <button
                key={n.id}
                onClick={() => handleSearchSelect({ id: n.id, name: n.name, layer: 'venue' })}
                className="min-h-[44px] shrink-0 rounded-control border border-line px-3 py-1.5 text-left text-meta text-fg-2 transition-colors duration-150 hover:bg-surface-hover"
              >
                <span className="block whitespace-nowrap">{n.name}</span>
                <span className="block whitespace-nowrap text-micro opacity-70">{n.distance} m</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Search stop — always visible ── */}
      <div className="mb-3">
        <SectionLabel className="mb-1.5">Search stop</SectionLabel>
        <StopSearchInput placeholder="Search any stop…" onSelect={handleSearchSelect} stopsOnly={!includeAddresses} />
        <label className="mt-1 flex min-h-[44px] items-center gap-2 text-meta text-fg-muted">
          <input
            type="checkbox"
            checked={includeAddresses}
            onChange={e => setIncludeAddresses(e.target.checked)}
            className="rounded border-line-strong"
          />
          Include addresses (for trip planning — no live departures)
        </label>
      </div>

      {/* ── Active stop header + refresh ── */}
      {queryStop && (
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="flex min-w-0 items-center gap-1 truncate text-meta font-medium text-fg-2">
              <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
              <span className="truncate">{data?.stopName ?? queryStop.name}</span>
            </span>
            {adHocStop && !alreadySaved && !showSavePanel && (
              <button
                onClick={() => setShowSavePanel(true)}
                className="flex min-h-[44px] shrink-0 items-center px-1 text-meta font-semibold text-accent-600"
              >
                + Save
              </button>
            )}
          </div>
          {!isAddressQuery && (
            <div className="flex shrink-0 items-center gap-1">
              {dataUpdatedAt > 0 && (
                <span className="text-micro tabular-nums text-fg-muted">{fmtLastUpdated(dataUpdatedAt)}</span>
              )}
              <IconButton label="Refresh departures" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={cx(isFetching && 'animate-spin motion-reduce:animate-none')} />
              </IconButton>
            </div>
          )}
        </div>
      )}

      {/* ── Saved-direction scope note — states what the board is ACTUALLY
             showing (never claims the saved direction while a fallback is
             silently showing everything, which is how the original bug hid) ── */}
      {queryStop && !isAddressQuery && savedQuayId && data && (
        <div className="flex items-center gap-2 flex-wrap text-micro text-fg-muted mb-2">
          <span>
            {showAllDirections
              ? 'Showing: all directions'
              : scopeActive
                ? `Showing: ${activeSaved?.quay_description ?? 'saved direction'}`
                : 'Saved direction not found in current departures — showing all'}
          </span>
          {(scopeActive || showAllDirections) && (
            <button
              onClick={() => setShowAllDirections(v => !v)}
              className="min-h-[44px] font-semibold text-accent-600"
            >
              {showAllDirections ? 'Show saved direction only' : 'Show all directions'}
            </button>
          )}
        </div>
      )}

      {/* ── Quay save panel ── */}
      {showSavePanel && adHocStop && (
        <QuaySavePanel
          stopId={adHocStop.id}
          stopName={adHocStop.name}
          onSave={handleSaveFromPanel}
          onCancel={() => setShowSavePanel(false)}
        />
      )}

      {/* ── Empty / loading / error ── */}
      {!queryStop && (
        <div className="text-body text-fg-muted py-2">Search a stop or choose a saved stop.</div>
      )}
      {queryStop && isAddressQuery && (
        <div className="text-body text-fg-muted py-2">This is an address, not a transit stop — no departures board. Use "+ Save" above to keep it for trip planning.</div>
      )}
      {isLoading && (
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}
      {error && (
        <div className="flex flex-wrap items-center gap-2 py-1 text-meta text-danger">
          <span>{(error as Error).message?.includes('Rate') ? 'Rate limited — wait a moment and retry.' : (error as Error).message}</span>
          <button type="button" onClick={() => refetch()} className="min-h-[44px] font-semibold text-accent-600">Retry</button>
        </div>
      )}

      {/* ── Departures: each platform/direction gets its own bordered box, in a
             2-col grid on stops with multiple platforms — so which lines belong
             to which platform is never ambiguous. ── */}
      {data && quayGroups.length > 0 && (
        <div className={quayGroups.length >= 2 ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
          {quayGroups.map((group, i) => (
            <div key={i} className={quayGroups.length >= 2 ? 'rounded-control border border-line bg-surface-2 p-2' : ''}>
              {quayGroups.length >= 2 && (() => {
                // Roadside stops often have NO platform code (verified live:
                // Visperud) — a bare bold "Platform" on every box says nothing,
                // so in that case the direction itself becomes the headline.
                const towards = group.destinations.length > 0
                  ? `Toward ${group.destinations.slice(0, 2).join(', ')}${group.destinations.length > 2 ? '…' : ''}`
                  : 'Direction unknown'
                return (
                  <div className="mb-1 pb-1.5 border-b border-line">
                    <p className="truncate text-meta font-semibold text-fg-2">
                      {group.code ? `Platform ${group.code}` : towards}
                    </p>
                    <p className="text-micro text-fg-muted truncate leading-tight">
                      {group.code ? (group.description ?? towards) : (group.description ?? ' ')}
                    </p>
                  </div>
                )
              })()}
              <div className="divide-y divide-line">
                {group.lineGroups.slice(0, visibleCount).map((lg, j) => (
                  <DepartureRow key={j} group={lg} now={now} />
                ))}
              </div>
              {group.lineGroups.length > visibleCount && (
                <button
                  onClick={() => setVisibleCount(c => c + 4)}
                  className="mt-1 min-h-[44px] w-full border-t border-line pt-1 text-meta font-medium text-fg-muted transition-colors duration-150 hover:text-accent-600"
                >
                  Show {Math.min(4, group.lineGroups.length - visibleCount)} more
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {data && quayGroups.length === 0 && (
        <div className="text-fg-muted text-body py-2">No departures found</div>
      )}
    </div>
  )
}
