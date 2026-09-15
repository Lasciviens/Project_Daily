import { useQuery } from '@tanstack/react-query'
import {
  fetchSteamProfile, fetchSteamOwnedGames, fetchSteamRecentGames, fetchSteamAchievements,
  fetchSteamLevelBadges, fetchSteamAppDetails, fetchSteamAppReviews, fetchSteamCurrentPlayers,
} from '../api/steamApi'

// Read-only proxy calls. Nothing about the USER is cached locally (Steam is
// the source of truth and nothing else in this app joins against it) — only
// store metadata, which the edge function caches in `steam_apps` because
// Steam rate-limits that endpoint hard. See CLAUDE.md's Games Feature Detail.

const STALE = 5 * 60_000
const STALE_LONG = 60 * 60_000

export function useSteamProfile() {
  return useQuery({ queryKey: ['steam', 'profile'], queryFn: fetchSteamProfile, staleTime: STALE, retry: false })
}

export function useSteamOwnedGames() {
  return useQuery({ queryKey: ['steam', 'owned-games'], queryFn: fetchSteamOwnedGames, staleTime: STALE, retry: false })
}

export function useSteamRecentGames() {
  return useQuery({ queryKey: ['steam', 'recent-games'], queryFn: fetchSteamRecentGames, staleTime: STALE, retry: false })
}

export function useSteamLevelBadges() {
  return useQuery({ queryKey: ['steam', 'level-badges'], queryFn: fetchSteamLevelBadges, staleTime: STALE, retry: false })
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
