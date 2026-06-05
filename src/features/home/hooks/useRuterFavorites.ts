import { useState } from 'react'
import type { StopResult } from '../api/ruterApi'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FavoriteRoute {
  id:    string   // uuid-ish: `${from.id}|${to.id}`
  label: string
  from:  StopResult
  to:    StopResult
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEY_STOPS  = 'ruter_fav_stops'
const KEY_ROUTES = 'ruter_fav_routes'
const KEY_ACTIVE = 'ruter_active_stop'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota */ }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages persistent favorite stops and routes for the RUTER widget.
 * All state is synced to localStorage on every mutation.
 */
export function useRuterFavorites(defaultStop: StopResult) {
  const [activeStop, setActiveStopState]  = useState<StopResult>(() =>
    load(KEY_ACTIVE, defaultStop)
  )
  const [favStops,  setFavStopsState]     = useState<StopResult[]>(() =>
    load(KEY_STOPS, [defaultStop])
  )
  const [favRoutes, setFavRoutesState]    = useState<FavoriteRoute[]>(() =>
    load(KEY_ROUTES, [])
  )

  function setActiveStop(stop: StopResult) {
    setActiveStopState(stop)
    save(KEY_ACTIVE, stop)
  }

  function addStop(stop: StopResult) {
    if (favStops.some(s => s.id === stop.id)) return
    const next = [...favStops, stop]
    setFavStopsState(next)
    save(KEY_STOPS, next)
  }

  function removeStop(id: string) {
    const next = favStops.filter(s => s.id !== id)
    setFavStopsState(next)
    save(KEY_STOPS, next)
    // If removed stop was active, fall back to first remaining stop
    if (activeStop.id === id && next.length > 0) setActiveStop(next[0])
  }

  function addRoute(from: StopResult, to: StopResult, label: string) {
    const id = `${from.id}|${to.id}`
    if (favRoutes.some(r => r.id === id)) return
    const next = [...favRoutes, { id, label, from, to }]
    setFavRoutesState(next)
    save(KEY_ROUTES, next)
  }

  function removeRoute(id: string) {
    const next = favRoutes.filter(r => r.id !== id)
    setFavRoutesState(next)
    save(KEY_ROUTES, next)
  }

  return {
    activeStop, setActiveStop,
    favStops,   addStop,   removeStop,
    favRoutes,  addRoute,  removeRoute,
  }
}
