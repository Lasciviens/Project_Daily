import { useState } from 'react'

/** The slice of a TanStack query result `useFirstLoaded` needs to judge freshness. */
export interface FreshnessInfo {
  isFetching: boolean
  isStale: boolean
  isFetchedAfterMount: boolean
}

/**
 * True once `query` holds data this popup can trust: fetched since the popup
 * mounted, or still fresh (inside its staleTime, with nothing fetching). A
 * cached row that is stale or being refetched is NOT trusted — freezing it
 * would seed the form with an outdated row that Save then writes back
 * (THEME.md §9 rule 1).
 */
export function isFreshForMount(query: FreshnessInfo): boolean {
  if (query.isFetching) return false
  return query.isFetchedAfterMount || !query.isStale
}

/**
 * The first FRESH value, frozen for the popup's lifetime: a background
 * refetch (window focus, a save elsewhere) must never re-seed a form under
 * the user's fingers — but the value it freezes must be current when the
 * popup opens, not whatever the cache held from an earlier visit.
 */
export function useFirstLoaded<T>(value: T | null | undefined, query: FreshnessInfo): T | undefined {
  const [snap, setSnap] = useState<T | undefined>(undefined)
  if (snap === undefined && value != null && isFreshForMount(query)) {
    setSnap(value)
    return value
  }
  return snap
}
