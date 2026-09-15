import { useQuery } from '@tanstack/react-query'
import {
  fetchSteamProfile, fetchSteamOwnedGames, fetchSteamAchievements,
  fetchSteamLevelBadges, fetchSteamAppDetails, fetchSteamAppReviews, fetchSteamCurrentPlayers,
} from '../api/steamApi'

// Read-only proxy calls. Nothing about the USER is cached locally (Steam is
// the source of truth and nothing else in this app joins against it) — only
// store metadata, which the edge function caches in `steam_apps` because
// Steam rate-limits that endpoint hard. See CLAUDE.md's Games Feature Detail.
//
// LOADING PRIORITY (a deliberate order, not an accident): the tab's first
// paint needs exactly TWO requests — the profile header and the library
// itself. Everything else is either derived from the library payload with no
// request at all (the "last 2 weeks" strip reads `playtime_2weeks`, which
// GetOwnedGames already returns), queued behind it (level/badges), or keyed
// to a game the user actually opened (store metadata, reviews, achievements).

const STALE = 5 * 60_000
const STALE_LONG = 60 * 60_000

export function useSteamProfile() {
  return useQuery({ queryKey: ['steam', 'profile'], queryFn: fetchSteamProfile, staleTime: STALE, retry: false })
}

export function useSteamOwnedGames() {
  return useQuery({ queryKey: ['steam', 'owned-games'], queryFn: fetchSteamOwnedGames, staleTime: STALE, retry: false })
}

/**
 * Level + badges costs two Steam round trips for one line of header text, so
 * it is queued BEHIND the library rather than racing it — pass `enabled`
 * once the main content has landed.
 */
export function useSteamLevelBadges(enabled = true) {
  return useQuery({
    queryKey: ['steam', 'level-badges'], queryFn: fetchSteamLevelBadges,
    enabled, staleTime: STALE_LONG, retry: false,
  })
}

export function useSteamAchievements(appid: number | null) {
  return useQuery({
    queryKey: ['steam', 'achievements', appid],
    queryFn: () => fetchSteamAchievements(appid!),
    enabled: appid != null, staleTime: STALE, retry: false,
  })
}

/** Store metadata for one app — what the detail modal opens with. */
export function useSteamAppDetails(appid: number | null) {
  return useQuery({
    queryKey: ['steam', 'app-details', appid],
    queryFn: async () => (await fetchSteamAppDetails([appid!])).apps[0] ?? null,
    enabled: appid != null, staleTime: STALE_LONG, retry: false,
  })
}

export function useSteamAppReviews(appid: number | null) {
  return useQuery({
    queryKey: ['steam', 'app-reviews', appid],
    queryFn: () => fetchSteamAppReviews(appid!),
    enabled: appid != null, staleTime: STALE_LONG, retry: false,
  })
}

/**
 * Live player count — `enabled` is driven by an explicit tap in the modal,
 * never by mounting it (the user's own instruction: "isteğe bağlı olarak
 * sorgulanabilir olsun").
 */
export function useSteamCurrentPlayers(appid: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['steam', 'current-players', appid],
    queryFn: () => fetchSteamCurrentPlayers(appid!),
    enabled: enabled && appid != null, staleTime: 60_000, retry: false,
  })
}
