import { supabase } from '../../../integrations/supabase/client'

// ─────────────────────────────────────────────────────────────────────────────
//  Steam — proxied through the `steam-api` edge function (personal API key +
//  SteamID64 stay in Vault, never in the client). See CLAUDE.md's Games
//  Feature Detail research note for the full scoping rationale.
// ─────────────────────────────────────────────────────────────────────────────

export interface SteamPlayer {
  steamid: string
  personaname: string
  avatarfull: string
  personastate: number
  gameid?: string
  gameextrainfo?: string
  communityvisibilitystate: number
}

export interface SteamGame {
  appid: number
  name: string
  playtime_forever: number
  playtime_2weeks?: number
  img_icon_url?: string
  rtime_last_played?: number
}

export interface SteamAchievement {
  apiname: string
  achieved: boolean
  unlocktime: number | null
  displayName?: string
  description?: string
  icon?: string
  icongray?: string
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

export async function fetchSteamRecentGames(): Promise<SteamGame[]> {
  const r = await invoke<{ games: SteamGame[] }>('recent_games')
  return r.games
}

export async function fetchSteamAchievements(appid: number): Promise<{ achievements: SteamAchievement[]; note?: string }> {
  return invoke('achievements', { appid })
}

export async function fetchSteamLevelBadges(): Promise<{ level: number | null; badges: unknown[]; xp: number | null }> {
  return invoke('level_badges')
}
