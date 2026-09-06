import { useState, useEffect, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
//  Persistent trip-planning preferences — set once in Settings, applied to
//  every route search automatically instead of being re-entered each time.
//  localStorage (not a DB table): single-user, per-browser is fine here — zero
//  migration, instant. (useDayTargets used to be the same precedent but moved
//  to a DB row in migration 086 once cross-device sync started mattering.)
//  Backed by real, verified `trip` query arguments (walkSpeed, maximumTransfers,
//  wheelchairAccessible) — confirmed live against EnTur's schema before use.
// ─────────────────────────────────────────────────────────────────────────────

export type WalkPace = 'slow' | 'normal' | 'fast'

// m/s — 'normal' matches EnTur's own default, so leaving it at 'normal' changes
// nothing versus not having a profile at all.
export const WALK_SPEED_MPS: Record<WalkPace, number> = { slow: 0.9, normal: 1.3, fast: 1.7 }

export interface TravelProfile {
  walkPace:             WalkPace
  maximumTransfers:     number | null   // null = no limit
  wheelchairAccessible: boolean
}

const STORAGE_KEY = 'lasci.travelProfile'
const DEFAULTS: TravelProfile = { walkPace: 'normal', maximumTransfers: null, wheelchairAccessible: false }

function read(): TravelProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<TravelProfile>
    return {
      walkPace:             parsed.walkPace ?? DEFAULTS.walkPace,
      maximumTransfers:     parsed.maximumTransfers ?? null,
      wheelchairAccessible: parsed.wheelchairAccessible ?? false,
    }
  } catch {
    return DEFAULTS
  }
}

export function useTravelProfile() {
  const [profile, setProfile] = useState<TravelProfile>(read)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)) } catch { /* quota */ }
  }, [profile])

  const update = useCallback((patch: Partial<TravelProfile>) => {
    setProfile(p => ({ ...p, ...patch }))
  }, [])

  return { profile, update }
}
