import { supabase } from '../../../integrations/supabase/client'

// ─────────────────────────────────────────────────────────────────────────────
//  Steam — proxied through the `steam-api` edge function (personal API key +
//  SteamID64 stay in Vault, never in the client). See CLAUDE.md's Games
//  Feature Detail research note for the full scoping rationale.
//
//  Everything about the USER (owned games, playtime, achievements) is a live
//  passthrough with no local table. Store METADATA is the one exception —
//  cached server-side in `steam_apps` (migration 092) because `appdetails` is
//  rate-limited and ~36 KB per app.
// ─────────────────────────────────────────────────────────────────────────────

export interface SteamPlayer {
  steamid: string
  personaname: string
  avatarfull: string
  personastate: number
  gameid?: string
  gameextrainfo?: string
  communityvisibilitystate: number
  timecreated?: number
  loccountrycode?: string
  profileurl?: string
  realname?: string
  lastlogoff?: number
}

export interface SteamGame {
  appid: number
  name: string
  playtime_forever: number
  playtime_2weeks?: number
  img_icon_url?: string
  rtime_last_played?: number
  // Per-platform split — present on every GetOwnedGames row, never surfaced
  // before this pass.
  playtime_windows_forever?: number
  playtime_mac_forever?: number
  playtime_linux_forever?: number
  playtime_deck_forever?: number
  playtime_disconnected?: number
  // include_extended_appinfo fields.
  sort_as?: string
  has_dlc?: boolean
  has_workshop?: boolean
  has_market?: boolean
  has_leaderboards?: boolean
  content_descriptorids?: number[]
  has_community_visible_stats?: boolean
}

export interface SteamAchievement {
  apiname: string
  achieved: boolean
  unlocktime: number | null
  displayName: string
  description: string
  icon: string | null
  icongray: string | null
  hidden: boolean
  /** % of ALL Steam players who unlocked this — null when Steam has no data. */
  globalPercent: number | null
}

/** One row of the shared `steam_apps` cache (migration 092). */
export interface SteamAppDetails {
  appid: number
  name: string | null
  type: string | null
  genres: string[] | null
  metacritic_score: number | null
  is_free: boolean | null
  /** The whole `appdetails` payload — null for a delisted/region-blocked app. */
  details: SteamStoreData | null
  review_score?: number | null
  review_score_desc?: string | null
  review_total_positive?: number | null
  review_total_negative?: number | null
  review_total?: number | null
}

/** The subset of Steam's `appdetails` `data` object this app reads. */
export interface SteamStoreData {
  name?: string
  short_description?: string
  header_image?: string
  developers?: string[]
  publishers?: string[]
  website?: string
  required_age?: string | number
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean }
  metacritic?: { score: number; url: string }
  genres?: { id: string; description: string }[]
  categories?: { id: number; description: string }[]
  screenshots?: { id: number; path_thumbnail: string; path_full: string }[]
  release_date?: { coming_soon: boolean; date: string }
  recommendations?: { total: number }
  achievements?: { total: number }
  price_overview?: {
    currency: string; initial: number; final: number
    discount_percent: number; final_formatted: string
  }
  dlc?: number[]
  content_descriptors?: { ids: number[]; notes: string | null }
}

export interface SteamReviewSummary {
  review_score: number | null
  review_score_desc: string | null
  total_positive: number | null
  total_negative: number | null
  total_reviews: number | null
}

async function invoke<T>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('steam-api', { body: { action, ...extra } })
  if (error) throw error
  if (data?.error === 'not_configured') throw new Error('not_configured')
  if (data?.error) throw new Error(data.error)
  return data as T
}

export function steamGameHeaderUrl(appid: number): string {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`
}

export async function fetchSteamProfile(): Promise<SteamPlayer | null> {
  const r = await invoke<{ player: SteamPlayer | null }>('profile')
  return r.player
}

export async function fetchSteamOwnedGames(): Promise<{ games: SteamGame[]; count: number }> {
  return invoke('owned_games')
}

// NOTE: there is deliberately no `fetchSteamRecentGames`. Steam's
// GetRecentlyPlayedGames is a strict subset of GetOwnedGames (same fields
// plus a count), and `playtime_2weeks` — the only thing the "last 2 weeks"
// strip needs — is already in the owned-games payload. Deriving the strip
// client-side removes a whole round trip from first paint.

export async function fetchSteamAchievements(appid: number): Promise<{ achievements: SteamAchievement[]; note?: string }> {
  return invoke('achievements', { appid })
}

export async function fetchSteamLevelBadges(): Promise<{
  level: number | null
  badges: { badgeid: number; appid?: number; level: number; xp: number; scarcity?: number }[]
  xp: number | null
  xpToNextLevel: number | null
}> {
  return invoke('level_badges')
}

/**
 * Store metadata for one or more apps, served from the `steam_apps` cache and
 * back-filled from Steam on a miss. `missing` lists appids the call could NOT
 * fetch this time (the edge function caps live store fetches per request to
 * stay inside Steam's rate limit) — ask again to fill the rest.
 */
export async function fetchSteamAppDetails(appids: number[]): Promise<{
  apps: SteamAppDetails[]; missing: number[]
}> {
  if (!appids.length) return { apps: [], missing: [] }
  return invoke('app_details', { appids })
}

export async function fetchSteamAppReviews(appid: number): Promise<SteamReviewSummary | null> {
  const r = await invoke<{ reviews: SteamReviewSummary | null }>('app_reviews', { appid })
  return r.reviews
}

/** Live concurrent-player count. Called only on an explicit tap, never on load. */
export async function fetchSteamCurrentPlayers(appid: number): Promise<number | null> {
  const r = await invoke<{ playerCount: number | null }>('current_players', { appid })
  return r.playerCount
}
