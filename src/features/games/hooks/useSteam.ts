import { useQuery } from '@tanstack/react-query'
import { fetchSteamProfile, fetchSteamOwnedGames, fetchSteamRecentGames, fetchSteamAchievements, fetchSteamLevelBadges } from '../api/steamApi'

// Read-only proxy calls, no local cache table (Steam IS the source of truth
// and nothing else in this app joins against it — see CLAUDE.md's Games
// Feature Detail note on why this integration deliberately has zero new
// tables). staleTime keeps a "🔄 Refresh" button meaningful instead of every
// tab switch re-hitting the API.

const STALE = 5 * 60_000

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
    enabled: appid != null,
    staleTime: STALE,
    retry: false,
  })
}
